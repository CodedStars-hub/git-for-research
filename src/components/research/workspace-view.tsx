"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listArtifacts } from "@/lib/research/artifacts";
import { getWorkspace } from "@/lib/research/workspaces";
import type { Artifact, Workspace } from "@/types/database";
import { AddArtifactForm } from "./add-artifact-form";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

const typeLabels = {
  markdown: "Markdown / plaintext",
  pdf: "PDF",
  chat: "ChatGPT export",
};

async function loadWorkspaceData(workspaceId: string) {
  return Promise.all([getWorkspace(workspaceId), listArtifacts(workspaceId)]);
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void loadWorkspaceData(workspaceId)
      .then(([workspaceResult, artifactsResult]) => {
        if (!active) return;
        setWorkspace(workspaceResult);
        setArtifacts(artifactsResult);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load workspace.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function handleCreated() {
    const [workspaceResult, artifactsResult] =
      await loadWorkspaceData(workspaceId);
    setWorkspace(workspaceResult);
    setArtifacts(artifactsResult);
    setShowForm(false);
  }

  if (loading) {
    return <main className="mx-auto w-full max-w-5xl px-6 py-12 text-slate-500">Loading workspace…</main>;
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <Link href="/" className="text-sm font-medium text-indigo-600">← Workspaces</Link>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">{error}</div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <Link href="/" className="text-sm font-medium text-indigo-600">← Workspaces</Link>
        <p className="mt-6 text-slate-600">Workspace not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10">
      <Link href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">← Workspaces</Link>
      <header className="my-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Research workspace</p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">{workspace.name}</h1>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800">Add artifact</button>
        )}
      </header>

      {showForm && (
        <AddArtifactForm workspaceId={workspaceId} onCreated={handleCreated} onCancel={() => setShowForm(false)} />
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-950">Artifacts</h2>
        {artifacts.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {artifacts.map((artifact) => (
              <Link
                key={artifact.id}
                href={`/workspace/${workspaceId}/artifact/${artifact.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
              >
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{typeLabels[artifact.type]}</span>
                <h3 className="mt-4 font-semibold text-slate-950">{artifact.name}</h3>
                <p className="mt-2 text-sm text-slate-500">Created {formatDate(artifact.created_at)}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-500">No artifacts yet. Add your first source.</div>
        )}
      </section>
    </main>
  );
}
