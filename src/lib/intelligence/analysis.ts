export type ExtractedClaim = { text: string; claimType: "factual" | "numerical" | "conclusion" };
export type KnowledgeChange = { category: "introduced" | "removed" | "modified" | "numerical"; before: string | null; after: string | null; artifactId: string; artifactName: string; };

const conclusionWords = /\b(conclude|conclusion|recommend|therefore|thus|should|decision|suggests?|indicates?)\b/i;
const factualWords = /\b(found|shows?|demonstrates?|measured|observed|reported|increased|decreased|reduced|improved|caused|results?|benchmark|performed|is|are|was|were)\b/i;
const numberPattern = /(?:\b\d+(?:\.\d+)?\s?%|\$\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?(?:x|ms|s|kg|gb|mb)\b)/gi;
const stop = new Set("a an and are as at be by for from has have in is it of on or that the this to was were will with".split(" "));

export function segmentSentences(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s+/gm, "").split(/(?<=[.!?])\s+|\n+/).map((value) => value.replace(/^[-*+]\s+/, "").trim()).filter(Boolean);
}

export function extractClaims(text: string): ExtractedClaim[] {
  const seen = new Set<string>();
  return segmentSentences(text).flatMap((sentence) => {
    if (sentence.length < 18 || sentence.length > 500 || /^(note|todo|example|references?)\s*:/i.test(sentence)) return [];
    const claimType = numberPattern.test(sentence) ? "numerical" : conclusionWords.test(sentence) ? "conclusion" : factualWords.test(sentence) ? "factual" : null;
    numberPattern.lastIndex = 0;
    const key = sentence.toLowerCase();
    if (!claimType || seen.has(key)) return [];
    seen.add(key); return [{ text: sentence, claimType }];
  });
}

export function meaningfulTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((token) => !stop.has(token)));
}

export function tokenSimilarity(a: string, b: string): number {
  const left = meaningfulTokens(a); const right = meaningfulTokens(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.min(left.size, right.size);
}

export function numbers(text: string): string[] { numberPattern.lastIndex = 0; return text.match(numberPattern) ?? []; }

export function diffClaims(before: ExtractedClaim[], after: ExtractedClaim[], artifactId: string, artifactName: string): KnowledgeChange[] {
  const unused = new Set(before.map((_, index) => index)); const changes: KnowledgeChange[] = [];
  for (const next of after) {
    const exact = before.findIndex((old) => old.text.toLowerCase() === next.text.toLowerCase());
    if (exact >= 0 && unused.has(exact)) { unused.delete(exact); continue; }
    let best = -1; let score = 0;
    for (const index of unused) { const current = tokenSimilarity(before[index].text, next.text); if (current > score) { score = current; best = index; } }
    if (best >= 0 && score >= 0.55) {
      const old = before[best]; unused.delete(best);
      changes.push({ category: numbers(old.text).join("|") !== numbers(next.text).join("|") && (numbers(old.text).length > 0 || numbers(next.text).length > 0) ? "numerical" : "modified", before: old.text, after: next.text, artifactId, artifactName });
    } else changes.push({ category: "introduced", before: null, after: next.text, artifactId, artifactName });
  }
  for (const index of unused) changes.push({ category: "removed", before: before[index].text, after: null, artifactId, artifactName });
  return changes;
}

export function likelyContradiction(a: string, b: string): { likely: boolean; reason: string } {
  if (tokenSimilarity(a, b) < 0.45) return { likely: false, reason: "Insufficient topic overlap." };
  const negative = /\b(no|not|never|without|failed|worse|lower|decreased|reject)\b/i;
  if (negative.test(a) !== negative.test(b)) return { likely: true, reason: "Shared topic with opposing or negating language." };
  const left = numbers(a); const right = numbers(b);
  if (left.length && right.length && left.join("|") !== right.join("|")) return { likely: true, reason: "Shared topic with materially different numerical statements." };
  return { likely: false, reason: "No deterministic contradiction signal." };
}

export function findEvidence(claim: string, candidates: Array<{ artifactVersionId: string; text: string }>, ownVersionId: string) {
  return candidates.filter((item) => item.artifactVersionId !== ownVersionId && item.text.trim().toLowerCase() !== claim.trim().toLowerCase()).map((item) => ({ ...item, score: tokenSimilarity(claim, item.text) })).filter((item) => item.score >= 0.6).sort((a, b) => b.score - a.score)[0] ?? null;
}

export function traverseDependencies(startIds: string[], edges: Array<{ sourceClaimId: string; dependentClaimId: string; relationship: string }>) {
  const direct = new Set<string>(); const downstream = new Set<string>(); const visited = new Set(startIds); let frontier = [...startIds]; let depth = 0;
  while (frontier.length) { const next: string[] = []; for (const source of frontier) for (const edge of edges) if (edge.sourceClaimId === source && !visited.has(edge.dependentClaimId)) { visited.add(edge.dependentClaimId); (depth === 0 ? direct : downstream).add(edge.dependentClaimId); next.push(edge.dependentClaimId); } frontier = next; depth += 1; }
  return { direct: [...direct], downstream: [...downstream] };
}

export interface ContradictionProvider { check(a: string, b: string): Promise<{ likely: boolean; reason: string } | null>; }
