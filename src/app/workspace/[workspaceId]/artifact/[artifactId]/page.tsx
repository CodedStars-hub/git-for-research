import { ArtifactDetailView } from "@/components/research/artifact-detail-view";

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ workspaceId: string; artifactId: string }>;
}) {
  const { workspaceId, artifactId } = await params;
  return (
    <ArtifactDetailView workspaceId={workspaceId} artifactId={artifactId} />
  );
}
