"use client";

import { useEffect, useRef, useState } from "react";
import {
  createCollaborationSession,
  type CollaboratorPresence,
  type ResearcherIdentity,
} from "@/lib/collaboration/session";
import type { SnapshotArtifact } from "@/lib/versioning/types";

export function CollaborativeEditor({
  workspaceId,
  artifact,
  identity,
  onWorkingChange,
  onPresenceChange,
}: {
  workspaceId: string;
  artifact: SnapshotArtifact;
  identity: ResearcherIdentity;
  onWorkingChange: (artifactId: string, content: string) => void;
  onPresenceChange: (presence: CollaboratorPresence[]) => void;
}) {
  const [content, setContent] = useState(artifact.contentText);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const sessionRef = useRef<ReturnType<typeof createCollaborationSession> | null>(
    null,
  );
  const receivedInitialContent = useRef(false);

  useEffect(() => {
    const session = createCollaborationSession({
      workspaceId,
      artifactId: artifact.artifactId,
      identity,
      initialContent: artifact.contentText,
      onContent: (nextContent) => {
        setContent(nextContent);
        if (
          receivedInitialContent.current ||
          nextContent !== artifact.contentText
        ) {
          onWorkingChange(artifact.artifactId, nextContent);
        }
        receivedInitialContent.current = true;
      },
      onPresence: onPresenceChange,
      onStatus: setStatus,
    });
    sessionRef.current = session;
    return () => {
      session.destroy();
      sessionRef.current = null;
      onPresenceChange([]);
    };
  }, [artifact.artifactId, artifact.contentText, identity, onPresenceChange, onWorkingChange, workspaceId]);

  return (
    <div className="flex h-full min-h-[520px] flex-col bg-[#0d0f12]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5 text-xs text-zinc-500">
        <span className="font-medium text-zinc-300">{artifact.name}</span>
        <span className={status === "connected" ? "text-emerald-400" : "text-amber-400"}>
          ● {status === "connected" ? "Live CRDT" : status}
        </span>
      </div>
      <textarea
        aria-label={`Collaborative editor for ${artifact.name}`}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          sessionRef.current?.replaceContent(event.target.value);
        }}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-mono text-[13px] leading-6 text-zinc-200 outline-none selection:bg-indigo-500/30"
      />
      <div className="border-t border-white/8 px-4 py-2 text-xs text-zinc-600">
        Working state · committed history remains immutable
      </div>
    </div>
  );
}
