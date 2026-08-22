import { supabase } from "@/lib/supabase/client";
import type {
  Artifact,
  ArtifactType,
  ArtifactVersion,
} from "@/types/database";

export interface ArtifactDetail {
  artifact: Artifact;
  version: ArtifactVersion;
}

interface CreateArtifactInput {
  workspaceId: string;
  name: string;
  type: ArtifactType;
  contentText: string;
}

async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function listArtifacts(workspaceId: string): Promise<Artifact[]> {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      "id, workspace_id, name, type, created_at, artifact_versions!inner(id)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load artifacts: ${error.message}`);

  return (data ?? []).map((artifact) => ({
    id: artifact.id,
    workspace_id: artifact.workspace_id,
    name: artifact.name,
    type: artifact.type,
    created_at: artifact.created_at,
  })) as Artifact[];
}

export async function getArtifactDetail(
  workspaceId: string,
  artifactId: string,
): Promise<ArtifactDetail | null> {
  const { data: artifactData, error: artifactError } = await supabase
    .from("artifacts")
    .select("id, workspace_id, name, type, created_at")
    .eq("id", artifactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (artifactError) {
    throw new Error(`Could not load artifact: ${artifactError.message}`);
  }
  if (!artifactData) return null;

  const { data: versionData, error: versionError } = await supabase
    .from("artifact_versions")
    .select(
      "id, artifact_id, content_text, content_hash, storage_path, created_at",
    )
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Could not load artifact text: ${versionError.message}`);
  }
  if (!versionData) return null;

  return {
    artifact: artifactData as Artifact,
    version: versionData as ArtifactVersion,
  };
}

export async function createArtifactWithFirstVersion({
  workspaceId,
  name,
  type,
  contentText,
}: CreateArtifactInput): Promise<ArtifactDetail> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Artifact name cannot be empty.");
  if (!contentText.trim()) throw new Error("Artifact content cannot be empty.");

  const contentHash = await hashContent(contentText);
  const { data: artifactData, error: artifactError } = await supabase
    .from("artifacts")
    .insert({ workspace_id: workspaceId, name: normalizedName, type })
    .select("id, workspace_id, name, type, created_at")
    .single();

  if (artifactError) {
    throw new Error(`Could not create artifact: ${artifactError.message}`);
  }

  const artifact = artifactData as Artifact;
  const { data: versionData, error: versionError } = await supabase
    .from("artifact_versions")
    .insert({
      artifact_id: artifact.id,
      content_text: contentText,
      content_hash: contentHash,
      storage_path: null,
    })
    .select(
      "id, artifact_id, content_text, content_hash, storage_path, created_at",
    )
    .single();

  if (versionError) {
    throw new Error(
      `The artifact was created, but its first immutable version could not be saved: ${versionError.message}`,
    );
  }

  return { artifact, version: versionData as ArtifactVersion };
}
