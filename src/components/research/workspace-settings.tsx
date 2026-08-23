"use client";

import { FormEvent, useState } from "react";
import { ActionFeedback } from "@/components/action-feedback";
import type { CollaboratorPresence, ResearcherIdentity } from "@/lib/collaboration/session";
import { renameWorkspace } from "@/lib/research/workspaces";
import type { VersioningState } from "@/lib/versioning/types";
import type { Workspace } from "@/types/database";

export function WorkspaceSettings({ workspace, state, presence, identity, artifactCount, onRenamed }: { workspace: Workspace; state: VersioningState; presence: CollaboratorPresence[]; identity: ResearcherIdentity; artifactCount: number; onRenamed: (workspace: Workspace) => void }) {
  const [name, setName] = useState(workspace.name);
  const [renaming, setRenaming] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; title: string; detail?: string } | null>(null);
  const main = state.branches.find((branch) => branch.name === "main") ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (renaming) return;
    setRenaming(true);
    setFeedback(null);
    try {
      const renamed = await renameWorkspace(workspace.id, name);
      onRenamed(renamed);
      setName(renamed.name);
      setFeedback({ tone: "success", title: "Workspace renamed", detail: `Repository name updated to “${renamed.name}”.` });
    } catch (reason) {
      setFeedback({ tone: "error", title: "Could not rename workspace", detail: reason instanceof Error ? reason.message : "Try again." });
    } finally {
      setRenaming(false);
    }
  }

  return <section className="mx-auto max-w-5xl">
    <div className="mb-5 border-b border-[#30363d] pb-4"><h2 className="text-xl font-semibold text-zinc-100">Settings</h2><p className="mt-1 text-sm text-zinc-500">Manage this research repository without changing its integrity guarantees.</p></div>
    <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="h-fit rounded-md border border-[#30363d] bg-[#0d1117] p-2 text-sm"><a href="#general" className="block rounded px-3 py-2 font-medium text-zinc-200 hover:bg-[#21262d]">General</a><a href="#collaboration" className="block rounded px-3 py-2 text-zinc-500 hover:bg-[#21262d] hover:text-zinc-200">Collaboration</a><a href="#repository" className="block rounded px-3 py-2 text-zinc-500 hover:bg-[#21262d] hover:text-zinc-200">Repository</a><a href="#danger-zone" className="block rounded px-3 py-2 text-red-400/80 hover:bg-red-500/10">Danger Zone</a></nav>
      <div className="space-y-7">
        <section id="general" className="scroll-mt-20"><h3 className="border-b border-[#30363d] pb-2 text-base font-semibold text-zinc-100">General</h3><form onSubmit={submit} className="mt-4"><label htmlFor="repository-name" className="text-sm font-medium text-zinc-300">Repository name</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="repository-name" maxLength={120} value={name} onChange={(event) => { setName(event.target.value); setFeedback(null); }} disabled={renaming} className="h-9 min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#010409] px-3 text-sm text-zinc-100"/><button disabled={renaming || !name.trim() || name.trim() === workspace.name} className="h-9 rounded-md border border-[#30363d] bg-[#21262d] px-3 text-sm font-medium disabled:opacity-50">{renaming ? "Renaming…" : "Rename workspace"}</button></div><p className="mt-2 text-xs text-zinc-600">The workspace ID, URL, artifacts, branches, and history remain unchanged.</p></form>{feedback && <div className="mt-4"><ActionFeedback {...feedback} /></div>}
          <div className="mt-6"><h4 className="text-sm font-semibold text-zinc-300">Repository information</h4><dl className="mt-3 divide-y divide-[#21262d] rounded-md border border-[#30363d] bg-[#0d1117] text-sm">{[["Workspace ID", workspace.id], ["Created", new Date(workspace.created_at).toLocaleDateString()], ["Default branch", main?.name ?? "main"], ["Protected branch", "main · Protected"], ["Artifacts", String(artifactCount)], ["Branches", String(state.branches.length)]].map(([label, value]) => <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)]"><dt className="text-zinc-500">{label}</dt><dd className={label === "Workspace ID" ? "break-all font-mono text-xs text-zinc-300" : "text-zinc-300"}>{value}</dd></div>)}</dl></div>
        </section>

        <section id="collaboration" className="scroll-mt-20"><h3 className="border-b border-[#30363d] pb-2 text-base font-semibold text-zinc-100">Collaboration</h3><div className="mt-4 rounded-md border border-[#30363d] bg-[#0d1117] p-4"><h4 className="text-sm font-semibold text-zinc-300">Active collaborators</h4>{presence.length ? <div className="mt-3 space-y-2">{presence.map((person) => <div key={person.identity} className="flex items-center gap-2 text-sm"><span className={`size-2 rounded-full ${person.status === "editing" ? "bg-amber-400" : "bg-emerald-400"}`}/><span>{person.identity}</span><span className="ml-auto text-xs text-zinc-600">{person.status}</span></div>)}</div> : <p className="mt-2 text-sm text-zinc-500">No collaborators are currently present in an open Markdown artifact.</p>}<h4 className="mt-5 text-sm font-semibold text-zinc-300">Demo researcher identities</h4><div className="mt-2 flex gap-2"><span className={`rounded-md border px-2 py-1 text-xs ${identity === "Harshita" ? "border-[#58a6ff] text-zinc-200" : "border-[#30363d] text-zinc-500"}`}>Harshita</span><span className={`rounded-md border px-2 py-1 text-xs ${identity === "Researcher 2" ? "border-[#58a6ff] text-zinc-200" : "border-[#30363d] text-zinc-500"}`}>Researcher 2</span></div><p className="mt-3 text-xs leading-5 text-zinc-600">Persistent contributor attribution is not enabled in this hackathon prototype.</p></div></section>

        <section id="repository" className="scroll-mt-20"><h3 className="border-b border-[#30363d] pb-2 text-base font-semibold text-zinc-100">Repository</h3><dl className="mt-4 divide-y divide-[#21262d] rounded-md border border-[#30363d] bg-[#0d1117] text-sm">{[["Default branch", "main"], ["Protected branch", "main"], ["Research Review before protected-main merge", "Enabled"], ["Research CI required", "Enabled"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-zinc-400">{label}</dt><dd className="font-medium text-emerald-400">{value}</dd></div>)}</dl><p className="mt-2 text-xs text-zinc-600">Integrity settings are read-only and cannot be disabled here.</p></section>

        <section id="danger-zone" className="scroll-mt-20 rounded-md border border-red-500/40"><div className="border-b border-red-500/30 px-4 py-3"><h3 className="text-base font-semibold text-red-300">Danger Zone</h3></div><div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-sm font-semibold text-zinc-200">Delete workspace</h4><p className="mt-1 text-xs leading-5 text-zinc-500">Workspace deletion is disabled in this prototype to protect immutable research history.</p></div><button disabled className="h-8 shrink-0 rounded-md border border-red-500/40 px-3 text-sm font-medium text-red-400 opacity-60">Delete workspace</button></div></section>
      </div>
    </div>
  </section>;
}
