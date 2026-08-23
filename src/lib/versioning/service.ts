import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Artifact,
  ArtifactType,
  ArtifactVersion,
  Branch,
  Commit,
  CommitArtifact,
} from "@/types/database";
import { diffText, mergeText } from "./diff";
import { findCommonAncestor } from "./graph";
import {
  ciCheckSetIsComplete,
  directCommitPolicy,
  reviewedMergeRequestIsCurrent,
} from "./policy";
import type {
  ArtifactComparison,
  MergePlan,
  MergePlanItem,
  SnapshotArtifact,
  VersioningState,
} from "./types";

const supabase = new Proxy({} as ReturnType<typeof getSupabaseAdmin>, {
  get(_target, property) {
    return Reflect.get(getSupabaseAdmin(), property, getSupabaseAdmin());
  },
});

interface CommitEdit {
  artifactId: string;
  contentText: string;
}

interface ArtifactVersionUpdate {
  artifactId: string;
  artifactType: "pdf" | "chat";
  contentText: string;
}

interface Resolution {
  artifactId: string;
  choice: "ours" | "theirs" | "manual";
  contentText?: string;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

async function getBranches(workspaceId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, workspace_id, name, head_commit_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load branches: ${error.message}`);
  return data as Branch[];
}

async function getCommits(workspaceId: string): Promise<Commit[]> {
  const { data, error } = await supabase
    .from("commits")
    .select(
      "id, workspace_id, branch_id, parent_commit_id, merge_parent_commit_id, message, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load commits: ${error.message}`);
  return data as Commit[];
}

async function getWorkspaceArtifacts(workspaceId: string): Promise<Artifact[]> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, workspace_id, name, type, created_at")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`Could not load artifacts: ${error.message}`);
  return data as Artifact[];
}

async function getVersionsByIds(ids: string[]): Promise<ArtifactVersion[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("artifact_versions")
    .select(
      "id, artifact_id, content_text, content_hash, storage_path, created_at",
    )
    .in("id", ids);
  if (error) throw new Error(`Could not load artifact versions: ${error.message}`);
  return data as ArtifactVersion[];
}

async function getLatestSnapshot(
  workspaceId: string,
): Promise<SnapshotArtifact[]> {
  const artifacts = await getWorkspaceArtifacts(workspaceId);
  if (!artifacts.length) return [];

  const { data, error } = await supabase
    .from("artifact_versions")
    .select(
      "id, artifact_id, content_text, content_hash, storage_path, created_at",
    )
    .in(
      "artifact_id",
      artifacts.map((artifact) => artifact.id),
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load current versions: ${error.message}`);

  const latest = new Map<string, ArtifactVersion>();
  for (const version of data as ArtifactVersion[]) {
    if (!latest.has(version.artifact_id)) latest.set(version.artifact_id, version);
  }

  return artifacts.flatMap((artifact) => {
    const version = latest.get(artifact.id);
    return version
      ? [
          {
            artifactId: artifact.id,
            artifactVersionId: version.id,
            name: artifact.name,
            type: artifact.type,
            contentText: version.content_text,
            contentHash: version.content_hash,
          },
        ]
      : [];
  });
}

export async function getCommitSnapshot(
  workspaceId: string,
  commitId: string,
): Promise<SnapshotArtifact[]> {
  const { data: commitData, error: commitError } = await supabase
    .from("commits")
    .select("id")
    .eq("id", commitId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (commitError) throw new Error(`Could not load commit: ${commitError.message}`);
  if (!commitData) throw new Error("Commit does not belong to this workspace.");

  const { data, error } = await supabase
    .from("commit_artifacts")
    .select("commit_id, artifact_id, artifact_version_id")
    .eq("commit_id", commitId);
  if (error) throw new Error(`Could not load commit snapshot: ${error.message}`);

  const mappings = data as CommitArtifact[];
  const [artifacts, versions] = await Promise.all([
    getWorkspaceArtifacts(workspaceId),
    getVersionsByIds(mappings.map((mapping) => mapping.artifact_version_id)),
  ]);
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const versionMap = new Map(versions.map((version) => [version.id, version]));

  return mappings.map((mapping) => {
    const artifact = artifactMap.get(mapping.artifact_id);
    const version = versionMap.get(mapping.artifact_version_id);
    if (!artifact || !version) throw new Error("Commit snapshot is incomplete.");
    return {
      artifactId: artifact.id,
      artifactVersionId: version.id,
      name: artifact.name,
      type: artifact.type,
      contentText: version.content_text,
      contentHash: version.content_hash,
    };
  });
}

async function getWorkingSnapshot(
  workspaceId: string,
  headCommitId: string | null,
): Promise<SnapshotArtifact[]> {
  const latest = await getLatestSnapshot(workspaceId);
  if (!headCommitId) return latest;

  const committed = await getCommitSnapshot(workspaceId, headCommitId);
  const committedIds = new Set(committed.map((item) => item.artifactId));
  return [
    ...committed,
    ...latest.filter((item) => !committedIds.has(item.artifactId)),
  ];
}

async function getBranch(
  workspaceId: string,
  branchId: string,
): Promise<Branch> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, workspace_id, name, head_commit_id, created_at")
    .eq("id", branchId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not load branch: ${error.message}`);
  if (!data) throw new Error("Branch does not belong to this workspace.");
  return data as Branch;
}

