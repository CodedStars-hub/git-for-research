"use client";

import { useEffect, useState } from "react";
import { AssistantChat, type AssistantConversationState } from "./retrieval-panel";

interface FloatingAssistantProps {
  workspace?: {
    id: string;
    name: string;
    branchId: string | null;
    branchName: string | null;
    headCommitId: string | null;
    artifactCount: number;
    conversation: AssistantConversationState;
    onExpand: () => void;
  };
}

function AssistantIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 5.5h7a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4H11l-4.5 3v-3.4a4 4 0 0 1-2-3.5V9.5a4 4 0 0 1 4-4Z"/><path d="m14.5 2 .45 1.2L16 3.7l-1.05.45L14.5 5l-.45-.85L13 3.7l1.05-.5L14.5 2Z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg>;
}

export function FloatingAssistant({ workspace }: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    {open && <aside aria-label="Assistant panel" className="fixed bottom-[84px] right-6 z-50 flex h-[min(580px,calc(100vh-112px))] w-[min(400px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117] shadow-2xl shadow-black/40">
      <header className="flex min-h-14 items-center gap-3 border-b border-[#30363d] bg-[#161b22] px-4">
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-zinc-100">Assistant</h2>{workspace ? <p className="truncate text-xs text-zinc-500">{workspace.name} · <span className="font-mono">{workspace.branchName ?? "No branch"} @ {workspace.headCommitId?.slice(0, 8) ?? "no commits"}</span></p> : <p className="text-xs text-zinc-500">Repository-aware research help</p>}</div>
        {workspace && <button type="button" title="Open full Assistant" aria-label="Open full Assistant" onClick={() => { setOpen(false); workspace.onExpand(); }} className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-[#21262d] hover:text-zinc-200"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.8"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>}
        <button type="button" title="Close Assistant" aria-label="Close Assistant" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-[#21262d] hover:text-zinc-200"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </header>
      {workspace ? <AssistantChat workspaceId={workspace.id} mode="ask" branchId={workspace.branchId} branchName={workspace.branchName} headCommitId={workspace.headCommitId} artifactCount={workspace.artifactCount} conversation={workspace.conversation} compact /> : <div className="flex flex-1 flex-col justify-center p-6"><p className="text-sm leading-6 text-zinc-300">Open a research workspace to chat with its artifacts, history, evidence, and research context.</p><p className="mt-3 text-xs text-zinc-600">The Assistant only answers within a selected repository.</p></div>}
    </aside>}
    <button type="button" aria-label="Ask Assistant" title="Ask Assistant" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="fixed bottom-6 right-6 z-50 grid size-[50px] place-items-center rounded-full border border-[#30363d] bg-[#161b22] text-[#58a6ff] shadow-lg shadow-black/30 hover:-translate-y-0.5 hover:border-[#58a6ff] hover:bg-[#21262d] active:translate-y-0"><AssistantIcon /></button>
  </>;
}
