import { askResearchAssistant } from "@/lib/assistant/service";
import type { ConversationMessage } from "@/lib/assistant/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      workspaceId?: string;
      branchId?: string;
      question?: string;
      conversationHistory?: ConversationMessage[];
    };
    if (!body.workspaceId) throw new Error("Workspace ID is required.");
    if (!body.branchId) throw new Error("Branch ID is required.");
    if (!body.question?.trim()) throw new Error("Enter a research question.");
    return Response.json(
      await askResearchAssistant({
        workspaceId: body.workspaceId,
        branchId: body.branchId,
        question: body.question.trim(),
        conversationHistory: Array.isArray(body.conversationHistory)
          ? body.conversationHistory
          : [],
      }),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The research assistant could not respond.",
      },
      { status: 400 },
    );
  }
}
