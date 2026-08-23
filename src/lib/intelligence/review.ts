export function normalizeResolutionReason(reason: string): string | null {
  const normalized = reason.trim();
  return normalized || null;
}
