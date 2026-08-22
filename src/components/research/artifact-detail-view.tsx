"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getArtifactDetail,
  type ArtifactDetail,
} from "@/lib/research/artifacts";

const typeLabels = {
  markdown: "Markdown / plaintext",
  pdf: "PDF",
  chat: "ChatGPT export",
};

export function ArtifactDetailView({
  workspaceId,
  artifactId,
}: {
  workspaceId: string;
  artifactId: string;
}) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getArtifactDetail(workspaceId, artifactId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load artifact.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [artifactId, workspaceId]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 sm:px-10">
      <Link href={`/workspace/${workspaceId}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">← Workspace</Link>

      {loading ? (
        <p className="mt-8 text-slate-500">Loading artifact…</p>
      ) : error ? (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">{error}</div>
      ) : !detail ? (
        <p className="mt-8 text-slate-600">Artifact not found.</p>
      ) : (
        <article className="mt-8">
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{typeLabels[detail.artifact.type]}</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{detail.artifact.name}</h1>
          <p className="mt-3 text-sm text-slate-500">Immutable version created {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.version.created_at))}</p>
          <pre className="mt-8 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white p-6 font-mono text-sm leading-7 text-slate-800 shadow-sm">{detail.version.content_text}</pre>
        </article>
      )}
    </main>
  );
}

