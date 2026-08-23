"use client";

import { FormEvent, useState } from "react";
import { parseChatGptJson } from "@/lib/ingestion/chatgpt";
import { normalizeMarkdown } from "@/lib/ingestion/markdown";
import { createArtifactWithFirstVersion } from "@/lib/research/artifacts";
import type { ArtifactType } from "@/types/database";

interface AddArtifactFormProps {
  workspaceId: string;
  onCreated: (artifact: { name: string; type: ArtifactType }) => Promise<void>;
  onCancel: () => void;
}

async function extractPdf(file: File): Promise<string> {
  const body = new FormData();
  body.set("file", file);

  const response = await fetch("/api/ingestion/pdf", { method: "POST", body });
  const result = (await response.json()) as { text?: string; error?: string };

  if (!response.ok || !result.text) {
    throw new Error(result.error ?? "PDF extraction failed.");
  }

  return result.text;
}

export function AddArtifactForm({
  workspaceId,
  onCreated,
  onCancel,
}: AddArtifactFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ArtifactType>("markdown");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      let normalizedContent: string;

      if (type === "markdown") {
        normalizedContent = normalizeMarkdown(content);
      } else if (!file) {
        throw new Error(
          type === "pdf" ? "Select a PDF file." : "Select a ChatGPT JSON file.",
        );
      } else if (type === "pdf") {
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");
        if (!isPdf) throw new Error("Unsupported file type. Select a PDF file.");
        normalizedContent = await extractPdf(file);
      } else {
        const isJson =
          file.type === "application/json" ||
          file.name.toLowerCase().endsWith(".json");
        if (!isJson) {
          throw new Error("Unsupported file type. Select a JSON file.");
        }
        normalizedContent = parseChatGptJson(await file.text());
      }

      const created = await createArtifactWithFirstVersion({
        workspaceId,
        name,
        type,
        contentText: normalizedContent,
      });
      await onCreated({ name: created.artifact.name, type: created.artifact.type });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save artifact.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 rounded-md border border-slate-200 bg-white p-5"
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-950">Add artifact</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Artifact name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 rounded-md border border-slate-300 px-3 text-sm font-normal outline-none focus:border-indigo-500"
            placeholder="Literature notes"
            disabled={saving}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Artifact type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as ArtifactType);
              setFile(null);
              setError(null);
            }}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-indigo-500"
            disabled={saving}
          >
            <option value="markdown">Markdown / plaintext</option>
            <option value="pdf">PDF</option>
            <option value="chat">ChatGPT JSON export</option>
          </select>
        </label>

        {type === "markdown" ? (
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Content
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={10}
              className="resize-y rounded-md border border-slate-300 px-4 py-3 font-mono text-sm font-normal outline-none focus:border-indigo-500"
              placeholder="Paste or type research content…"
              disabled={saving}
            />
          </label>
        ) : (
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {type === "pdf" ? "Text-extractable PDF" : "ChatGPT JSON export"}
            <input
              key={type}
              type="file"
              accept={type === "pdf" ? ".pdf,application/pdf" : ".json,application/json"}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="h-8 rounded-md border border-slate-300 px-2 text-sm font-normal file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:font-medium"
              disabled={saving}
            />
          </label>
        )}
      </div>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="mt-5 h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving
          ? type === "pdf"
            ? "Processing PDF…"
            : type === "chat"
              ? "Processing ChatGPT export…"
              : "Saving Markdown artifact…"
          : "Save artifact"}
      </button>
    </form>
  );
}
