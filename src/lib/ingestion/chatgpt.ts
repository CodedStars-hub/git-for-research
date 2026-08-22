type JsonRecord = Record<string, unknown>;

interface NormalizedMessage {
  role: "USER" | "ASSISTANT";
  text: string;
  timestamp: number | null;
  order: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRole(message: JsonRecord): NormalizedMessage["role"] | null {
  const author = isRecord(message.author) ? message.author : null;
  const role =
    typeof message.role === "string"
      ? message.role
      : typeof author?.role === "string"
        ? author.role
        : null;

  if (role === "user") return "USER";
  if (role === "assistant") return "ASSISTANT";
  return null;
}

function textFromPart(part: unknown): string | null {
  if (typeof part === "string") return part;
  if (!isRecord(part)) return null;
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  return null;
}

function getText(message: JsonRecord): string | null {
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (!isRecord(message.content)) return null;

  if (typeof message.content.text === "string") {
    return message.content.text;
  }

  if (Array.isArray(message.content.parts)) {
    const parts = message.content.parts
      .map(textFromPart)
      .filter((part): part is string => Boolean(part?.trim()));
    return parts.length ? parts.join("\n") : null;
  }

  return null;
}

function normalizeMessage(
  candidate: unknown,
  order: number,
): NormalizedMessage | null {
  if (!isRecord(candidate)) return null;

  const message = isRecord(candidate.message) ? candidate.message : candidate;
  const role = getRole(message);
  const text = getText(message)?.replace(/\r\n?/g, "\n").trim();

  if (!role || !text) return null;

  const rawTimestamp = message.create_time ?? candidate.create_time;
  return {
    role,
    text,
    timestamp: typeof rawTimestamp === "number" ? rawTimestamp : null,
    order,
  };
}

function messagesFromConversation(conversation: unknown): NormalizedMessage[] {
  if (Array.isArray(conversation)) {
    return conversation
      .map(normalizeMessage)
      .filter((message): message is NormalizedMessage => message !== null);
  }

  if (!isRecord(conversation)) return [];

  let candidates: unknown[] = [];
  if (isRecord(conversation.mapping)) {
    candidates = Object.values(conversation.mapping);
  } else if (Array.isArray(conversation.messages)) {
    candidates = conversation.messages;
  } else {
    candidates = [conversation];
  }

  return candidates
    .map(normalizeMessage)
    .filter((message): message is NormalizedMessage => message !== null)
    .sort((left, right) => {
      if (left.timestamp !== null && right.timestamp !== null) {
        return left.timestamp - right.timestamp || left.order - right.order;
      }
      return left.order - right.order;
    });
}

export function parseChatGptExport(input: unknown): string {
  let conversations: unknown[];

  if (Array.isArray(input)) {
    const isMessageList = input.some(
      (item) => isRecord(item) && getRole(item) !== null,
    );
    conversations = isMessageList ? [input] : input;
  } else if (isRecord(input) && Array.isArray(input.conversations)) {
    conversations = input.conversations;
  } else {
    conversations = [input];
  }

  const normalizedConversations = conversations
    .map((conversation) => {
      const messages = messagesFromConversation(conversation);
      if (!messages.length) return null;

      const title =
        isRecord(conversation) && typeof conversation.title === "string"
          ? conversation.title.trim()
          : "";
      const transcript = messages
        .map((message) => `${message.role}\n${message.text}`)
        .join("\n\n");

      return title ? `CONVERSATION: ${title}\n\n${transcript}` : transcript;
    })
    .filter((conversation): conversation is string => conversation !== null);

  if (!normalizedConversations.length) {
    throw new Error(
      "This JSON file contains no usable user or assistant text messages.",
    );
  }

  return normalizedConversations.join("\n\n---\n\n");
}

export function parseChatGptJson(json: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  return parseChatGptExport(parsed);
}

