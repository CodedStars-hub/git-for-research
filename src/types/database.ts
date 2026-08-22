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

