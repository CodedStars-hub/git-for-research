import { WorkspaceView } from "@/components/research/workspace-view";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <WorkspaceView workspaceId={workspaceId} />;
}
