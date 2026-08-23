"use client";

import { useEffect, useState } from "react";
import type { ResearcherIdentity } from "@/lib/collaboration/session";
import type { ArtifactComparison, VersioningState } from "@/lib/versioning/types";

interface SinceLeftData {
  headId: string;
  commits: VersioningState["commits"];
  artifacts: ArtifactComparison[];
  firstVisit: boolean;
}

export function SinceLeftPanel({
  workspaceId,
  branchId,
  identity,
  refreshKey,
}: {
  workspaceId: string;
  branchId: string;
  identity: ResearcherIdentity;
  refreshKey: number;
}) {
  const [data, setData] = useState<SinceLeftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markedSeen, setMarkedSeen] = useState(false);
  const storageKey = `git-for-research:last-seen:${identity}:${workspaceId}:${branchId}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      const query = new URLSearchParams({ workspaceId, branchId });
      const response = await fetch(`/api/versioning?${query}`);
      const state = (await response.json()) as VersioningState & { error?: string };
      if (!response.ok) throw new Error(state.error ?? "Could not load activity.");
      const headId = state.selectedBranch?.head_commit_id;
      if (!headId) {
        if (active) setData(null);
        return;
      }
      const lastSeen = localStorage.getItem(storageKey);
      const commits: VersioningState["commits"] = [];
      const commitMap = new Map(state.commits.map((commit) => [commit.id, commit]));
      const visited = new Set<string>();
      const queue = [headId];
      while (queue.length) {
        const id = queue.shift();
        if (!id || id === lastSeen || visited.has(id)) continue;
        visited.add(id);
        const commit = commitMap.get(id);
        if (!commit) continue;
        commits.push(commit);
        if (commit.parent_commit_id) queue.push(commit.parent_commit_id);
        if (commit.merge_parent_commit_id) queue.push(commit.merge_parent_commit_id);
      }

      let artifacts: ArtifactComparison[] = [];
      if (lastSeen && commitMap.has(lastSeen) && lastSeen !== headId) {
        const compareResponse = await fetch("/api/versioning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "compare",
            workspaceId,
            beforeCommitId: lastSeen,
            afterCommitId: headId,
          }),
        });
        artifacts = (await compareResponse.json()) as ArtifactComparison[];
      }
      if (active) {
        setData({ headId, commits, artifacts, firstVisit: !lastSeen });
      }
    })().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Could not load activity.");
    });
    return () => {
      active = false;
    };
  }, [branchId, identity, refreshKey, storageKey, workspaceId]);

  return (
    <div className="border-b border-white/8 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Since you left</h3>
        {data && (
          <button
            onClick={() => {
              localStorage.setItem(storageKey, data.headId);
              setData({ ...data, commits: [], artifacts: [], firstVisit: false });
              setMarkedSeen(true);
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300"
          >
            Mark seen
          </button>
        )}
      </div>
      {markedSeen && <p role="status" aria-live="polite" className="mt-3 text-xs text-emerald-400">✓ Current commit marked as seen.</p>}
      {error ? (
        <p className="mt-3 text-xs text-red-400">{error}</p>
      ) : !data ? (
        <p className="mt-3 text-xs text-zinc-600">No branch activity yet.</p>
      ) : data.firstVisit ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500">First recorded visit for {identity}. Current head is {data.headId.slice(0, 8)}.</p>
      ) : !data.commits.length ? (
        <p className="mt-3 text-xs text-zinc-600">You are caught up.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-500">{data.commits.length} commit{data.commits.length === 1 ? "" : "s"} since your last view</p>
          {data.commits.slice(0, 5).map((commit) => (
            <div key={commit.id} className="text-xs">
              <code className="text-zinc-600">{commit.id.slice(0, 7)}</code>{" "}
              <span className="text-zinc-300">{commit.message}</span>
            </div>
          ))}
          {data.artifacts.filter((artifact) => artifact.status !== "unchanged").length > 0 && (
            <div className="border-t border-white/8 pt-3 text-xs text-zinc-500">
              Changed: {data.artifacts.filter((artifact) => artifact.status !== "unchanged").map((artifact) => artifact.name).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
