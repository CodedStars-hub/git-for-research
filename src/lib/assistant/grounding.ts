import type { EvidenceAwareAnswer } from "../retrieval/answer";
import type { EvidenceResult } from "../retrieval/retrieval";
import type {
  AssistantBranchContext,
  AssistantCitation,
  AssistantResponse,
  ConversationMessage,
} from "./types";
import { analyzeAssistantQuery } from "./query.js";

const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 2_000;

export function boundConversation(
  history: ConversationMessage[],
): ConversationMessage[] {
  return history
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim(),
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_MESSAGE_LENGTH),
    }));
}

export function buildRetrievalQuestion(
  question: string,
  history: ConversationMessage[],
): string {
  const query = analyzeAssistantQuery(question, boundConversation(history)).effectiveQuery;
  return query.replace(/^./, (letter: string) => letter.toUpperCase());
}

export function validateAnswerCitations(
  answer: string,
  citations: AssistantCitation[],
): boolean {
  const markers = [...answer.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  if (!markers.length || markers.some((marker) => !/^\d+$/.test(marker))) {
    return false;
  }
  const referenced = markers.map(Number);
  const valid = new Set(citations.map((citation) => citation.citationIndex));
  return referenced.every((index) => valid.has(index));
}

export function createGroundedAssistantResponse({
  question,
  conversationHistory,
  evidence,
  currentVersionIds,
  currentBranch,
  composeAnswer,
}: {
  question: string;
  conversationHistory: ConversationMessage[];
  evidence: EvidenceResult[];
  currentVersionIds: string[];
  currentBranch: AssistantBranchContext;
  composeAnswer: (
    question: string,
    evidence: EvidenceResult[],
  ) => EvidenceAwareAnswer;
}): AssistantResponse {
  const currentIds = new Set(currentVersionIds);
  const queryAnalysis = analyzeAssistantQuery(question, conversationHistory);
  const branchAwareEvidence = evidence
    .map((item) => ({
      ...item,
      isLatestVersion: currentIds.has(item.artifactVersionId),
    }))
    .sort((left, right) => {
      const historical = queryAnalysis.intent === "HISTORICAL";
      const currentOrder = historical
        ? Number(left.isLatestVersion) - Number(right.isLatestVersion)
        : Number(right.isLatestVersion) - Number(left.isLatestVersion);
      return currentOrder || right.score - left.score || (historical ? left.versionCreatedAt.localeCompare(right.versionCreatedAt) : right.versionCreatedAt.localeCompare(left.versionCreatedAt));
    });
  const answerEvidence = queryAnalysis.intent === "CURRENT_STATE" && branchAwareEvidence.some((item) => item.isLatestVersion)
    ? branchAwareEvidence.filter((item) => item.isLatestVersion)
    : branchAwareEvidence;
  const grounded = composeAnswer(
    queryAnalysis.effectiveQuery,
    answerEvidence,
  );
  const citations = grounded.evidence.map(
    (item): AssistantCitation => ({
      ...item,
      repositoryStatus: currentIds.has(item.artifactVersionId)
        ? "current"
        : "historical",
    }),
  );

  if (!citations.length) {
    return {
      answer: queryAnalysis.topicTerms.length === 1
        ? `I couldn't find enough evidence about ${queryAnalysis.topicTerms[0].replace(/^./, (letter: string) => letter.toUpperCase())} in this research repository.`
        : "I couldn't find enough evidence in this research repository to answer that.",
      mode: "grounded-retrieval",
      confidence: "insufficient",
      citations: [],
      currentBranch,
      limitations: [
        "No retrieved repository evidence directly supports an answer.",
      ],
    };
  }

  return {
    answer: grounded.answer,
    mode: "grounded-retrieval",
    confidence: grounded.confidence,
    citations,
    currentBranch,
    limitations: grounded.limitations,
  };
}