async function requireCurrentMainReview({
  workspaceId,
  source,
  target,
}: {
  workspaceId: string;
  source: Branch;
  target: Branch;
}): Promise<string | null> {
  if (target.name !== "main" || target.head_commit_id === null) return null;
  if (!source.head_commit_id) {
    throw new Error("The source branch has no commit to review.");
  }
  const { data: review, error: reviewError } = await supabase
    .from("research_reviews")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("source_branch_id", source.id)
    .eq("target_branch_id", target.id)
    .eq("source_commit_id", source.head_commit_id)
    .eq("target_commit_id", target.head_commit_id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewError) {
    throw new Error(`Could not verify Research Review: ${reviewError.message}`);
  }
  if (!review) {
    throw new Error(
      "A current Research Review and Research CI run are required before merging into protected main.",
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ci_runs")
    .select("id")
    .eq("research_review_id", review.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error(`Could not verify Research CI: ${runError.message}`);
  if (!run) {
    throw new Error("Research CI must run for the current reviewed heads before merge.");
  }
  const { data: checks, error: checkError } = await supabase
    .from("ci_checks")
    .select("check_type")
    .eq("ci_run_id", run.id);
  if (checkError) throw new Error(`Could not verify merge preparation: ${checkError.message}`);
  if (!ciCheckSetIsComplete((checks ?? []).map((check) => check.check_type))) {
    throw new Error("Research CI is incomplete for the current reviewed heads.");
  }
  return review.id as string;
}

async function ensureMainBranch(workspaceId: string): Promise<Branch> {
  const branches = await getBranches(workspaceId);
  const existing = branches.find((branch) => branch.name === "main");
  if (existing) return existing;

  const { data, error } = await supabase
    .from("branches")
    .insert({ workspace_id: workspaceId, name: "main", head_commit_id: null })
    .select("id, workspace_id, name, head_commit_id, created_at")
    .single();
  if (error) throw new Error(`Could not create main branch: ${error.message}`);
  return data as Branch;
}

async function createVersion(
  artifactId: string,
  contentText: string,
): Promise<ArtifactVersion> {
  const normalized = contentText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("Artifact content cannot be empty.");

  const { data, error } = await supabase
    .from("artifact_versions")
    .insert({
      artifact_id: artifactId,
      content_text: normalized,
      content_hash: hashContent(normalized),
      storage_path: null,
    })
    .select(
      "id, artifact_id, content_text, content_hash, storage_path, created_at",
    )
    .single();
  if (error) throw new Error(`Could not create artifact version: ${error.message}`);
  return data as ArtifactVersion;
}

export async function commitArtifactVersion({
  workspaceId,
  branchId,
  message,
  update,
}: {
  workspaceId: string;
  branchId: string;
  message: string;
  update: ArtifactVersionUpdate;
}): Promise<Commit> {
  const commitMessage = requireText(message, "Commit message cannot be empty.");
  const branch = await getBranch(workspaceId, branchId);
  const policy = directCommitPolicy({
    name: branch.name,
    headCommitId: branch.head_commit_id,
  });
  if (!policy.allowed) throw new Error(policy.reason!);
  const artifacts = await getWorkspaceArtifacts(workspaceId);
  const artifact = artifacts.find((item) => item.id === update.artifactId);

  if (!artifact) throw new Error("Artifact does not belong to this workspace.");
  if (artifact.type !== update.artifactType) {
    throw new Error("Uploaded version type does not match the artifact.");
  }

  const snapshot = await getWorkingSnapshot(workspaceId, branch.head_commit_id);
  const snapshotMap = new Map(snapshot.map((item) => [item.artifactId, item]));
  const version = await createVersion(artifact.id, update.contentText);
  snapshotMap.set(artifact.id, {
    artifactId: artifact.id,
    artifactVersionId: version.id,
    name: artifact.name,
    type: artifact.type,
    contentText: version.content_text,
    contentHash: version.content_hash,
  });

  return insertCommitAndMoveHead({
    workspaceId,
    branch,
    message: commitMessage,
    parentCommitId: branch.head_commit_id,
    mergeParentCommitId: null,
    snapshot: [...snapshotMap.values()],
  });
}

async function insertCommitAndMoveHead({
  workspaceId,
  branch,
  message,
  parentCommitId,
  mergeParentCommitId,
  snapshot,
}: {
  workspaceId: string;
  branch: Branch;
  message: string;
  parentCommitId: string | null;
  mergeParentCommitId: string | null;
  snapshot: SnapshotArtifact[];
}): Promise<Commit> {
  if (!snapshot.length) throw new Error("Cannot commit an empty workspace.");

  const { data: commitData, error: commitError } = await supabase
    .from("commits")
    .insert({
      workspace_id: workspaceId,
      branch_id: branch.id,
      parent_commit_id: parentCommitId,
      merge_parent_commit_id: mergeParentCommitId,
      message: requireText(message, "Commit message cannot be empty."),
    })
    .select(
      "id, workspace_id, branch_id, parent_commit_id, merge_parent_commit_id, message, created_at",
    )
    .single();
  if (commitError) throw new Error(`Could not create commit: ${commitError.message}`);

  const commit = commitData as Commit;
  const { error: snapshotError } = await supabase.from("commit_artifacts").insert(
    snapshot.map((item) => ({
      commit_id: commit.id,
      artifact_id: item.artifactId,
      artifact_version_id: item.artifactVersionId,
    })),
  );
  if (snapshotError) {
    throw new Error(
      `Commit was not activated because its snapshot failed: ${snapshotError.message}`,
    );
  }

  let headUpdate = supabase
    .from("branches")
    .update({ head_commit_id: commit.id })
    .eq("id", branch.id)
    .eq("workspace_id", workspaceId);
  headUpdate = parentCommitId
    ? headUpdate.eq("head_commit_id", parentCommitId)
    : headUpdate.is("head_commit_id", null);
  const { data: updatedBranches, error: headError } = await headUpdate.select("id");

  if (headError || !updatedBranches?.length) {
    throw new Error(
      "Commit snapshot was saved, but the branch changed concurrently and its head was not moved.",
    );
  }

  return commit;
}

export async function getVersioningState(
  workspaceId: string,
  selectedBranchId?: string,
): Promise<VersioningState> {
  const [branches, commits] = await Promise.all([
    getBranches(workspaceId),
    getCommits(workspaceId),
  ]);
  const selectedBranch =
    branches.find((branch) => branch.id === selectedBranchId) ??
    branches.find((branch) => branch.name === "main") ??
    branches[0] ??
    null;
  const snapshot = await getWorkingSnapshot(
    workspaceId,
    selectedBranch?.head_commit_id ?? null,
  );
  return { branches, commits, selectedBranch, snapshot };
}

export async function commitChanges({
  workspaceId,
  branchId,
  message,
  edits,
}: {
  workspaceId: string;
  branchId?: string;
  message: string;
  edits: CommitEdit[];
}): Promise<Commit> {
  const commitMessage = requireText(message, "Commit message cannot be empty.");
  const branch = branchId
    ? await getBranch(workspaceId, branchId)
    : await ensureMainBranch(workspaceId);
  const policy = directCommitPolicy({
    name: branch.name,
    headCommitId: branch.head_commit_id,
  });
  if (!policy.allowed) throw new Error(policy.reason!);
  const snapshot = await getWorkingSnapshot(workspaceId, branch.head_commit_id);
  const snapshotMap = new Map(snapshot.map((item) => [item.artifactId, item]));

  if (edits.length) {
    const artifacts = await getWorkspaceArtifacts(workspaceId);
    const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    for (const edit of edits) {
      const artifact = artifactMap.get(edit.artifactId);
      if (!artifact) throw new Error("Edited artifact does not belong to this workspace.");
      if (artifact.type !== "markdown") {
        throw new Error("Only Markdown/plaintext artifacts can be edited.");
      }
      const version = await createVersion(artifact.id, edit.contentText);
      snapshotMap.set(artifact.id, {
        artifactId: artifact.id,
        artifactVersionId: version.id,
        name: artifact.name,
        type: artifact.type,
        contentText: version.content_text,
        contentHash: version.content_hash,
      });
    }
  }

  return insertCommitAndMoveHead({
    workspaceId,
    branch,
    message: commitMessage,
    parentCommitId: branch.head_commit_id,
    mergeParentCommitId: null,
    snapshot: [...snapshotMap.values()],
  });
}

export async function createBranch({
  workspaceId,
  name,
  fromCommitId,
}: {
  workspaceId: string;
  name: string;
  fromCommitId: string;
}): Promise<Branch> {
  const branchName = requireText(name, "Branch name cannot be empty.");
  await getCommitSnapshot(workspaceId, fromCommitId);

  const { data, error } = await supabase
    .from("branches")
    .insert({
      workspace_id: workspaceId,
      name: branchName,
      head_commit_id: fromCommitId,
    })
    .select("id, workspace_id, name, head_commit_id, created_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("A branch with this name already exists in the workspace.");
    }
    throw new Error(`Could not create branch: ${error.message}`);
  }
  return data as Branch;
}

export async function compareCommits(
  workspaceId: string,
  beforeCommitId: string,
  afterCommitId: string,
): Promise<ArtifactComparison[]> {
  const [before, after] = await Promise.all([
    getCommitSnapshot(workspaceId, beforeCommitId),
    getCommitSnapshot(workspaceId, afterCommitId),
  ]);
  const beforeMap = new Map(before.map((item) => [item.artifactId, item]));
  const afterMap = new Map(after.map((item) => [item.artifactId, item]));
  const ids = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  return ids.map((artifactId) => {
    const left = beforeMap.get(artifactId);
    const right = afterMap.get(artifactId);
    const beforeText = left?.contentText ?? "";
    const afterText = right?.contentText ?? "";
    const status = !left
      ? "added"
      : !right
        ? "removed"
        : left.contentHash === right.contentHash
          ? "unchanged"
          : "modified";
    return {
      artifactId,
      name: right?.name ?? left?.name ?? artifactId,
      type: (right?.type ?? left?.type ?? "markdown") as ArtifactType,
      status,
      before: beforeText,
      after: afterText,
      chunks: diffText(beforeText, afterText),
    };
  });
}

function chooseMergeItem(
  artifactId: string,
  base: SnapshotArtifact | undefined,
  ours: SnapshotArtifact | undefined,
  theirs: SnapshotArtifact | undefined,
): MergePlanItem {
  const reference = ours ?? theirs ?? base;
  if (!reference) throw new Error("Merge artifact metadata is missing.");

  const baseText = base?.contentText ?? "";
  const oursText = ours?.contentText ?? "";
  const theirsText = theirs?.contentText ?? "";
  const oursMatchesTheirs = oursText === theirsText;
  const oursMatchesBase = oursText === baseText;
  const theirsMatchesBase = theirsText === baseText;

  if (oursMatchesTheirs || theirsMatchesBase) {
    return {
      artifactId,
      name: reference.name,
      type: reference.type,
      status: "selected",
      selectedVersionId: ours?.artifactVersionId ?? theirs?.artifactVersionId ?? null,
      mergedText: null,
      baseText,
      oursText,
      theirsText,
    };
  }

  if (oursMatchesBase) {
    return {
      artifactId,
      name: reference.name,
      type: reference.type,
      status: "selected",
      selectedVersionId: theirs?.artifactVersionId ?? null,
      mergedText: null,
      baseText,
      oursText,
      theirsText,
    };
  }

  if (reference.type !== "markdown") {
    return {
      artifactId,
      name: reference.name,
      type: reference.type,
      status: "conflict",
      selectedVersionId: null,
      mergedText: null,
      baseText,
      oursText,
      theirsText,
    };
  }

  const merged = mergeText(baseText, oursText, theirsText);
  return {
    artifactId,
    name: reference.name,
    type: reference.type,
    status: merged.conflict ? "conflict" : "auto-merged",
    selectedVersionId: null,
    mergedText: merged.content,
    baseText,
    oursText,
    theirsText,
  };
}

export async function prepareMerge({
  workspaceId,
  targetBranchId,
  incomingBranchId,
}: {
  workspaceId: string;
  targetBranchId: string;
  incomingBranchId: string;
}): Promise<MergePlan> {
  if (targetBranchId === incomingBranchId) {
    throw new Error("Choose two different branches to merge.");
  }

  const [target, incoming, commits] = await Promise.all([
    getBranch(workspaceId, targetBranchId),
    getBranch(workspaceId, incomingBranchId),
    getCommits(workspaceId),
  ]);
  if (!target.head_commit_id || !incoming.head_commit_id) {
    throw new Error("Both branches need at least one commit before merging.");
  }
  if (target.head_commit_id === incoming.head_commit_id) {
    throw new Error("These branches already point to the same commit.");
  }

  const baseCommitId = findCommonAncestor(
    commits,
    target.head_commit_id,
    incoming.head_commit_id,
  );
  if (!baseCommitId) throw new Error("The branches have no common ancestor.");

  const [base, ours, theirs] = await Promise.all([
    getCommitSnapshot(workspaceId, baseCommitId),
    getCommitSnapshot(workspaceId, target.head_commit_id),
    getCommitSnapshot(workspaceId, incoming.head_commit_id),
  ]);
  const baseMap = new Map(base.map((item) => [item.artifactId, item]));
  const oursMap = new Map(ours.map((item) => [item.artifactId, item]));
  const theirsMap = new Map(theirs.map((item) => [item.artifactId, item]));
  const artifactIds = [
    ...new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]),
  ].sort();
  const items = artifactIds.map((artifactId) =>
    chooseMergeItem(
      artifactId,
      baseMap.get(artifactId),
      oursMap.get(artifactId),
      theirsMap.get(artifactId),
    ),
  );

  return {
    baseCommitId,
    targetHeadId: target.head_commit_id,
    incomingHeadId: incoming.head_commit_id,
    targetBranchId,
    incomingBranchId,
    items,
    hasConflicts: items.some((item) => item.status === "conflict"),
  };
}

