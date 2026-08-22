"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  createWorkspace,
  listWorkspaces,
} from "@/lib/research/workspaces";
import type { Workspace } from "@/types/database";

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

    try {
      const workspace = await createWorkspace(name);
      setWorkspaces((current) => [workspace, ...current]);
      setName("");
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
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10">
      <header className="mb-10">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Git for Research
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
          Research workspaces
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Collect source material and preserve its first immutable version.
        </p>
      </header>

      <form
        onSubmit={handleCreate}
        className="mb-10 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row"
      >
        <label className="sr-only" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New workspace name"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          disabled={creating}
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-slate-950 px-5 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500">Loading workspaces…</p>
      ) : workspaces.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/workspace/${workspace.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <h2 className="font-semibold text-slate-950 group-hover:text-indigo-700">
                {workspace.name}
              </h2>
              <p className="mt-3 text-sm text-slate-500">
                Created {formatDate(workspace.created_at)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-500">
          No workspaces yet. Create one to begin.
        </div>
      )}
    </main>
  );
}
