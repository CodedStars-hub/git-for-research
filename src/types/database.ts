export type ArtifactType = "markdown" | "pdf" | "chat";

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Artifact {
  id: string;
  workspace_id: string;
  name: string;
  type: ArtifactType;
  created_at: string;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  content_text: string;
  content_hash: string;
  storage_path: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  workspace_id: string;
  name: string;
  head_commit_id: string | null;
  created_at: string;
}

export interface Commit {
  id: string;
  workspace_id: string;
  branch_id: string;
  parent_commit_id: string | null;
  merge_parent_commit_id: string | null;
  message: string;
  created_at: string;
}

export interface CommitArtifact {
  commit_id: string;
  artifact_id: string;
  artifact_version_id: string;
}

export type ClaimType = "factual" | "numerical" | "conclusion";
export type CheckStatus = "pass" | "warning" | "fail";

export interface Claim { id: string; workspace_id: string; artifact_version_id: string; text: string; claim_type: ClaimType; created_at: string; }
export interface EvidenceLink { id: string; claim_id: string; artifact_version_id: string; evidence_text: string; created_at: string; }
export interface ClaimDependency { id: string; source_claim_id: string; dependent_claim_id: string; relationship: string; created_at: string; }
export interface ResearchReview { id: string; workspace_id: string; source_branch_id: string; target_branch_id: string; source_commit_id: string; target_commit_id: string; status: "open" | "merged" | "closed"; resolution_reason: string | null; created_at: string; }
export interface CiRun { id: string; research_review_id: string; status: CheckStatus; created_at: string; }
export interface CiCheck { id: string; ci_run_id: string; check_type: "textual_merge" | "unsupported_claim" | "numerical_change" | "provenance" | "possible_contradiction" | "blast_radius"; status: CheckStatus; title: string; details: string; metadata: Record<string, unknown>; created_at: string; }
