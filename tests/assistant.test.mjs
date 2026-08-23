import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRetrievalQuestion,
  createGroundedAssistantResponse,
  validateAnswerCitations,
} from "../src/lib/assistant/grounding.ts";
import { composeEvidenceAwareAnswer } from "../src/lib/retrieval/answer.ts";
import { analyzeAssistantQuery, hasMeaningfulOverlap, meaningfulTerms } from "../src/lib/assistant/query.js";

function evidence(overrides = {}) {
  return {
    artifactId: "redis-paper",
    artifactName: "redis-benchmark.pdf",
    artifactType: "pdf",
    artifactVersionId: "redis-v2",
    versionCreatedAt: "2026-08-23T10:00:00.000Z",
    isLatestVersion: true,
    contentHash: "hash-v2",
    snippet: "The Redis benchmark reports a 38% reduction in repeated queries.",
    contextLabel: null,
    score: 10,
    commits: [{ id: "commit-v2", shortHash: "commit-", message: "Revise benchmark" }],
    ...overrides,
  };
}

function branch(id = "main", name = "main") {
  return { id, name, headCommitId: `head-${id}`, headShortHash: `head-${id}`.slice(0, 7), artifactCount: 2 };
}

function grounded(input) {
  return createGroundedAssistantResponse({ ...input, composeAnswer: composeEvidenceAwareAnswer });
}

