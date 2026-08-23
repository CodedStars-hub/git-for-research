import {
  commitArtifactVersion,
  commitChanges,
  compareCommits,
  completeMerge,
  createBranch,
  getVersioningState,
  prepareMerge,
  prepareReviewedMerge,
} from "@/lib/versioning/service";

export const runtime = "nodejs";

interface RequestBody {
  action?: string;
  workspaceId?: string;
  branchId?: string;
  targetBranchId?: string;
  incomingBranchId?: string;
  reviewId?: string;
  fromCommitId?: string;
  beforeCommitId?: string;
  afterCommitId?: string;
  name?: string;
  message?: string;
  edits?: Array<{ artifactId: string; contentText: string }>;
  artifactId?: string;
  artifactType?: "pdf" | "chat";
  contentText?: string;
  resolutions?: Array<{
    artifactId: string;
    choice: "ours" | "theirs" | "manual";
    contentText?: string;
  }>;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = required(
      url.searchParams.get("workspaceId") ?? undefined,
      "Workspace ID",
    );
    const branchId = url.searchParams.get("branchId") ?? undefined;
    return Response.json(await getVersioningState(workspaceId, branchId));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const workspaceId = required(body.workspaceId, "Workspace ID");

    switch (body.action) {
      case "commit-artifact-version":
        if (body.artifactType !== "pdf" && body.artifactType !== "chat") {
          throw new Error("Artifact type must be PDF or ChatGPT export.");
        }
        return Response.json(
          await commitArtifactVersion({
            workspaceId,
            branchId: required(body.branchId, "Branch ID"),
            message: required(body.message, "Commit message"),
            update: {
              artifactId: required(body.artifactId, "Artifact ID"),
              artifactType: body.artifactType,
              contentText: required(body.contentText, "Artifact content"),
            },
          }),
        );
      case "commit":
        return Response.json(
          await commitChanges({
            workspaceId,
            branchId: body.branchId,
            message: required(body.message, "Commit message"),
            edits: body.edits ?? [],
          }),
        );
      case "create-branch":
        return Response.json(
          await createBranch({
            workspaceId,
            name: required(body.name, "Branch name"),
            fromCommitId: required(body.fromCommitId, "Source commit"),
          }),
        );
      case "compare":
        return Response.json(
          await compareCommits(
            workspaceId,
            required(body.beforeCommitId, "Before commit"),
            required(body.afterCommitId, "After commit"),
          ),
        );
      case "prepare-merge":
        return Response.json(
          await prepareMerge({
            workspaceId,
            targetBranchId: required(body.targetBranchId, "Target branch"),
            incomingBranchId: required(
              body.incomingBranchId,
              "Incoming branch",
            ),
          }),
        );
      case "prepare-reviewed-merge":
        return Response.json(
          await prepareReviewedMerge({
            workspaceId,
            reviewId: required(body.reviewId, "Review ID"),
            sourceBranchId: required(body.incomingBranchId, "Source branch"),
            targetBranchId: required(body.targetBranchId, "Target branch"),
          }),
        );
      case "complete-merge":
        return Response.json(
          await completeMerge({
            workspaceId,
            targetBranchId: required(body.targetBranchId, "Target branch"),
            incomingBranchId: required(
              body.incomingBranchId,
              "Incoming branch",
            ),
            message: required(body.message, "Merge commit message"),
            resolutions: body.resolutions ?? [],
          }),
        );
      default:
        throw new Error("Unsupported versioning action.");
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 400 },
    );
  }
}
