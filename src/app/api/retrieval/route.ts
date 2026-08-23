import { composeEvidenceAwareAnswer } from "@/lib/retrieval/answer";
import { retrieveEvidence } from "@/lib/retrieval/retrieval";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      workspaceId?: string;
      query?: string;
      limit?: number;
      mode?: "search" | "ask";
    };
    if (!body.workspaceId) throw new Error("Workspace ID is required.");
    if (!body.query?.trim()) throw new Error("Enter a search query.");
    const evidence = await retrieveEvidence(body.workspaceId, body.query, body.limit);
    return Response.json(
      body.mode === "ask"
        ? composeEvidenceAwareAnswer(body.query, evidence)
        : evidence,
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Retrieval failed." },
      { status: 400 },
    );
  }
}
