"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  createWorkspace,
  listWorkspaces,
} from "@/lib/research/workspaces";
import type { Workspace } from "@/types/database";
import { ActionFeedback } from "@/components/action-feedback";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function HomeView() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void listWorkspaces()
      .then((result) => {
        if (active) setWorkspaces(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load workspaces.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const workspace = await createWorkspace(name);
      setWorkspaces((current) => [workspace, ...current]);
      setName("");
      setSuccess(`Workspace "${workspace.name}" created. Open it to add research artifacts.`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create workspace.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 text-zinc-200 sm:px-10">
      <header className="mb-10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-400">
          Git for Research
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Research workspaces
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-500">
          Collect source material and preserve its first immutable version.
        </p>
      </header>

      <form
        onSubmit={handleCreate}
        className="mb-10 flex flex-col gap-3 rounded-md border border-white/8 bg-[#111318] p-4 sm:flex-row"
      >
        <label className="sr-only" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New workspace name"
          className="min-w-0 flex-1 rounded border border-white/10 bg-[#0d0f12] px-3 py-2.5 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500"
          disabled={creating}
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </form>

      {success && <div className="mb-6"><ActionFeedback tone="success" title={success} next="Open the workspace and add your first artifact." /></div>}

      {error && (
        <div className="mb-6"><ActionFeedback tone="error" title="Could not create workspace" detail={error} /></div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading workspaces…</p>
      ) : workspaces.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/workspace/${workspace.id}`}
              className="group rounded-md border border-white/8 bg-[#111318] p-4 transition hover:border-white/15 hover:bg-[#14171c]"
            >
              <h2 className="text-sm font-medium text-zinc-200 group-hover:text-white">
                {workspace.name}
              </h2>
              <p className="mt-3 text-xs text-zinc-600">
                Created {formatDate(workspace.created_at)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-white/10 bg-[#111318] px-6 py-12 text-center text-sm text-zinc-600">
          No workspaces yet. Create one to begin.
        </div>
      )}
    </main>
  );
}
