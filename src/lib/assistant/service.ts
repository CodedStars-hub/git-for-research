import { buildResearchContext } from "./context";
import { validateAnswerCitations } from "./grounding";
import { generateGroundedAnswer, isAssistantProviderConfigured } from "./provider";
import type { AssistantResponse, ConversationMessage } from "./types";

export async function askResearchAssistant({
  workspaceId,
  branchId,
  question,
  conversationHistory,
}: {
  workspaceId: string;
  branchId: string;
  question: string;
  conversationHistory: ConversationMessage[];
}): Promise<AssistantResponse> {
  const context = await buildResearchContext({
    workspaceId,
    branchId,
    question,
    conversationHistory,
  });
  const fallback = context.groundedResponse;
  if (!isAssistantProviderConfigured() || !fallback.citations.length) {
    return fallback;
  }

  try {
    const generated = await generateGroundedAnswer(context, question);
    if (
      !generated ||
      !validateAnswerCitations(generated.answer, fallback.citations)
    ) {
      return {
        ...fallback,
        limitations: [
          ...fallback.limitations,
          "The generated response failed citation validation; grounded retrieval fallback was used.",
        ],
      };
    }
    const usedIndexes = new Set(
      [...generated.answer.matchAll(/\[(\d+)\]/g)].map((match) =>
        Number(match[1]),
      ),
    );
    return {
      ...fallback,
      answer: generated.answer,
      mode: "generated",
      citations: fallback.citations.filter((citation) =>
        usedIndexes.has(citation.citationIndex),
      ),
    };
  } catch {
    return {
      ...fallback,
      limitations: [
        ...fallback.limitations,
        "The generative provider was unavailable; grounded retrieval fallback was used.",
      ],
    };
  }
}
