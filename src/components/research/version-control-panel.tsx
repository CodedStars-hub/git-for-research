"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ArtifactComparison,
  MergePlan,
  VersioningState,
} from "@/lib/versioning/types";
import type { KnowledgeChange } from "@/lib/intelligence/analysis";
import { mergePlanIsCurrent } from "@/lib/versioning/policy";
import { ActionFeedback, type FeedbackTone } from "@/components/action-feedback";

interface ResolutionState {
  choice: "ours" | "theirs" | "manual";
  contentText: string;
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/versioning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Versioning request failed.");
  return result;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export function VersionControlPanel({
  workspaceId,
  state,
  refreshVersioning,
  workingEdit,
  onCommitComplete,
  onProtectedMain,
  requestedMerge,
  requestedCommitId,
  mode = "history",
}: {
  workspaceId: string;
  state: VersioningState;
  refreshVersioning: (branchId?: string) => Promise<VersioningState>;
  workingEdit?: { artifactId: string; contentText: string } | null;
  onCommitComplete?: () => void;
  onProtectedMain?: () => void;
  requestedMerge?: { sourceBranchId: string; targetBranchId: string; reviewId: string } | null;
  requestedCommitId?: string | null;
  mode?: "commit" | "history" | "branches";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editArtifactId, setEditArtifactId] = useState("");
  const [editContent, setEditContent] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchFrom, setBranchFrom] = useState(state.selectedBranch?.head_commit_id ?? state.commits[0]?.id ?? "");
  const [compareBefore, setCompareBefore] = useState(requestedCommitId ? state.commits.find((commit) => commit.id === requestedCommitId)?.parent_commit_id ?? "" : "");
  const [compareAfter, setCompareAfter] = useState(requestedCommitId ?? "");
  const [comparison, setComparison] = useState<ArtifactComparison[] | null>(null);
  const [knowledgeChanges, setKnowledgeChanges] = useState<KnowledgeChange[]>([]);
  const [incomingBranchId, setIncomingBranchId] = useState(requestedMerge?.sourceBranchId ?? state.branches.find((branch) => branch.id !== state.selectedBranch?.id)?.id ?? "");
  const [mergePlan, setMergePlan] = useState<MergePlan | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, ResolutionState>>({});
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; title: string; detail?: string; next?: string } | null>(null);

  const refresh = useCallback(
    async (branchId?: string) => {
      const result = await refreshVersioning(branchId);
      setEditArtifactId("");
      setEditContent("");
      setBranchFrom(result.selectedBranch?.head_commit_id ?? result.commits[0]?.id ?? "");
      setIncomingBranchId(
        result.branches.find((branch) => branch.id !== result.selectedBranch?.id)?.id ?? "",
      );
      setMergePlan((current) => {
        if (!current || !result.selectedBranch) return current;
        const incoming = result.branches.find((branch) => branch.id === current.incomingBranchId);
        return mergePlanIsCurrent(current, {
          targetBranchId: result.selectedBranch.id,
          incomingBranchId: current.incomingBranchId,
          targetHeadId: result.selectedBranch.head_commit_id,
          incomingHeadId: incoming?.head_commit_id ?? null,
        }) ? current : null;
      });
    },
    [refreshVersioning],
  );

  useEffect(() => {
    if (!requestedMerge) return;
    let active = true;
    const initialize = async () => {
      try {
        const result = await refreshVersioning(requestedMerge.targetBranchId);
        if (!active) return;
        setBranchFrom(result.selectedBranch?.head_commit_id ?? result.commits[0]?.id ?? "");
        setIncomingBranchId(requestedMerge.sourceBranchId);
        const plan = await api<MergePlan>({
          action: "prepare-reviewed-merge",
          workspaceId,
          reviewId: requestedMerge.reviewId,
          targetBranchId: requestedMerge.targetBranchId,
          incomingBranchId: requestedMerge.sourceBranchId,
        });
        if (!active) return;
        setMergePlan(plan);
        setResolutions(
          Object.fromEntries(
            plan.items
              .filter((item) => item.status === "conflict")
              .map((item) => [
                item.artifactId,
                { choice: "ours", contentText: item.oursText },
              ]),
          ),
        );
        const sourceName = result.branches.find((branch) => branch.id === requestedMerge.sourceBranchId)?.name ?? "source branch";
        const targetName = result.selectedBranch?.name ?? "main";
        setFeedback({ tone: plan.hasConflicts ? "warning" : "success", title: plan.hasConflicts ? "Reviewed merge has conflicts" : "Reviewed merge ready", detail: `${sourceName} → ${targetName} · Review current · Research CI complete · Heads unchanged`, next: plan.hasConflicts ? "Resolve the textual conflicts below." : "Confirm by creating the merge commit." });
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load versioning.");
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [refreshVersioning, requestedMerge, workspaceId]);

  const markdownArtifacts = useMemo(
    () => state?.snapshot.filter((artifact) => artifact.type === "markdown") ?? [],
    [state],
  );
  const mainIsProtected = state?.selectedBranch?.name === "main" && Boolean(state.selectedBranch.head_commit_id);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await operation();
    } catch (operationError) {
      setError(
        operationError instanceof Error ? operationError.message : "Versioning action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    await perform(async () => {
      const commitMessage = message;
      const branchName = state?.selectedBranch?.name ?? "current branch";
      const commit = await api<{ id: string }>({
        action: "commit",
        workspaceId,
        branchId: state?.selectedBranch?.id,
        message,
        edits: workingEdit
          ? [workingEdit]
          : editArtifactId
            ? [{ artifactId: editArtifactId, contentText: editContent }]
            : [],
      });
      setMessage("");
      await refresh(state?.selectedBranch?.id);
      onCommitComplete?.();
      setFeedback({ tone: "success", title: `Commit created: ${shortId(commit.id)}`, detail: `${commitMessage} · ${branchName}`, next: branchName === "main" ? "Create a research branch for subsequent changes." : "Create a Research Review when these changes are ready for main." });
    });
  }

  async function handleCreateBranch() {
    await perform(async () => {
      const createdName = branchName.trim();
      const source = branchFrom;
      const created = await api<{ id: string }>({
        action: "create-branch",
        workspaceId,
        name: branchName,
        fromCommitId: branchFrom,
      });
      setBranchName("");
      setMergePlan(null);
      await refresh(created.id);
      setFeedback({ tone: "success", title: `Branch "${createdName}" created`, detail: `Created from commit ${shortId(source)}. You are now working on ${createdName}.`, next: "Commit your research changes." });
    });
  }

  async function handleCompare() {
    await perform(async () => {
      const [textual, knowledge] = await Promise.all([
        api<ArtifactComparison[]>({
          action: "compare",
          workspaceId,
          beforeCommitId: compareBefore,
          afterCommitId: compareAfter,
        }),
        fetch("/api/research-intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "knowledge-diff", workspaceId, beforeCommitId: compareBefore, afterCommitId: compareAfter }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Knowledge comparison failed."); return result as KnowledgeChange[]; }),
      ]);
      setComparison(textual); setKnowledgeChanges(knowledge);
      setFeedback({ tone: "success", title: "Commit comparison ready", detail: `${textual.filter((item) => item.status !== "unchanged").length} changed artifact(s) found.` });
    });
  }

  async function handlePrepareMerge() {
    if (!state?.selectedBranch) return;
    await perform(async () => {
      const plan = await api<MergePlan>({
        action: "prepare-merge",
        workspaceId,
        targetBranchId: state.selectedBranch?.id,
        incomingBranchId,
      });
      setMergePlan(plan);
      setResolutions(
        Object.fromEntries(
          plan.items
            .filter((item) => item.status === "conflict")
            .map((item) => [
              item.artifactId,
              { choice: "ours", contentText: item.oursText },
            ]),
        ),
      );
      setFeedback({ tone: plan.hasConflicts ? "warning" : "success", title: "Merge preparation complete", detail: plan.hasConflicts ? `${plan.items.filter((item) => item.status === "conflict").length} textual conflict(s) require resolution.` : "No textual conflicts detected.", next: plan.hasConflicts ? "Resolve every conflict, then create the merge commit." : "Create the merge commit after reviewing the plan." });
    });
  }

  async function handleCompleteMerge() {
    if (!state?.selectedBranch || !mergePlan) return;
    const targetBranch = state.selectedBranch;
    await perform(async () => {
      const commit = await api<{ id: string }>({
        action: "complete-merge",
        workspaceId,
        targetBranchId: targetBranch.id,
        incomingBranchId: mergePlan.incomingBranchId,
        message: message || `Merge branch into ${targetBranch.name}`,
        resolutions: Object.entries(resolutions).map(([artifactId, resolution]) => ({
          artifactId,
          ...resolution,
        })),
      });
      setMergePlan(null);
      setMessage("");
      await refresh(targetBranch.id);
      setFeedback({ tone: "success", title: `Merged into ${targetBranch.name}`, detail: `Merge commit ${shortId(commit.id)} now heads ${targetBranch.name}.`, next: "Review main history or continue researching on a feature branch." });
    });
  }

  return (
    <section className="mt-0 pt-0">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{mode === "commit" ? "Commit changes" : mode === "branches" ? "Branches" : "History"}</h2>
        </div>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Current branch
          <select
            value={state?.selectedBranch?.id ?? ""}
            onChange={(event) => {
              setMergePlan(null);
              void perform(() => refresh(event.target.value));
            }}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 font-mono text-xs"
            disabled={busy || !state?.branches.length}
          >
            {!state?.branches.length && <option value="">main (not committed yet)</option>}
            {state?.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </label>
      </div>

      {feedback && <div className="mb-5"><ActionFeedback {...feedback} /></div>}
      {error && <div className="mb-5"><ActionFeedback tone="error" title="Versioning action failed" detail={error} /></div>}

      {mode === "branches" && <div className="mb-4 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">{state?.branches.length ?? 0} branches</div>
        {state.branches.map((branch) => { const head = state.commits.find((commit) => commit.id === branch.head_commit_id); const current = branch.id === state.selectedBranch?.id; return <button key={branch.id} onClick={() => { setMergePlan(null); void perform(() => refresh(branch.id)); }} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-200 px-4 py-3 text-left text-sm last:border-0 ${current ? "bg-[#161b22]" : "hover:bg-[#161b22]"}`}><span><span className="font-mono font-medium text-slate-950">{branch.name}</span>{branch.name === "main" && <span className="ml-2 text-xs text-slate-500">Protected</span>}{current && <span className="ml-2 text-xs font-medium text-emerald-400">Current</span>}<span className="mt-1 block truncate text-xs text-slate-500">{head?.message ?? "No commits yet"}</span></span><code className="text-xs text-slate-500">{branch.head_commit_id ? shortId(branch.head_commit_id) : "unborn"}</code></button>; })}
      </div>}

      <div className="grid gap-4">
        {mode === "commit" && (
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
          <h3 className="font-semibold text-slate-950">Commit changes</h3>
          {mainIsProtected && <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200"><p className="font-medium">Main is protected. Create a branch for this change.</p><p className="mt-1 text-xs text-amber-200/70">Your current working text will remain available while you create the branch.</p></div>}
          {workingEdit ? (
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
              Collaborative working text will be snapshotted in this commit.
            </div>
          ) : <label className="mt-4 grid gap-2 text-sm text-slate-700">
            Markdown artifact to edit (optional)
            <select
              value={editArtifactId}
              onChange={(event) => {
                const id = event.target.value;
                setEditArtifactId(id);
                setEditContent(
                  markdownArtifacts.find((artifact) => artifact.artifactId === id)?.contentText ?? "",
                );
              }}
              className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">No text edit</option>
              {markdownArtifacts.map((artifact) => (
                <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.name}</option>
              ))}
            </select>
          </label>}
          {!workingEdit && editArtifactId && (
            <textarea
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              rows={8}
              className="mt-3 w-full rounded-md border border-slate-300 p-3 font-mono text-sm"
            />
          )}
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Commit message"
            className="mt-3 h-8 w-full rounded-md border border-slate-300 px-3 text-sm"
          />
          <button onClick={mainIsProtected ? onProtectedMain : handleCommit} disabled={busy} className="mt-3 h-8 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Committing…" : mainIsProtected ? "Create branch" : state?.selectedBranch ? "Commit changes" : "Create first commit"}
          </button>
        </div>
        )}

        {mode === "branches" && (
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-950">New branch</h3>
          <p className="mt-1 text-xs text-slate-500">Create a movable research line from an existing commit.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Branch name" className="h-8 w-full rounded-md border border-slate-300 px-3 text-sm" />
          <select value={branchFrom} onChange={(event) => setBranchFrom(event.target.value)} className="h-8 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">Select source commit</option>
            {state?.commits.map((commit) => (
              <option key={commit.id} value={commit.id}>{shortId(commit.id)} — {commit.message}</option>
            ))}
          </select>
          <button onClick={handleCreateBranch} disabled={busy || !branchFrom} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium disabled:opacity-60">{busy ? "Creating branch…" : "Create branch"}</button></div>
        </div>
        )}
      </div>

      {mode === "history" && (
      <div className="mb-4 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between"><div><h3 className="font-semibold text-slate-950">Compare commits</h3><p className="mt-1 text-xs text-slate-500">Textual diff plus extracted knowledge changes.</p></div><span className="font-mono text-xs text-slate-400">diff</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[compareBefore, compareAfter].map((value, index) => (
            <select key={index} value={value} onChange={(event) => index === 0 ? setCompareBefore(event.target.value) : setCompareAfter(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm">
              <option value="">{index === 0 ? "Before commit" : "After commit"}</option>
              {state?.commits.map((commit) => <option key={commit.id} value={commit.id}>{shortId(commit.id)} — {commit.message}</option>)}
            </select>
          ))}
        </div>
        <button onClick={handleCompare} disabled={busy || !compareBefore || !compareAfter} className="mt-3 h-8 rounded-md bg-[#1f6feb] px-3 text-sm font-medium text-white hover:bg-[#388bfd] disabled:opacity-60">{busy ? "Comparing…" : "Compare changes"}</button>
        {comparison && (
          <div className="mt-5 grid gap-4">
            <section className="border-y border-slate-200"><h4 className="py-3 text-base font-semibold text-slate-950">Knowledge Changes</h4><div className="divide-y divide-slate-200">{knowledgeChanges.map((change, index) => <div key={`${change.artifactId}:${index}`} className="grid gap-1 py-3 text-xs"><p><span className={`inline-block w-5 font-mono font-semibold ${change.category === "numerical" ? "text-amber-400" : change.category === "removed" ? "text-red-400" : "text-emerald-400"}`}>{change.category === "introduced" ? "+" : change.category === "removed" ? "−" : change.category === "numerical" ? "!" : "~"}</span><span className="font-medium text-slate-700">{change.category}</span><span className="ml-2 text-slate-500">{change.artifactName}</span></p>{change.before && <p className="pl-5 text-red-300">− {change.before}</p>}{change.after && <p className="pl-5 text-emerald-300">+ {change.after}</p>}</div>)}{!knowledgeChanges.length && <p className="py-3 text-sm text-slate-500">No extracted claim changes.</p>}</div></section>
            {comparison.map((item) => (
              <article key={item.artifactId} className="rounded-md border border-slate-200 p-4">
                <div className="flex justify-between gap-3"><strong className="text-base">{item.name}</strong><span className="text-xs text-slate-500">{item.status}</span></div>
                {item.type === "markdown" && item.status !== "unchanged" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <pre className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-[#211419] p-3 text-xs leading-5 text-[#f0f6fc]"><b className="text-red-300">Before</b>{"\n\n"}{item.before}</pre>
                    <pre className="whitespace-pre-wrap rounded-md border border-emerald-500/30 bg-[#102019] p-3 text-xs leading-5 text-[#f0f6fc]"><b className="text-emerald-300">After</b>{"\n\n"}{item.after}</pre>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      )}

      {mode === "branches" && state?.selectedBranch && state.branches.length > 1 && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-950">Compare & merge into <code>{state.selectedBranch.name}</code></h3>
          <select value={incomingBranchId} onChange={(event) => { setIncomingBranchId(event.target.value); setMergePlan(null); }} className="mt-3 h-8 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
            {state.branches.filter((branch) => branch.id !== state.selectedBranch?.id).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          <button onClick={handlePrepareMerge} disabled={busy || !incomingBranchId} className="mt-3 h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium disabled:opacity-60">{busy ? "Preparing merge…" : "Prepare merge"}</button>
        </div>
      )}

      {mode === "branches" && mergePlan && (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="font-semibold text-slate-950">{mergePlan.hasConflicts ? "Resolve textual conflicts" : "Ready to merge into main"}</h3>
          {!mergePlan.hasConflicts && <p className="mt-2 text-sm font-medium text-emerald-700">No textual conflicts detected.</p>}
          <p className="mt-2 text-sm text-slate-600">Base {shortId(mergePlan.baseCommitId)} · ours {shortId(mergePlan.targetHeadId)} · theirs {shortId(mergePlan.incomingHeadId)}</p>
          {mergePlan.items.filter((item) => item.status === "conflict").map((item) => {
            const resolution = resolutions[item.artifactId];
            return (
              <div key={item.artifactId} className="mt-5 rounded-xl border border-amber-300 bg-white p-4">
                <h4 className="font-semibold">Conflict: {item.name}</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {[['BASE', item.baseText], ['OURS', item.oursText], ['THEIRS', item.theirsText]].map(([label, text]) => <pre key={label} className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs"><b>{label}</b>{"\n\n"}{text}</pre>)}
                </div>
                <select value={resolution?.choice ?? "ours"} onChange={(event) => setResolutions((current) => ({ ...current, [item.artifactId]: { choice: event.target.value as ResolutionState["choice"], contentText: event.target.value === "theirs" ? item.theirsText : event.target.value === "manual" ? resolution?.contentText ?? item.oursText : item.oursText } }))} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="ours">Keep ours</option><option value="theirs">Keep theirs</option>{item.type === "markdown" && <option value="manual">Manual resolution</option>}
                </select>
                {resolution?.choice === "manual" && <textarea value={resolution.contentText} onChange={(event) => setResolutions((current) => ({ ...current, [item.artifactId]: { ...resolution, contentText: event.target.value } }))} rows={8} className="mt-3 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm" />}
              </div>
            );
          })}
          <button onClick={handleCompleteMerge} disabled={busy} className="mt-4 h-8 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Creating merge commit…" : mergePlan.hasConflicts ? "Create resolved merge commit" : "Create merge commit"}</button>
        </div>
      )}

      {mode === "history" && <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-950">Commit history</h3>
        <div className="divide-y divide-slate-200">
          {state?.commits.length ? state.commits.map((commit) => (
            <button key={commit.id} onClick={() => { setCompareAfter(commit.id); setCompareBefore(commit.parent_commit_id ?? ""); setComparison(null); }} className="flex w-full flex-col justify-between gap-1 px-4 py-3 text-left text-sm hover:bg-[#161b22] sm:flex-row sm:items-center">
              <span><span className="font-medium text-slate-950">{commit.message}</span><span className="mt-1 block text-xs text-slate-500"><code className="text-[#58a6ff]">{shortId(commit.id)}</code>{commit.merge_parent_commit_id ? " · merge" : ""}{state?.selectedBranch?.head_commit_id === commit.id ? ` · ${state.selectedBranch.name}` : ""}</span></span>
              <span className="text-xs text-slate-500">{new Date(commit.created_at).toLocaleString()}</span>
            </button>
          )) : <p className="text-sm text-slate-500">No commits yet.</p>}
        </div>
      </div>}
    </section>
  );
}
