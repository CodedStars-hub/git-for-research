import { retrieveEvidence } from "@/lib/retrieval/retrieval";
import { composeEvidenceAwareAnswer } from "@/lib/retrieval/answer";
import { supabase } from "@/lib/supabase/client";
import { getVersioningState } from "@/lib/versioning/service";
import { buildRetrievalQuestion, boundConversation, createGroundedAssistantResponse } from "./grounding";
import type { ConversationMessage, ResearchContext } from "./types";

export async function buildResearchContext({
  workspaceId,
  branchId,
  question,
  conversationHistory,
}: {
  workspaceId: string;
  branchId: string;
  question: string;
  conversationHistory: ConversationMessage[];
}): Promise<ResearchContext> {
  const boundedHistory = boundConversation(conversationHistory);
  const retrievalQuestion = buildRetrievalQuestion(question, boundedHistory);
  const [{ data: workspace, error: workspaceError }, state, evidence] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("id,name")
        .eq("id", workspaceId)
        .maybeSingle(),
      getVersioningState(workspaceId, branchId),
      retrieveEvidence(workspaceId, retrievalQuestion, 12),
    ]);
  if (workspaceError) {
    throw new Error(`Could not load assistant workspace: ${workspaceError.message}`);
  }
  if (!workspace) throw new Error("Research workspace was not found.");
  if (!state.selectedBranch || state.selectedBranch.id !== branchId) {
    throw new Error("Selected branch was not found in this workspace.");
  }

  const currentBranch = {
    id: state.selectedBranch.id,
    name: state.selectedBranch.name,
    headCommitId: state.selectedBranch.head_commit_id,
    headShortHash: state.selectedBranch.head_commit_id?.slice(0, 7) ?? null,
    artifactCount: state.selectedBranch.head_commit_id ? state.snapshot.length : 0,
  };
  const currentVersionIds = state.selectedBranch.head_commit_id
    ? state.snapshot.map((artifact) => artifact.artifactVersionId)
    : [];
  const currentSnapshot = state.selectedBranch.head_commit_id
    ? state.snapshot.slice(0, 20).map((artifact) => ({
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        name: artifact.name,
        type: artifact.type,
        contentPreview: artifact.contentText.slice(0, 1_200),
      }))
    : [];
  const groundedResponse = createGroundedAssistantResponse({
    question,
    conversationHistory: boundedHistory,
    evidence,
    currentVersionIds,
    currentBranch,
    composeAnswer: composeEvidenceAwareAnswer,
  });

  return {
    workspace,
    currentBranch,
    currentVersionIds,
    currentSnapshot,
    retrievalQuestion,
    conversationHistory: boundedHistory,
    evidence: groundedResponse.citations,
    groundedResponse,
  };
}
