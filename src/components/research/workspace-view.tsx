"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CollaboratorPresence, ResearcherIdentity } from "@/lib/collaboration/session";
import { parseChatGptJson } from "@/lib/ingestion/chatgpt";
import { listArtifacts } from "@/lib/research/artifacts";
import { getWorkspace } from "@/lib/research/workspaces";
import type { VersioningState } from "@/lib/versioning/types";
import type { Artifact, Workspace } from "@/types/database";
import { CollaborativeEditor } from "@/components/workspace/collaborative-editor";
import { RetrievalPanel } from "@/components/workspace/retrieval-panel";
import { SinceLeftPanel } from "@/components/workspace/since-left-panel";
import { AddArtifactForm } from "./add-artifact-form";
import { VersionControlPanel } from "./version-control-panel";
import { ResearchIntelligencePanel } from "./research-intelligence-panel";
import { ActionFeedback, type FeedbackTone } from "@/components/action-feedback";

type View = "artifacts" | "history" | "branches" | "reviews" | "ci" | "ask" | "search" | "commit";
const tabs: { id: View; label: string }[] = [{ id: "artifacts", label: "Artifacts" }, { id: "history", label: "History" }, { id: "branches", label: "Branches" }, { id: "reviews", label: "Reviews" }, { id: "ci", label: "Research CI" }, { id: "ask", label: "Assistant" }];
const icons = { markdown: "◇", pdf: "▣", chat: "◫" };

