"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  createWorkspace,
  listWorkspaces,
} from "@/lib/research/workspaces";
import type { Workspace } from "@/types/database";
import { ActionFeedback } from "@/components/action-feedback";
import { FloatingAssistant } from "@/components/workspace/floating-assistant";

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
    <main className="min-h-screen bg-[#090a0c] text-zinc-200">
      <header className="flex h-14 items-center border-b border-[#30363d] bg-[#010409] px-4 sm:px-7">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-950">G</span>Git for Research</div>
          <span className="grid size-7 place-items-center rounded-full border border-[#30363d] bg-[#161b22] text-[10px] font-medium text-zinc-300" title="Harshita">H</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1120px] px-6 py-10 sm:px-8">
      <header className="mb-7 flex flex-col gap-4 border-b border-[#30363d] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Research workspaces</h1><p className="mt-2 max-w-2xl text-sm text-zinc-500">Version research artifacts, collaborate on branches, and review changes before they enter main.</p></div>
        <button type="button" onClick={() => document.getElementById("workspace-name")?.focus()} className="h-8 rounded-md bg-[#238636] px-3 text-sm font-semibold text-white hover:bg-[#2ea043]">+ New workspace</button>
      </header>

      <form
        onSubmit={handleCreate}
        className="mb-8 rounded-md border border-[#30363d] bg-[#0d1117] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">New workspace</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Workspace name"
          className="h-9 min-w-0 flex-1 rounded border border-[#30363d] bg-[#010409] px-3 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-[#58a6ff]"
          disabled={creating}
        />
        <button
          type="submit"
          disabled={creating}
          className="h-9 rounded bg-zinc-100 px-4 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create workspace"}
        </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">Creates a versioned research repository.</p>
      </form>

      {success && <div className="mb-6"><ActionFeedback tone="success" title={success} next="Open the workspace and add your first artifact." /></div>}

      {error && (
        <div className="mb-6"><ActionFeedback tone="error" title="Could not create workspace" detail={error} /></div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading workspaces…</p>
      ) : workspaces.length ? (
        <section><h2 className="mb-3 text-base font-semibold text-zinc-200">Your repositories</h2><div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/workspace/${workspace.id}`}
              className="group flex items-start gap-3 rounded-md border border-[#30363d] bg-[#161b22] p-4 transition hover:border-[#58a6ff]/60 hover:bg-[#1b2028]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 fill-none stroke-[#8b949e]" strokeWidth="1.7"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v14H6.5A2.5 2.5 0 0 1 4 16.5v-11Z"/><path d="M4 16.5A2.5 2.5 0 0 1 6.5 14H20M8 7h8"/></svg>
              <div><h3 className="text-[15px] font-semibold text-[#58a6ff] group-hover:underline">
                {workspace.name}
              </h3><p className="mt-1 text-xs text-zinc-500">Research repository</p><p className="mt-3 text-xs text-zinc-600">Created {formatDate(workspace.created_at)}</p></div>
            </Link>
          ))}
        </div></section>
      ) : (
        <div className="rounded-md border border-dashed border-[#30363d] bg-[#0d1117] px-6 py-10 text-center"><h2 className="text-sm font-semibold text-zinc-300">No research workspaces yet.</h2><p className="mt-2 text-sm text-zinc-600">Create your first research repository to start versioning artifacts.</p><button type="button" onClick={() => document.getElementById("workspace-name")?.focus()} className="mt-4 h-8 rounded-md bg-[#238636] px-3 text-sm font-semibold text-white">Create workspace</button></div>
      )}
      </div>
      <FloatingAssistant />
    </main>
  );
}