test("current branch evidence supports the latest result with a real citation", () => {
  const result = grounded({ question: "What is the latest Redis result?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.match(result.answer, /38%.*\[1\]/);
  assert.equal(result.citations[0].repositoryStatus, "current");
  assert.equal(result.citations[0].artifactVersionId, "redis-v2");
});

test("historical follow-up carries the earlier benchmark topic", () => {
  const history = [{ role: "user", content: "What is the latest Redis benchmark?" }, { role: "assistant", content: "The current result is 38% [1]." }];
  assert.match(buildRetrievalQuestion("What was it before?", history), /Redis benchmark/);
  const result = grounded({ question: "What was it before?", conversationHistory: history, evidence: [evidence(), evidence({ artifactVersionId: "redis-v1", versionCreatedAt: "2026-08-20T10:00:00.000Z", isLatestVersion: false, contentHash: "hash-v1", snippet: "The earlier Redis benchmark reported a 28% reduction in repeated queries.", commits: [{ id: "commit-v1", shortHash: "commit-", message: "Initial benchmark" }] })], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.equal(result.confidence, "mixed");
  assert.match(result.answer, /earlier version reported/i);
  assert.equal(result.citations.find((item) => item.artifactVersionId === "redis-v1")?.repositoryStatus, "historical");
});

test("contradictory recommendations are explicit and unresolved", () => {
  const result = grounded({ question: "Should Redis be deployed?", conversationHistory: [], evidence: [evidence({ snippet: "Redis should be deployed immediately." }), evidence({ artifactId: "notes", artifactName: "notes.md", artifactVersionId: "notes-v1", artifactType: "markdown", snippet: "Redis should not be deployed until production validation." })], currentVersionIds: ["redis-v2", "notes-v1"], currentBranch: branch() });
  assert.equal(result.confidence, "mixed");
  assert.match(result.answer, /conflicting conclusions/i);
});

test("unrelated questions do not receive world-knowledge answers", () => {
  const result = grounded({ question: "What does the repository say about Kubernetes?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.equal(result.confidence, "insufficient");
  assert.equal(result.citations.length, 0);
  assert.match(result.answer, /couldn't find enough evidence/i);
});

test("citation validator rejects nonexistent evidence identifiers", () => {
  const result = grounded({ question: "What is the Redis result?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.equal(validateAnswerCitations("The result is 38% [1].", result.citations), true);
  assert.equal(validateAnswerCitations("The result is 38% [9].", result.citations), false);
  assert.equal(validateAnswerCitations("The result is 38% [source].", result.citations), false);
});

test("branch snapshot membership determines current status", () => {
  const versions = [evidence(), evidence({ artifactVersionId: "redis-v1", versionCreatedAt: "2026-08-20T10:00:00.000Z", isLatestVersion: false, contentHash: "hash-v1", snippet: "The Redis benchmark reports a 28% reduction in repeated queries." })];
  const main = grounded({ question: "What does the Redis benchmark report?", conversationHistory: [], evidence: versions, currentVersionIds: ["redis-v1"], currentBranch: branch("main", "main") });
  const experiment = grounded({ question: "What does the Redis benchmark report?", conversationHistory: [], evidence: versions, currentVersionIds: ["redis-v2"], currentBranch: branch("experiment", "experiment") });
  assert.equal(main.citations.find((item) => item.artifactVersionId === "redis-v1")?.repositoryStatus, "current");
  assert.equal(main.citations.some((item) => item.artifactVersionId === "redis-v2"), false);
  assert.equal(experiment.citations.find((item) => item.artifactVersionId === "redis-v2")?.repositoryStatus, "current");
  assert.equal(experiment.citations.some((item) => item.artifactVersionId === "redis-v1"), false);
});

test("provider-free response remains an honest grounded fallback", () => {
  const result = grounded({ question: "What is the Redis result?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.equal(result.mode, "grounded-retrieval");
  assert.match(result.answer, /38%/);
  assert.equal(result.citations.length, 1);
});

test("unrelated explicit topic returns insufficient confidence and no Redis citations", () => {
  const result = grounded({ question: "What does our research say about Kubernetes?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.equal(result.confidence, "insufficient");
  assert.equal(result.citations.length, 0);
  assert.doesNotMatch(result.answer, /38%|Redis/i);
});

test("a new explicit topic resets prior conversation context", () => {
  const analysis = analyzeAssistantQuery("What does our research say about Kubernetes?", [{ role: "user", content: "Tell me about Redis." }]);
  assert.equal(analysis.isFollowUp, false);
  assert.deepEqual(analysis.topicTerms, ["kubernetes"]);
  assert.doesNotMatch(analysis.effectiveQuery, /redis/i);
});

test("referential follow-up resolves the most recent substantive topic", () => {
  const analysis = analyzeAssistantQuery("What did we believe before that?", [{ role: "user", content: "What does the research currently conclude about Redis?" }, { role: "assistant", content: "The current benchmark is 38%." }]);
  assert.equal(analysis.intent, "HISTORICAL");
  assert.equal(analysis.isFollowUp, true);
  assert.match(analysis.effectiveQuery, /redis/i);
});

test("current result prefers the selected branch snapshot version", () => {
  const result = grounded({ question: "What is the current Redis benchmark result?", conversationHistory: [], evidence: [evidence(), evidence({ artifactVersionId: "redis-v1", isLatestVersion: false, versionCreatedAt: "2026-08-20T10:00:00.000Z", snippet: "The Redis benchmark reports a 28% reduction in repeated queries." })], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.match(result.answer, /38%/);
  assert.equal(result.citations[0].artifactVersionId, "redis-v2");
});

test("historical result prefers the earlier artifact version", () => {
  const history = [{ role: "user", content: "What is the current Redis benchmark result?" }, { role: "assistant", content: "The current result is 38%." }];
  const result = grounded({ question: "What was it previously?", conversationHistory: history, evidence: [evidence(), evidence({ artifactVersionId: "redis-v1", isLatestVersion: false, versionCreatedAt: "2026-08-20T10:00:00.000Z", snippet: "The Redis benchmark reports a 28% reduction in repeated queries." })], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.match(result.answer, /earlier version reported.*28%/i);
  assert.equal(result.citations[0].artifactVersionId, "redis-v1");
});

test("retrieval relevance floor allows zero qualifying evidence", () => {
  assert.equal(hasMeaningfulOverlap("Redis reduced repeated queries by 38%.", meaningfulTerms("Kubernetes orchestration")), false);
});

test("generic repository words do not qualify unrelated evidence", () => {
  const terms = meaningfulTerms("What does our research say about Kubernetes?");
  assert.deepEqual(terms, ["kubernetes"]);
  assert.equal(hasMeaningfulOverlap("This research is about database results.", terms), false);
});

test("chat transcript control prefixes are removed from synthesized answers", () => {
  const result = composeEvidenceAwareAnswer("What is the Redis benchmark?", [evidence({ artifactType: "chat", snippet: "CONVERSATION: Redis review USER: What changed? ASSISTANT: The Redis benchmark reports a 38% reduction." })]);
  assert.doesNotMatch(result.answer, /CONVERSATION:|\bUSER\b|\bASSISTANT\b/);
  assert.match(result.answer, /38%/);
});

test("displayed citations correspond only to evidence used in the answer", () => {
  const result = grounded({ question: "What is the Redis result?", conversationHistory: [], evidence: [evidence(), evidence({ artifactId: "kubernetes", artifactVersionId: "k8s-v1", snippet: "Kubernetes autoscaling was evaluated." })], currentVersionIds: ["redis-v2", "k8s-v1"], currentBranch: branch() });
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].artifactVersionId, "redis-v2");
});

test("unrelated evidence can never produce strong confidence", () => {
  const result = grounded({ question: "What does our research say about Kubernetes?", conversationHistory: [], evidence: [evidence()], currentVersionIds: ["redis-v2"], currentBranch: branch() });
  assert.notEqual(result.confidence, "strong");
});
