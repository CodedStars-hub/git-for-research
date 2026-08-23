import assert from "node:assert/strict";
import test from "node:test";
import { composeEvidenceAwareAnswer } from "../src/lib/retrieval/answer.ts";

function evidence(overrides) {
  return {
    artifactId: "artifact-1",
    artifactName: "redis.md",
    artifactType: "markdown",
    artifactVersionId: "version-1",
    versionCreatedAt: "2026-08-23T10:00:00.000Z",
    isLatestVersion: true,
    contentHash: "hash-1",
    snippet: "Redis reduced queries by 38%.",
    contextLabel: null,
    score: 10,
    commits: [{ id: "commit-1", shortHash: "commit-", message: "Benchmark" }],
    ...overrides,
  };
}

test("supported answer cites both retrieved conclusions", () => {
  const result = composeEvidenceAwareAnswer("What does the research conclude about Redis?", [
    evidence({ snippet: "Redis reduced queries by 38%." }),
    evidence({ artifactId: "artifact-2", artifactVersionId: "version-2", snippet: "Production validation for Redis is still required.", score: 8 }),
  ]);
  assert.equal(result.confidence, "strong");
  assert.match(result.answer, /38% \[1\]/);
  assert.match(result.answer, /validation.*\[2\]/i);
  assert.equal(result.evidence.length, 2);
});

test("historical numerical evolution labels latest and earlier reports", () => {
  const result = composeEvidenceAwareAnswer("How much did Redis reduce queries?", [
    evidence({ snippet: "Redis reduced queries by 38%.", artifactVersionId: "v2", isLatestVersion: true }),
    evidence({ snippet: "Redis reduced queries by 28%.", artifactVersionId: "v1", isLatestVersion: false, versionCreatedAt: "2026-08-22T10:00:00.000Z" }),
  ]);
  assert.equal(result.confidence, "mixed");
  assert.match(result.answer, /latest version reports/i);
  assert.match(result.answer, /earlier version reported/i);
  assert.deepEqual(result.evidence.map((item) => item.artifactVersionId), ["v2", "v1"]);
});

test("contradictory conclusions remain unresolved", () => {
  const result = composeEvidenceAwareAnswer("Should Redis be deployed?", [
    evidence({ snippet: "Redis should be deployed immediately." }),
    evidence({ artifactId: "artifact-2", artifactVersionId: "version-2", snippet: "Redis should not be deployed until production validation." }),
  ]);
  assert.equal(result.confidence, "mixed");
  assert.match(result.answer, /repository contains conflicting conclusions/i);
  assert.doesNotMatch(result.answer, /therefore|we choose|is correct/i);
});

test("unrelated question produces no invented answer", () => {
  const result = composeEvidenceAwareAnswer("What was the Kubernetes latency improvement?", [
    evidence({ snippet: "Redis reduced queries by 38%." }),
  ]);
  assert.equal(result.confidence, "insufficient");
  assert.equal(result.evidence.length, 0);
  assert.match(result.answer, /does not contain enough evidence/i);
});

test("every answer citation resolves to returned evidence", () => {
  const result = composeEvidenceAwareAnswer("What does research say about Redis?", [
    evidence({}),
    evidence({ artifactId: "artifact-2", artifactVersionId: "version-2", snippet: "Redis requires production validation.", score: 8 }),
  ]);
  const citations = [...result.answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  assert.deepEqual(citations, result.evidence.map((item) => item.citationIndex));
});

test("historical evidence retains version and real commit provenance", () => {
  const historical = evidence({ artifactVersionId: "historical-version", isLatestVersion: false, commits: [{ id: "real-commit-id", shortHash: "real-co", message: "Earlier benchmark" }] });
  const result = composeEvidenceAwareAnswer("What does research say about Redis?", [historical]);
  assert.equal(result.evidence[0].artifactVersionId, "historical-version");
  assert.equal(result.evidence[0].isLatestVersion, false);
  assert.deepEqual(result.evidence[0].commits, historical.commits);
});
