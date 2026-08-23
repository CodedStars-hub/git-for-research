import { diff3Merge, diffComm } from "node-diff3";

export type DiffKind = "unchanged" | "added" | "removed" | "modified";

export interface TextDiffChunk {
  kind: DiffKind;
  before: string;
  after: string;
}

export interface ThreeWayTextMerge {
  conflict: boolean;
  content: string | null;
}

function lines(content: string): string[] {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

export function diffText(before: string, after: string): TextDiffChunk[] {
  return diffComm(lines(before), lines(after)).map((region) => {
    const common = (region as typeof region & { common?: string[] }).common;
    const beforeLines = common ?? region.buffer1 ?? [];
    const afterLines = common ?? region.buffer2 ?? [];
    let kind: DiffKind;

    if (!beforeLines.length) kind = "added";
    else if (!afterLines.length) kind = "removed";
    else if (
      beforeLines.length === afterLines.length &&
      beforeLines.every((line, index) => line === afterLines[index])
    ) {
      kind = "unchanged";
    } else kind = "modified";

    return {
      kind,
      before: beforeLines.join("\n"),
      after: afterLines.join("\n"),
    };
  });
}

export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): ThreeWayTextMerge {
  if (ours === theirs) return { conflict: false, content: ours };
  if (ours === base) return { conflict: false, content: theirs };
  if (theirs === base) return { conflict: false, content: ours };

  const regions = diff3Merge(lines(ours), lines(base), lines(theirs), {
    excludeFalseConflicts: true,
  });
  const merged: string[] = [];

  for (const region of regions) {
    if (region.conflict) return { conflict: true, content: null };
    if (region.ok) merged.push(...region.ok);
  }

  return { conflict: false, content: merged.join("\n") };
}
