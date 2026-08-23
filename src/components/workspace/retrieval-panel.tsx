"use client";

import { FormEvent, useState } from "react";
import type { AssistantResponse } from "@/lib/assistant/types";
import type { EvidenceResult } from "@/lib/retrieval/retrieval";

interface RetrievalPanelProps {
  workspaceId: string;
  mode: "search" | "ask";
  branchId: string | null;
  branchName: string | null;
  headCommitId: string | null;
  artifactCount: number;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: AssistantResponse;
}

function readStoredChat(key: string): ChatEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatEntry =>
        Boolean(
          item &&
            typeof item === "object" &&
            "id" in item &&
            "role" in item &&
            "content" in item &&
            typeof item.id === "string" &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string",
        ),
    ).slice(-20);
  } catch {
    return [];
  }
}

export function RetrievalPanel(props: RetrievalPanelProps) {
  return props.mode === "ask" ? <AssistantChat {...props} /> : <SearchPanel workspaceId={props.workspaceId} />;
}

function AssistantChat({ workspaceId, branchId, branchName, headCommitId, artifactCount }: RetrievalPanelProps) {
  const storageKey = `git-for-research:assistant:${workspaceId}:${branchId ?? "no-branch"}`;
  const [messages, setMessages] = useState<ChatEntry[]>(() => readStoredChat(storageKey));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persist(next: ChatEntry[]) {
    setMessages(next);
    localStorage.setItem(storageKey, JSON.stringify(next.slice(-20)));
  }

  async function ask(question: string) {
    const normalized = question.trim();
    if (!normalized || loading || !branchId) return;
    const userMessage: ChatEntry = { id: crypto.randomUUID(), role: "user", content: normalized };
    const nextMessages = [...messages, userMessage];
    persist(nextMessages);
    setQuery("");
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          branchId,
          question: normalized,
          conversationHistory: messages.map(({ role, content }) => ({ role, content })),
        }),
      });
      const result = (await response.json()) as AssistantResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The research assistant could not respond.");
      persist([...nextMessages, { id: crypto.randomUUID(), role: "assistant", content: result.answer, response: result }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The research assistant could not respond.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(query);
  }

  const starters = [
    "What does this research currently conclude?",
    "What evidence supports the main conclusion?",
    "Has any numerical claim changed?",
    "Are there conflicting conclusions?",
  ];

  return (
    <div className="mx-auto flex min-h-[620px] max-w-4xl flex-col rounded-md border border-[#30363d] bg-[#0d1117]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#30363d] p-4">
        <div><h2 className="text-base font-semibold text-zinc-100">Assistant</h2><p className="mt-1 text-sm text-zinc-500">Context: <span className="font-mono text-zinc-400">{branchName ?? "No branch"} @ {headCommitId?.slice(0, 7) ?? "no commits"}</span> · {artifactCount} artifact{artifactCount === 1 ? "" : "s"}</p></div>
        {messages.length > 0 && <button onClick={() => { localStorage.removeItem(storageKey); setMessages([]); setError(null); }} className="text-xs font-medium text-zinc-500 hover:text-zinc-300">New conversation</button>}
      </header>
      <div className="flex-1 space-y-4 p-4">
        {!branchId ? <p className="text-sm text-zinc-500">Create a branch commit before asking questions about its current snapshot.</p>
        : messages.length === 0 ? <div><p className="text-sm text-zinc-500">Start with a repository-grounded question.</p><div className="mt-4 flex flex-wrap gap-2">{starters.map((starter) => <button key={starter} onClick={() => void ask(starter)} className="rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-left text-xs text-zinc-400 hover:border-[#58a6ff] hover:text-zinc-200">{starter}</button>)}</div></div>
        : messages.map((message) => <article key={message.id} className={message.role === "user" ? "ml-auto max-w-2xl" : "max-w-3xl"}>
          <p className="mb-1 text-xs font-medium text-zinc-500">{message.role === "user" ? "You" : "Assistant"}</p>
          <div className={message.role === "user" ? "rounded-md bg-[#1f6feb] px-4 py-3 text-sm text-white" : "border-l-2 border-[#30363d] pl-4 text-sm leading-6 text-zinc-300"}>{message.content}</div>
          {message.response && <div className="mt-3 space-y-2 pl-4"><p className="text-xs text-zinc-500">{message.response.mode === "generated" ? "Generated from repository evidence" : "Grounded retrieval"} · {message.response.confidence} confidence</p>
            {message.response.citations.map((citation) => <details key={`${message.id}:${citation.citationIndex}`} className="rounded-md border border-[#30363d] bg-[#111318] text-xs"><summary className="cursor-pointer px-3 py-2 text-zinc-400"><span className="font-mono text-indigo-400">[{citation.citationIndex}]</span> {citation.artifactName} · {citation.repositoryStatus}</summary><div className="border-t border-[#30363d] px-3 py-3 text-zinc-500"><p>{citation.artifactType} · version <span className="font-mono">{citation.artifactVersionId}</span></p>{citation.commits.map((commit) => <p key={commit.id} className="mt-1">Commit <span className="font-mono">{commit.shortHash}</span> · {commit.message}</p>)}<p className="mt-2 leading-5 text-zinc-400">{citation.snippet}</p></div></details>)}
            {message.response.limitations.map((limitation) => <p key={limitation} className="text-xs text-zinc-600">{limitation}</p>)}</div>}
        </article>)}
        {loading && <p className="text-sm text-zinc-500">Reviewing repository evidence…</p>}
        {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/8 p-3 text-sm text-red-300"><p className="font-medium">✕ Assistant could not complete the request.</p><p className="mt-1 text-xs">{error}</p><button disabled={loading} onClick={() => { const lastQuestion = [...messages].reverse().find((item) => item.role === "user")?.content; if (lastQuestion) void ask(lastQuestion); }} className="mt-2 text-xs font-medium underline disabled:opacity-50">Retry</button></div>}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-[#30363d] p-4"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask anything about this research…" disabled={loading || !branchId} className="h-9 min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#010409] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[#58a6ff] disabled:opacity-50"/><button disabled={loading || !branchId || !query.trim()} className="h-9 rounded-md bg-[#1f6feb] px-4 text-sm font-medium text-white hover:bg-[#388bfd] disabled:opacity-50">{loading ? "Thinking…" : "Send"}</button></form>
    </div>
  );
}

function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EvidenceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    try { const response = await fetch("/api/retrieval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, query, limit: 20, mode: "search" }) }); const data = (await response.json()) as EvidenceResult[] & { error?: string }; if (!response.ok) throw new Error(data.error ?? "Retrieval failed."); setResults(data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Retrieval failed."); }
    finally { setLoading(false); }
  }
  return <div className="mx-auto max-w-5xl"><div className="mb-5 border-b border-[#30363d] pb-4"><h2 className="text-xl font-semibold text-zinc-100">Cross-artifact search</h2><p className="mt-2 text-sm text-zinc-500">Search Markdown, extracted PDFs, and imported ChatGPT conversations.</p></div><form onSubmit={submit} className="flex h-9 overflow-hidden rounded-md border border-[#30363d] bg-[#0d1117] focus-within:border-[#58a6ff]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search research content…" className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"/><button disabled={loading} className="m-px h-8 rounded-md bg-[#1f6feb] px-3 text-sm font-medium text-white disabled:opacity-50">{loading ? "Retrieving…" : "Search"}</button></form>{error && <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/8 p-3 text-sm text-red-300">{error}</div>}<div className="mt-6 overflow-hidden rounded-md border border-[#30363d] empty:border-0">{results.map((result) => <article key={result.artifactVersionId} className="border-b border-[#30363d] bg-[#0d1117] p-4 last:border-0"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="font-medium text-zinc-200">{result.artifactName}</span><span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{result.artifactType}</span><span className={`rounded px-1.5 py-0.5 text-[10px] ${result.isLatestVersion ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{result.isLatestVersion ? "latest" : "historical"}</span></div><span className="font-mono text-xs text-zinc-600">score {result.score}</span></div>{result.contextLabel && <p className="mt-2 text-xs text-indigo-400">{result.contextLabel}</p>}<p className="mt-3 text-sm leading-6 text-zinc-400">{result.snippet}</p><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-600"><span>version {result.artifactVersionId.slice(0, 7)}</span>{result.commits.map((commit) => <span key={commit.id}>commit {commit.shortHash} · {commit.message}</span>)}</div></article>)}</div></div>;
}
