import type { ArtifactType, Branch, Commit } from "@/types/database";
import type { DiffKind, TextDiffChunk } from "./diff";

export interface SnapshotArtifact {
  artifactId: string;
  artifactVersionId: string;
  name: string;
  type: ArtifactType;
  contentText: string;
  contentHash: string;
}

export interface VersioningState {
  branches: Branch[];
  commits: Commit[];
  selectedBranch: Branch | null;
  snapshot: SnapshotArtifact[];
}

export interface ArtifactComparison {
  artifactId: string;
  name: string;
  type: ArtifactType;
  status: DiffKind;
  before: string;
  after: string;
  chunks: TextDiffChunk[];
}

export interface MergePlanItem {
  artifactId: string;
  name: string;
  type: ArtifactType;
  status: "selected" | "auto-merged" | "conflict";
  selectedVersionId: string | null;
  mergedText: string | null;
  baseText: string;
  oursText: string;
  theirsText: string;
}

export interface MergePlan {
  baseCommitId: string;
  targetHeadId: string;
  incomingHeadId: string;
  targetBranchId: string;
  incomingBranchId: string;
  items: MergePlanItem[];
  hasConflicts: boolean;
}

