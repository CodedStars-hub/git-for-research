import type { CitedEvidence, EvidenceAwareAnswer } from "@/lib/retrieval/answer";
import type { ArtifactType } from "@/types/database";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantCitation extends CitedEvidence {
  repositoryStatus: "current" | "historical";
}

export interface AssistantBranchContext {
  id: string;
  name: string;
  headCommitId: string | null;
  headShortHash: string | null;
  artifactCount: number;
}

export interface AssistantResponse
  extends Omit<EvidenceAwareAnswer, "evidence"> {
  mode: "generated" | "grounded-retrieval";
  citations: AssistantCitation[];
  currentBranch: AssistantBranchContext;
}

export interface ResearchContext {
  workspace: { id: string; name: string };
  currentBranch: AssistantBranchContext;
  currentVersionIds: string[];
  currentSnapshot: Array<{
    artifactId: string;
    artifactVersionId: string;
    name: string;
    type: ArtifactType;
    contentPreview: string;
  }>;
  retrievalQuestion: string;
  conversationHistory: ConversationMessage[];
  evidence: AssistantCitation[];
  groundedResponse: AssistantResponse;
}
