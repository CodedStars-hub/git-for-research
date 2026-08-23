import type { CheckStatus, ClaimType, ResearchReview } from "@/types/database";
import type { KnowledgeChange } from "./analysis";

export interface ReviewClaim { id: string; text: string; claimType: ClaimType; artifactVersionId: string; artifactId: string; artifactName: string; evidence: { text: string; artifactVersionId: string; score: number } | null; }
export interface ReviewCheck { checkType: "textual_merge" | "unsupported_claim" | "numerical_change" | "provenance" | "possible_contradiction" | "blast_radius"; status: CheckStatus; title: string; details: string; metadata: Record<string, unknown>; }
export interface ReviewAnalysis {
  reviewId?: string; ciRunId?: string; sourceBranchId: string; targetBranchId: string; sourceBranchName: string; targetBranchName: string;
  sourceHeadId: string; targetHeadId: string; commitsChanged: number; artifactsChanged: number;
  knowledgeChanges: KnowledgeChange[]; claims: ReviewClaim[]; checks: ReviewCheck[];
  blastRadius: Array<{ sourceClaim: string; direct: string[]; downstream: string[] }>;
  mergeHasConflicts: boolean; status: CheckStatus; resolutionReason?: string | null;
}

export interface ResearchReviewSummary extends ResearchReview {
  sourceBranchName: string;
  targetBranchName: string;
  currentSourceHeadId: string | null;
  currentTargetHeadId: string | null;
  stale: boolean;
  ciStatus: CheckStatus | null;
  ciRunId: string | null;
}