async function getVersioning(workspaceId: string, branchId?: string) {
  const query = new URLSearchParams({ workspaceId });
  if (branchId) query.set("branchId", branchId);
  const response = await fetch(`/api/versioning?${query}`);
  const result = (await response.json()) as VersioningState & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Could not load version history.");
  return result;
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [state, setState] = useState<VersioningState | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState("");
  const [view, setView] = useState<View>("artifacts");
  const [showForm, setShowForm] = useState(false);
  const [workingContent, setWorkingContent] = useState<string | null>(null);
  const [presence, setPresence] = useState<CollaboratorPresence[]>([]);
  const [identity, setIdentity] = useState<ResearcherIdentity>(() => typeof window !== "undefined" && localStorage.getItem("git-for-research:identity") === "Researcher 2" ? "Researcher 2" : "Harshita");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [mergeRequest, setMergeRequest] = useState<{ sourceBranchId: string; targetBranchId: string; reviewId: string } | null>(null);
  const [historyCommitId, setHistoryCommitId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: FeedbackTone; title: string; detail?: string; next?: string } | null>(null);
  const [branchSwitching, setBranchSwitching] = useState(false);

  const reload = useCallback(async (branchId?: string) => {
    const [nextWorkspace, nextArtifacts, nextState] = await Promise.all([getWorkspace(workspaceId), listArtifacts(workspaceId), getVersioning(workspaceId, branchId)]);
    setWorkspace(nextWorkspace); setArtifacts(nextArtifacts); setState(nextState); setSelectedBranchId(nextState.selectedBranch?.id ?? null);
    return nextArtifacts;
  }, [workspaceId]);

  const refreshVersioning = useCallback(async (branchId?: string) => {
    const nextState = await getVersioning(workspaceId, branchId);
    setState(nextState);
    setSelectedBranchId(nextState.selectedBranch?.id ?? null);
    return nextState;
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    void Promise.all([getWorkspace(workspaceId), listArtifacts(workspaceId), getVersioning(workspaceId)])
      .then(([nextWorkspace, nextArtifacts, nextState]) => {
        if (!active) return;
        setWorkspace(nextWorkspace); setArtifacts(nextArtifacts); setState(nextState); setSelectedBranchId(nextState.selectedBranch?.id ?? null);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load workspace."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);
  const selected = useMemo(() => state?.snapshot.find((item) => item.artifactId === artifactId) ?? null, [artifactId, state]);
  const onWorkingChange = useCallback((id: string, content: string) => { if (id === artifactId) setWorkingContent(content); }, [artifactId]);
  const openTab = (next: View) => { setShowForm(false); setView(next); if (next === "artifacts") setArtifactId(""); };
  const selectBranch = useCallback(async (branchId: string) => {
    setBranchSwitching(true); setNotice(null);
    try {
      const nextState = await refreshVersioning(branchId);
      setNotice({ tone: "info", title: `Switched to ${nextState.selectedBranch?.name ?? "branch"}`, detail: "Commits and repository context now use this branch." });
    } catch (reason) {
      setNotice({ tone: "error", title: "Could not switch branch", detail: reason instanceof Error ? reason.message : "Try again." });
    } finally { setBranchSwitching(false); }
  }, [refreshVersioning]);
  if (loading) return <main className="grid min-h-screen place-items-center bg-[#090a0c] text-sm text-zinc-500">Loading workspace…</main>;
  if (error || !workspace || !state) return <main className="min-h-screen bg-[#090a0c] p-8 text-zinc-300"><Link href="/" className="text-indigo-400">← Workspaces</Link><p className="mt-6 text-red-400">{error ?? "Workspace not found."}</p></main>;
  const versioningProps = { workspaceId, state, refreshVersioning, workingEdit: selected?.type === "markdown" && workingContent !== null ? { artifactId: selected.artifactId, contentText: workingContent } : null, onProtectedMain: () => setView("branches"), requestedMerge: mergeRequest, requestedCommitId: historyCommitId, onCommitComplete: () => { setWorkingContent(null); setRefreshToken((value) => value + 1); } };

  return <main className="flex min-h-screen flex-col bg-[#090a0c] text-zinc-200">
    <header className="flex h-14 items-center gap-4 border-b border-[#30363d] bg-[#010409] px-4">
      <Link href="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-950">G</span>Git for Research</Link>
      <button onClick={() => openTab("search")} className="mx-auto flex h-8 w-full max-w-lg items-center justify-between rounded-md border border-[#30363d] bg-[#0d1117] px-3 text-sm text-[#8b949e] hover:border-[#58a6ff]"><span>Search this repository</span><kbd className="rounded border border-[#30363d] px-1.5 text-xs">/</kbd></button>
      <div className="flex shrink-0 items-center gap-2"><div className="hidden -space-x-1 sm:flex">{presence.slice(0, 3).map((person) => <span key={person.identity} title={`${person.identity} · ${person.status}`} className="grid size-6 place-items-center rounded-full border-2 border-[#010409] bg-[#1f6feb] text-[10px] font-medium">{person.identity === "Harshita" ? "H" : "R2"}</span>)}</div><select aria-label="Demo researcher identity" value={identity} onChange={(event) => { const next = event.target.value as ResearcherIdentity; setIdentity(next); localStorage.setItem("git-for-research:identity", next); }} className="h-8 rounded-md border border-[#30363d] bg-[#161b22] px-2 text-sm"><option>Harshita</option><option>Researcher 2</option></select></div>
    </header>
    <section className="border-b border-[#30363d] bg-[#0d1117] px-4 pt-5 sm:px-7"><div className="mx-auto max-w-[1500px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-xl leading-6"><span className="font-normal text-[#8b949e]">Harshita</span><span className="text-[#8b949e]">/</span><h1 className="font-semibold text-[#f0f6fc]">{workspace.name}</h1></div><p className="mt-1 text-sm text-[#8b949e]">Versioned research repository</p></div><div className="flex flex-wrap gap-2"><select aria-label="Current branch" value={selectedBranchId ?? ""} onChange={(event) => void selectBranch(event.target.value)} className="h-8 rounded-md border border-[#30363d] bg-[#21262d] px-3 font-mono text-xs"><option value="">main</option>{state?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><button onClick={() => { setShowForm(true); setArtifactId(""); setView("artifacts"); }} className="h-8 rounded-md border border-[#30363d] bg-[#21262d] px-3 text-sm font-medium hover:bg-[#30363d]">Add Artifact</button><button onClick={() => openTab("commit")} className="h-8 rounded-md bg-[#238636] px-3 text-sm font-semibold text-white hover:bg-[#2ea043]">Commit</button></div></div>
      <nav className="mt-4 flex gap-1 overflow-x-auto">{tabs.map((tab) => <button key={tab.id} onClick={() => openTab(tab.id)} className={`h-9 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${view === tab.id ? "border-[#58a6ff] text-[#f0f6fc]" : "border-transparent text-[#8b949e] hover:text-[#f0f6fc]"}`}>{tab.label}</button>)}</nav>
    </div></section>
    <div className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-7">
      {branchSwitching && <div className="mb-4"><ActionFeedback tone="info" title="Switching branch…" detail="Updating repository context." /></div>}
      {!branchSwitching && notice && <div className="mb-4"><ActionFeedback {...notice} /></div>}
      {showForm ? <div className="max-w-3xl [&_form]:border-white/10 [&_form]:bg-[#111318] [&_input]:bg-[#0d0f12] [&_input]:text-zinc-200 [&_select]:bg-[#0d0f12] [&_textarea]:bg-[#0d0f12]"><AddArtifactForm workspaceId={workspaceId} onCreated={async (created) => { const items = await reload(); setArtifactId(items[0]?.id ?? ""); setShowForm(false); setRefreshToken((value) => value + 1); setNotice({ tone: "success", title: created.name + " added", detail: created.type + " artifact and its first immutable version were saved.", next: "Create a commit to include it in repository history." }); }} onCancel={() => setShowForm(false)} /></div>
      : view === "artifacts" && !selected ? <ArtifactList artifacts={artifacts} state={state} onOpen={setArtifactId} onNewBranch={() => setView("branches")} />
      : view === "artifacts" && selected ? <div className="grid min-h-[640px] overflow-hidden rounded-md border border-white/8 bg-[#0c0d10] xl:grid-cols-[210px_minmax(0,1fr)_260px]">
        <aside className="border-r border-white/8 p-3"><button onClick={() => setArtifactId("")} className="mb-3 text-xs text-zinc-500">← All artifacts</button>{artifacts.map((artifact) => <button key={artifact.id} onClick={() => { setArtifactId(artifact.id); setWorkingContent(null); }} className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${artifactId === artifact.id ? "bg-white/8 text-zinc-100" : "text-zinc-500"}`}><span className="w-7 text-xs">{icons[artifact.type]}</span><span className="truncate">{artifact.name}</span></button>)}</aside>
        <section className="min-w-0 bg-[#0d0f12]">{selected.type === "markdown" ? <CollaborativeEditor key={`${selected.artifactId}:${identity}:${state?.selectedBranch?.id ?? "main"}`} workspaceId={workspaceId} artifact={selected} identity={identity} onWorkingChange={onWorkingChange} onPresenceChange={setPresence} /> : <div className="p-6"><div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-base font-semibold">{selected.name}</h2>{state?.selectedBranch && (state.selectedBranch.name === "main" && state.selectedBranch.head_commit_id ? <button onClick={() => setView("branches")} className="h-8 rounded-md bg-[#238636] px-3 text-sm font-semibold text-white">Create branch to update</button> : <ArtifactVersionUpload workspaceId={workspaceId} branchId={state.selectedBranch.id} artifact={selected} onCommitted={async () => { const items = await reload(state.selectedBranch?.id); setArtifactId(items.find((item) => item.id === selected.artifactId)?.id ?? selected.artifactId); setRefreshToken((value) => value + 1); }} />)}</div><pre className="whitespace-pre-wrap rounded-md border border-white/8 bg-[#111318] p-4 font-mono text-xs leading-6 text-zinc-400">{selected.contentText}</pre></div>}</section>
        <aside className="overflow-y-auto border-l border-white/8">{state?.selectedBranch && <SinceLeftPanel workspaceId={workspaceId} branchId={state.selectedBranch.id} identity={identity} refreshKey={refreshToken} />}<div className="p-4"><h3 className="text-sm font-semibold text-zinc-300">Live collaborators</h3><div className="mt-2 space-y-2">{presence.length ? presence.map((person) => <div key={person.identity} className="flex items-center gap-2 text-xs"><span className={`size-1.5 rounded-full ${person.status === "editing" ? "bg-amber-400" : "bg-emerald-400"}`} /><span>{person.identity}</span><span className="ml-auto text-zinc-600">{person.status}</span></div>) : <p className="text-xs text-zinc-600">Open a Markdown artifact to join.</p>}</div></div><div className="border-t border-white/8 p-4"><h3 className="text-sm font-semibold text-zinc-300">Recent commits</h3><div className="mt-2 space-y-1">{state?.commits.slice(0, 4).map((commit) => <button key={commit.id} onClick={() => { setHistoryCommitId(commit.id); setView("history"); }} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"><span className="block truncate text-zinc-300">{commit.message}</span><code className="text-[#58a6ff]">{commit.id.slice(0, 7)}</code></button>)}{!state?.commits.length && <p className="text-xs text-zinc-600">No commits yet.</p>}</div></div><div className="border-t border-white/8 p-4"><h3 className="text-sm font-semibold text-zinc-300">Artifact metadata</h3><p className="mt-2 text-xs text-zinc-500">{selected.type} · <span className="font-mono">{selected.artifactVersionId.slice(0, 7)}</span></p></div></aside>
      </div>
      : view === "search" || view === "ask" ? <RetrievalPanel key={`${view}:${state?.selectedBranch?.id ?? "no-branch"}`} workspaceId={workspaceId} mode={view} branchId={state?.selectedBranch?.id ?? null} branchName={state?.selectedBranch?.name ?? null} headCommitId={state?.selectedBranch?.head_commit_id ?? null} artifactCount={state?.selectedBranch?.head_commit_id ? state.snapshot.length : 0} />
      : view === "reviews" || view === "ci" ? <ResearchIntelligencePanel workspaceId={workspaceId} branches={state?.branches ?? []} selectedBranchId={selectedBranchId} mode={view} onContinueToMerge={(sourceBranchId, targetBranchId, reviewId) => { setMergeRequest({ sourceBranchId, targetBranchId, reviewId }); setSelectedBranchId(targetBranchId); setView("branches"); }} />
      : <div className="mx-auto max-w-5xl [&_.bg-white]:bg-[#0d1117] [&_.bg-slate-50]:bg-[#161b22] [&_.text-slate-950]:text-[#f0f6fc] [&_.text-slate-700]:text-[#c9d1d9] [&_.text-slate-600]:text-[#8b949e] [&_.text-slate-500]:text-[#8b949e] [&_.text-slate-400]:text-[#6e7681] [&_.border-slate-200]:border-[#30363d] [&_.border-slate-300]:border-[#30363d] [&_input]:bg-[#0d1117] [&_input]:text-zinc-200 [&_select]:bg-[#21262d] [&_select]:text-zinc-200 [&_textarea]:bg-[#0d1117] [&_textarea]:text-zinc-200"><VersionControlPanel key={`${view}:${mergeRequest?.reviewId ?? state.selectedBranch?.id ?? "none"}`} {...versioningProps} mode={view === "branches" ? "branches" : view === "commit" ? "commit" : "history"} /></div>}
    </div>
  </main>;
}

function ArtifactVersionUpload({ workspaceId, branchId, artifact, onCommitted }: { workspaceId: string; branchId: string; artifact: NonNullable<VersioningState["snapshot"][number]>; onCommitted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError(artifact.type === "pdf" ? "Select a PDF file." : "Select a ChatGPT JSON file."); return; }
    if (!message.trim()) { setError("Commit message is required."); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      let contentText: string;
      if (artifact.type === "pdf") {
        const body = new FormData(); body.set("file", file);
        const extraction = await fetch("/api/ingestion/pdf", { method: "POST", body });
        const result = (await extraction.json()) as { text?: string; error?: string };
        if (!extraction.ok || !result.text) throw new Error(result.error ?? "PDF extraction failed.");
        contentText = result.text;
      } else {
        if (!(file.type === "application/json" || file.name.toLowerCase().endsWith(".json"))) throw new Error("Unsupported file type. Select a JSON file.");
        contentText = parseChatGptJson(await file.text());
      }
      const response = await fetch("/api/versioning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit-artifact-version", workspaceId, branchId, artifactId: artifact.artifactId, artifactType: artifact.type, contentText, message }) });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not commit artifact version.");
      setOpen(false); setFile(null); setMessage(""); setSuccess(`New version committed as ${result.id?.slice(0, 8) ?? "a new commit"}.`); await onCommitted();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not commit artifact version."); }
    finally { setSaving(false); }
  }

  if (!open) return <div className="grid justify-items-end gap-2"><button onClick={() => setOpen(true)} className="h-8 rounded-md bg-[#238636] px-3 text-sm font-semibold text-white hover:bg-[#2ea043]">Upload New Version</button>{success && <ActionFeedback tone="success" title={success} next="Review the new commit or create a Research Review." />}</div>;
  return <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-white/10 bg-[#161b22] p-3"><input type="file" accept={artifact.type === "pdf" ? ".pdf,application/pdf" : ".json,application/json"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={saving} className="block w-full text-xs text-zinc-400"/><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Required commit message" disabled={saving} className="mt-2 h-8 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 text-sm"/>{error && <p className="mt-2 text-xs text-red-400">{error}</p>}<div className="mt-2 flex gap-2"><button disabled={saving} className="h-8 rounded-md bg-[#238636] px-3 text-xs font-semibold disabled:opacity-50">{saving ? "Committing…" : "Commit version"}</button><button type="button" onClick={() => setOpen(false)} disabled={saving} className="h-8 px-2 text-xs text-zinc-500">Cancel</button></div></form>;
}

function ArtifactList({ artifacts, state, onOpen, onNewBranch }: { artifacts: Artifact[]; state: VersioningState | null; onOpen: (id: string) => void; onNewBranch: () => void }) {
  const latest = state?.commits[0];
  return <section><div className="mb-3 flex h-8 items-center gap-2"><span className="flex h-8 items-center rounded-md border border-[#30363d] bg-[#21262d] px-3 font-mono text-xs">{state?.selectedBranch?.name ?? "main"} ▾</span><button onClick={onNewBranch} className="h-8 rounded-md border border-[#30363d] bg-[#21262d] px-3 text-sm font-medium hover:bg-[#30363d]">New Branch</button><span className="ml-auto text-xs text-[#8b949e]">{artifacts.length} artifacts</span></div><div className="overflow-x-auto rounded-md border border-[#30363d] bg-[#0d1117]"><div className="flex min-w-[560px] border-b border-[#30363d] bg-[#161b22] px-4 py-2 text-xs"><span className="font-medium text-[#f0f6fc]">{latest?.message ?? "Working tree"}</span><code className="ml-auto text-[#8b949e]">{latest?.id.slice(0, 7)}</code></div>{artifacts.map((artifact) => <button key={artifact.id} onClick={() => onOpen(artifact.id)} className="grid min-h-10 w-full min-w-[560px] grid-cols-[24px_minmax(160px,1fr)_minmax(180px,1.5fr)_auto] items-center gap-3 border-b border-[#21262d] px-4 py-2 text-left text-sm last:border-0 hover:bg-[#161b22]"><span className="text-xs text-[#8b949e]">{icons[artifact.type]}</span><span className="min-w-0 truncate"><span className="font-medium text-[#58a6ff]">{artifact.name}</span><span className="ml-2 text-xs text-[#8b949e]">{artifact.type}</span></span><span className="truncate text-[#8b949e]">{state?.snapshot.some((item) => item.artifactId === artifact.id) ? latest?.message ?? "Versioned artifact" : "Awaiting first commit"}</span><span className="text-xs text-[#8b949e]">{new Date(artifact.created_at).toLocaleDateString()}</span></button>)}{!artifacts.length && <p className="px-4 py-6 text-center text-sm text-[#8b949e]">No artifacts yet. Use Add Artifact above to create one.</p>}</div></section>;
}
