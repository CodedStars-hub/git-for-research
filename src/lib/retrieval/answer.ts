import type { EvidenceResult } from "./retrieval";
import { meaningfulTerms } from "../assistant/query.js";

export type AnswerConfidence = "strong" | "mixed" | "insufficient";

export interface CitedEvidence extends EvidenceResult {
  citationIndex: number;
}

export interface EvidenceAwareAnswer {
  answer: string;
  confidence: AnswerConfidence;
  evidence: CitedEvidence[];
  limitations: string[];
}

const negativePattern = /\b(no|not|never|without|failed|avoid|reject|shouldn't|should not|must not|cannot|can't)\b/i;
const numberPattern = /(?:\b\d+(?:\.\d+)?\s?%|\$\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?(?:x|ms|s|kg|gb|mb)\b)/gi;

function tokens(text: string): Set<string> {
  return new Set(meaningfulTerms(text));
}

function sentences(text: string): string[] {
  return text
    .replace(/^…|…$/g, "")
    .replace(/CONVERSATION:\s*.*?(?=\bUSER\b|\bASSISTANT\b|$)/gi, "")
    .replace(/(?:^|\s)(?:USER|ASSISTANT)\s*:?\s*/gi, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 12);
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  return [...left].filter((token) => right.has(token)).length;
}

function bestSentence(snippet: string, questionTokens: Set<string>, question: string): string | null {
  const currentIntent = /\b(current|latest)\b/i.test(question);
  const historicalIntent = /\b(earlier|previous)\b/i.test(question);
  const ranked = sentences(snippet)
    .map((sentence, order) => ({
      sentence,
      order,
      score:
        overlap(tokens(sentence), questionTokens) * 4 +
        (numbers(sentence).length ? 2 : 0) +
        (/\b(recommend|require|conclude|suggest|indicate|report|measure|reduce|increase|improve|deploy)\w*\b/i.test(sentence) ? 1 : 0) +
        (currentIntent && /\b(revised|latest|current)\b/i.test(sentence) ? 4 : 0) -
        (currentIntent && /\b(initial|earlier|previous)\b/i.test(sentence) ? 4 : 0) +
        (historicalIntent && /\b(initial|earlier|previous)\b/i.test(sentence) ? 4 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  numberPattern.lastIndex = 0;
  return ranked[0]?.score ? ranked[0].sentence : null;
}

function similarity(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  return overlap(leftTokens, rightTokens) / Math.min(leftTokens.size, rightTokens.size);
}

function numbers(text: string): string[] {
  numberPattern.lastIndex = 0;
  return text.match(numberPattern) ?? [];
}

function conflicts(left: string, right: string): boolean {
  if (similarity(left, right) < 0.45) return false;
  if (negativePattern.test(left) !== negativePattern.test(right)) return true;
  const leftNumbers = numbers(left);
  const rightNumbers = numbers(right);
  return Boolean(
    leftNumbers.length &&
      rightNumbers.length &&
      leftNumbers.join("|") !== rightNumbers.join("|"),
  );
}

function withCitation(sentence: string, citationIndex: number): string {
  const normalized = sentence.replace(/[.!?]+$/, "");
  return `${normalized} [${citationIndex}].`;
}

export function composeEvidenceAwareAnswer(
  question: string,
  retrieved: EvidenceResult[],
): EvidenceAwareAnswer {
  const questionTokens = tokens(question);
  const historicalQuestion = /\b(earlier|previous)\b/i.test(question);
  const candidates = retrieved
    .map((result) => ({ result, sentence: bestSentence(result.snippet, questionTokens, question) }))
    .filter(
      (candidate): candidate is { result: EvidenceResult; sentence: string } =>
        candidate.sentence !== null &&
        overlap(tokens(candidate.sentence), questionTokens) > 0,
    )
    .sort(
      (left, right) =>
        (historicalQuestion
          ? Number(left.result.isLatestVersion) - Number(right.result.isLatestVersion)
          : Number(right.result.isLatestVersion) - Number(left.result.isLatestVersion)) ||
        right.result.score - left.result.score ||
        (historicalQuestion
          ? left.result.versionCreatedAt.localeCompare(right.result.versionCreatedAt)
          : right.result.versionCreatedAt.localeCompare(left.result.versionCreatedAt)),
    );

  if (!questionTokens.size || !candidates.length) {
    return {
      answer: "The repository does not contain enough evidence to answer this question.",
      confidence: "insufficient",
      evidence: [],
      limitations: ["No retrieved repository evidence directly supports an answer."],
    };
  }

  const selected = candidates.slice(0, 4).map((candidate, index) => ({
    ...candidate,
    cited: { ...candidate.result, citationIndex: index + 1 },
  }));
  let conflictPair: [number, number] | null = null;
  for (let left = 0; left < selected.length && !conflictPair; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      if (conflicts(selected[left].sentence, selected[right].sentence)) {
        conflictPair = [left, right];
        break;
      }
    }
  }

  if (conflictPair) {
    const [leftIndex, rightIndex] = conflictPair;
    const pair = [selected[leftIndex], selected[rightIndex]].sort((left, right) => {
      if (historicalQuestion) {
        const earlierSignal = Number(/\b(initial|earlier|previous)\b/i.test(right.sentence)) - Number(/\b(initial|earlier|previous)\b/i.test(left.sentence));
        return earlierSignal || Number(left.result.isLatestVersion) - Number(right.result.isLatestVersion) || left.result.versionCreatedAt.localeCompare(right.result.versionCreatedAt);
      }
      return Number(right.result.isLatestVersion) - Number(left.result.isLatestVersion);
    });
    const sameArtifact = pair[0].result.artifactId === pair[1].result.artifactId;
    const numericalEvolution =
      (sameArtifact || historicalQuestion) && numbers(pair[0].sentence).length > 0 && numbers(pair[1].sentence).length > 0;
    const answer = numericalEvolution && historicalQuestion
      ? `An earlier version reported: ${withCitation(pair[0].sentence, pair[0].cited.citationIndex)} The latest version reports: ${withCitation(pair[1].sentence, pair[1].cited.citationIndex)}`
      : numericalEvolution
      ? `The latest version reports: ${withCitation(pair[0].sentence, pair[0].cited.citationIndex)} An earlier version reported: ${withCitation(pair[1].sentence, pair[1].cited.citationIndex)}`
      : `The repository contains conflicting conclusions. One source states: ${withCitation(pair[0].sentence, pair[0].cited.citationIndex)} Another states: ${withCitation(pair[1].sentence, pair[1].cited.citationIndex)}`;
    return {
      answer,
      confidence: "mixed",
      evidence: pair.map((item) => item.cited),
      limitations: [
        numericalEvolution
          ? "The versions report materially different values; recency does not establish which claim is true."
          : "The repository contains materially conflicting evidence that requires researcher judgment.",
      ],
    };
  }

  const used = selected.slice(0, 3);
  const supportedStatements = used.map((item) => withCitation(item.sentence, item.cited.citationIndex));
  return {
    answer: supportedStatements.join(" "),
    confidence: "strong",
    evidence: used.map((item) => item.cited),
    limitations: [],
  };
}
