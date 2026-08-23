import { supabase } from "@/lib/supabase/client";
import type { Artifact, ArtifactType, ArtifactVersion, Commit, CommitArtifact } from "@/types/database";
import { hasMeaningfulOverlap, meaningfulTerms } from "../assistant/query.js";

export interface CommitProvenance {
  id: string;
  shortHash: string;
  message: string;
}

export interface EvidenceResult {
  artifactId: string;
  artifactName: string;
  artifactType: ArtifactType;
  artifactVersionId: string;
  versionCreatedAt: string;
  isLatestVersion: boolean;
  contentHash: string;
  snippet: string;
  contextLabel: string | null;
  score: number;
  commits: CommitProvenance[];
}

function countOccurrences(content: string, term: string): number {
  let count = 0;
  let index = content.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

function snippetFor(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const indexes = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0);
  const matchIndex = indexes.length ? Math.min(...indexes) : 0;
  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(content.length, matchIndex + 600);
  return `${start ? "…" : ""}${content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()}${end < content.length ? "…" : ""}`;
}

function chatContext(content: string, terms: string[]): string | null {
  const lower = content.toLowerCase();
  const indexes = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const preceding = content.slice(0, indexes.length ? Math.min(...indexes) : 0);
  const conversation = [...preceding.matchAll(/CONVERSATION: ([^\n]+)/g)].at(-1)?.[1];
  const role = [...preceding.matchAll(/^(USER|ASSISTANT)$/gm)].at(-1)?.[1];
  return [conversation, role].filter(Boolean).join(" · ") || null;
}

interface SearchableVersion {
  artifact: Artifact;
  version: ArtifactVersion;
  isLatestVersion: boolean;
  commits: CommitProvenance[];
}

async function workspaceVersionContent(workspaceId: string): Promise<SearchableVersion[]> {
  const { data: artifactData, error: artifactError } = await supabase
    .from("artifacts")
    .select("id, workspace_id, name, type, created_at")
    .eq("workspace_id", workspaceId);
  if (artifactError) throw new Error(`Could not search artifacts: ${artifactError.message}`);
  const artifacts = artifactData as Artifact[];
  if (!artifacts.length) return [];

  const { data: versionData, error: versionError } = await supabase
    .from("artifact_versions")
    .select("id, artifact_id, content_text, content_hash, storage_path, created_at")
    .in("artifact_id", artifacts.map((artifact) => artifact.id))
    .order("created_at", { ascending: false });
  if (versionError) throw new Error(`Could not search content: ${versionError.message}`);

  const allVersions = versionData as ArtifactVersion[];
  if (!allVersions.length) return [];
  const latestIds = new Set<string>();
  const seenArtifacts = new Set<string>();
  for (const version of allVersions) {
    if (!seenArtifacts.has(version.artifact_id)) {
      latestIds.add(version.id);
      seenArtifacts.add(version.artifact_id);
    }
  }

  const versionIds = allVersions.map((version) => version.id);
  const [{ data: mappingData, error: mappingError }, { data: commitData, error: commitError }] = await Promise.all([
    supabase.from("commit_artifacts").select("commit_id, artifact_id, artifact_version_id").in("artifact_version_id", versionIds),
    supabase.from("commits").select("id, workspace_id, branch_id, parent_commit_id, merge_parent_commit_id, message, created_at").eq("workspace_id", workspaceId),
  ]);
  if (mappingError) throw new Error(`Could not load version provenance: ${mappingError.message}`);
  if (commitError) throw new Error(`Could not load commit provenance: ${commitError.message}`);

  const commitMap = new Map((commitData as Commit[]).map((commit) => [commit.id, commit]));
  const commitsByVersion = new Map<string, CommitProvenance[]>();
  for (const mapping of mappingData as CommitArtifact[]) {
    const commit = commitMap.get(mapping.commit_id);
    if (!commit) continue;
    const provenance = commitsByVersion.get(mapping.artifact_version_id) ?? [];
    provenance.push({ id: commit.id, shortHash: commit.id.slice(0, 7), message: commit.message });
    commitsByVersion.set(mapping.artifact_version_id, provenance);
  }

  const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const uniqueContent = new Set<string>();
  return allVersions.flatMap((version) => {
    const artifact = artifactMap.get(version.artifact_id);
    const dedupeKey = `${version.artifact_id}:${version.content_hash}`;
    if (!artifact || uniqueContent.has(dedupeKey)) return [];
    uniqueContent.add(dedupeKey);
    return [{ artifact, version, isLatestVersion: latestIds.has(version.id), commits: commitsByVersion.get(version.id) ?? [] }];
  });
}

export function rankVersionEvidence(content: SearchableVersion[], query: string, limit: number): EvidenceResult[] {
  const terms = meaningfulTerms(query);
  if (!terms.length) throw new Error("Enter at least one meaningful search term.");
  const phrase = query.trim().toLowerCase();
  const ranked = content
    .map(({ artifact, version, isLatestVersion, commits }) => {
      const lower = version.content_text.toLowerCase();
      if (!hasMeaningfulOverlap(version.content_text, terms)) return null;
      const matchedTerms = terms.filter((term) => countOccurrences(lower, term) > 0);
      const termScore = matchedTerms.reduce((score, term) => score + countOccurrences(lower, term), 0);
      const score = termScore + (phrase.length >= 3 && lower.includes(phrase) ? 5 : 0);
      if (!score) return null;
      return {
        artifactId: artifact.id, artifactName: artifact.name, artifactType: artifact.type,
        artifactVersionId: version.id, versionCreatedAt: version.created_at,
        isLatestVersion, contentHash: version.content_hash,
        snippet: snippetFor(version.content_text, terms),
        contextLabel: artifact.type === "chat" ? chatContext(version.content_text, terms) : null,
        score, commits,
      } satisfies EvidenceResult;
    })
    .filter((result): result is EvidenceResult => result !== null)
    .sort((left, right) => right.score - left.score || Number(right.isLatestVersion) - Number(left.isLatestVersion) || right.versionCreatedAt.localeCompare(left.versionCreatedAt) || left.artifactName.localeCompare(right.artifactName));

  const counts = new Map<string, number>();
  return ranked.filter((result) => {
    const count = counts.get(result.artifactId) ?? 0;
    if (count >= 3) return false;
    counts.set(result.artifactId, count + 1);
    return true;
  }).slice(0, limit);
}

export async function retrieveEvidence(
  workspaceId: string,
  query: string,
  limit = 12,
): Promise<EvidenceResult[]> {
  return rankVersionEvidence(await workspaceVersionContent(workspaceId), query, limit);
}