export async function prepareReviewedMerge({
  workspaceId,
  reviewId,
  sourceBranchId,
  targetBranchId,
}: {
  workspaceId: string;
  reviewId: string;
  sourceBranchId: string;
  targetBranchId: string;
}): Promise<MergePlan> {
  const [source, target, reviewResult] = await Promise.all([
    getBranch(workspaceId, sourceBranchId),
    getBranch(workspaceId, targetBranchId),
    supabase
      .from("research_reviews")
      .select(
        "id, source_branch_id, target_branch_id, source_commit_id, target_commit_id, status",
      )
      .eq("id", reviewId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  if (reviewResult.error) {
    throw new Error(`Could not verify Research Review: ${reviewResult.error.message}`);
  }
  if (
    target.name !== "main" ||
    !reviewResult.data ||
    !reviewedMergeRequestIsCurrent(
      {
        id: reviewResult.data.id,
        sourceBranchId: reviewResult.data.source_branch_id,
        targetBranchId: reviewResult.data.target_branch_id,
        sourceHeadId: reviewResult.data.source_commit_id,
        targetHeadId: reviewResult.data.target_commit_id,
        status: reviewResult.data.status,
      },
      {
        reviewId,
        sourceBranchId,
        targetBranchId,
        sourceHeadId: reviewResult.data.source_commit_id,
        targetHeadId: reviewResult.data.target_commit_id,
      },
      {
        sourceHeadId: source.head_commit_id,
        targetHeadId: target.head_commit_id,
      },
    )
  ) {
    throw new Error(
      "Research Review is out of date. Refresh the review before merging.",
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ci_runs")
    .select("id")
    .eq("research_review_id", reviewId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error(`Could not verify Research CI: ${runError.message}`);
  if (!run) throw new Error("Research CI must run before preparing this merge.");
  const { data: checks, error: checksError } = await supabase
    .from("ci_checks")
    .select("check_type")
    .eq("ci_run_id", run.id);
  if (checksError) {
    throw new Error(`Could not verify Research CI: ${checksError.message}`);
  }
  if (!ciCheckSetIsComplete((checks ?? []).map((check) => check.check_type))) {
    throw new Error("Research CI is incomplete for this Review.");
  }

  const plan = await prepareMerge({
    workspaceId,
    targetBranchId,
    incomingBranchId: sourceBranchId,
  });
  if (
    plan.targetHeadId !== reviewResult.data.target_commit_id ||
    plan.incomingHeadId !== reviewResult.data.source_commit_id
  ) {
    throw new Error(
      "Research Review is out of date. Refresh the review before merging.",
    );
  }
  return plan;
}

export async function completeMerge({
  workspaceId,
  targetBranchId,
  incomingBranchId,
  message,
  resolutions,
}: {
  workspaceId: string;
  targetBranchId: string;
  incomingBranchId: string;
  message: string;
  resolutions: Resolution[];
}): Promise<Commit> {
  const commitMessage = requireText(
    message,
    "Merge commit message cannot be empty.",
  );
  const plan = await prepareMerge({
    workspaceId,
    targetBranchId,
    incomingBranchId,
  });
  const [target, incoming] = await Promise.all([
    getBranch(workspaceId, targetBranchId),
    getBranch(workspaceId, incomingBranchId),
  ]);
  if (target.head_commit_id !== plan.targetHeadId) {
    throw new Error("The target branch changed. Prepare the merge again.");
  }
  if (incoming.head_commit_id !== plan.incomingHeadId) {
    throw new Error("The incoming branch changed. Prepare the merge again.");
  }
  const protectedReviewId = await requireCurrentMainReview({
    workspaceId,
    source: incoming,
    target,
  });

  const resolutionMap = new Map(
    resolutions.map((resolution) => [resolution.artifactId, resolution]),
  );
  const snapshot: SnapshotArtifact[] = [];

  for (const item of plan.items) {
    if (item.status === "selected") {
      if (!item.selectedVersionId) continue;
      snapshot.push({
        artifactId: item.artifactId,
        artifactVersionId: item.selectedVersionId,
        name: item.name,
        type: item.type,
        contentText: item.oursText || item.theirsText,
        contentHash: "",
      });
      continue;
    }

    let resolvedText = item.mergedText;
    if (item.status === "conflict") {
      const resolution = resolutionMap.get(item.artifactId);
      if (!resolution) throw new Error(`Resolve the conflict in ${item.name}.`);
      resolvedText =
        resolution.choice === "ours"
          ? item.oursText
          : resolution.choice === "theirs"
            ? item.theirsText
            : resolution.contentText ?? null;
    }
    if (resolvedText === null) throw new Error(`Resolve the conflict in ${item.name}.`);

    if (item.type !== "markdown") {
      const resolution = resolutionMap.get(item.artifactId);
      const sourceSnapshot = await getCommitSnapshot(
        workspaceId,
        resolution?.choice === "theirs"
          ? plan.incomingHeadId
          : plan.targetHeadId,
      );
      const selected = sourceSnapshot.find(
        (snapshotItem) => snapshotItem.artifactId === item.artifactId,
      );
      if (!selected) throw new Error(`Could not resolve ${item.name}.`);
      snapshot.push(selected);
      continue;
    }

    const version = await createVersion(item.artifactId, resolvedText);
    snapshot.push({
      artifactId: item.artifactId,
      artifactVersionId: version.id,
      name: item.name,
      type: item.type,
      contentText: version.content_text,
      contentHash: version.content_hash,
    });
  }

  const commit = await insertCommitAndMoveHead({
    workspaceId,
    branch: target,
    message: commitMessage,
    parentCommitId: plan.targetHeadId,
    mergeParentCommitId: plan.incomingHeadId,
    snapshot,
  });
  if (protectedReviewId) {
    const { error } = await supabase
      .from("research_reviews")
      .update({ status: "merged" })
      .eq("id", protectedReviewId)
      .eq("status", "open");
    if (error) {
      throw new Error(
        `Merge completed, but the Research Review status could not be updated: ${error.message}`,
      );
    }
  }
  return commit;
}
