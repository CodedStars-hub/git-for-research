import { analyzeBranches, compareKnowledge, createReview, listReviews, loadReview, recordResolutionReason, rerunReviewCi } from "@/lib/intelligence/service";

export const runtime = "nodejs";

function required(value: string | undefined, label: string) { if (!value) throw new Error(`${label} is required.`); return value; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const workspaceId = required(url.searchParams.get("workspaceId") ?? undefined, "Workspace ID");
    return Response.json(await listReviews(workspaceId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string; workspaceId?: string; sourceBranchId?: string; targetBranchId?: string; beforeCommitId?: string; afterCommitId?: string; reviewId?: string; reason?: string };
    if (body.action === "record-reason") { const resolutionReason = await recordResolutionReason(required(body.reviewId, "Review ID"), body.reason ?? ""); return Response.json({ ok: true, resolutionReason }); }
    if (body.action === "load-review") return Response.json(await loadReview(required(body.reviewId, "Review ID")));
    if (body.action === "rerun-ci") return Response.json(await rerunReviewCi(required(body.reviewId, "Review ID")));
    if (body.action === "knowledge-diff") return Response.json(await compareKnowledge(required(body.workspaceId, "Workspace ID"), required(body.beforeCommitId, "Before commit"), required(body.afterCommitId, "After commit")));
    const workspaceId = required(body.workspaceId, "Workspace ID"); const source = required(body.sourceBranchId, "Source branch"); const target = required(body.targetBranchId, "Target branch");
    if (body.action === "analyze") return Response.json(await analyzeBranches(workspaceId, source, target));
    if (body.action === "create-review") return Response.json(await createReview(workspaceId, source, target));
    throw new Error("Unsupported research intelligence action.");
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 400 }); }
}
