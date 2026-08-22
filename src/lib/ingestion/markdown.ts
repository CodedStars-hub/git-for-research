export function normalizeMarkdown(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    throw new Error("Markdown or plaintext content cannot be empty.");
  }

  return normalized;
}

