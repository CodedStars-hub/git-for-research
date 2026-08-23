import * as Y from "yjs";
import { supabase } from "@/lib/supabase/client";

export type ResearcherIdentity = "Harshita" | "Researcher 2";

export interface CollaboratorPresence {
  identity: ResearcherIdentity;
  status: "online" | "editing";
}

interface CollaborationSessionOptions {
  workspaceId: string;
  artifactId: string;
  identity: ResearcherIdentity;
  initialContent: string;
  onContent: (content: string) => void;
  onPresence: (presence: CollaboratorPresence[]) => void;
  onStatus: (status: "connecting" | "connected" | "disconnected") => void;
}

const REMOTE_ORIGIN = Symbol("remote-yjs-update");

function encode(update: Uint8Array): string {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(update: string): Uint8Array {
  const binary = atob(update);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createCollaborationSession({
  workspaceId,
  artifactId,
  identity,
  initialContent,
  onContent,
  onPresence,
  onStatus,
}: CollaborationSessionOptions) {
  const document = new Y.Doc();
  const text = document.getText("markdown");
  const channel = supabase.channel(`research:${workspaceId}:${artifactId}`, {
    config: { presence: { key: identity } },
  });
  let seedTimer: ReturnType<typeof setTimeout> | null = null;
  let editingTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function publishPresence() {
    const presence = Object.values(channel.presenceState())
      .flat()
      .map((entry) => entry as unknown as CollaboratorPresence)
      .filter(
        (entry) =>
          entry.identity === "Harshita" || entry.identity === "Researcher 2",
      );
    onPresence(
      [...new Map(presence.map((entry) => [entry.identity, entry])).values()],
    );
  }

  function applyEncodedUpdate(payload: unknown) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "update" in payload &&
      typeof payload.update === "string"
    ) {
      Y.applyUpdate(document, decode(payload.update), REMOTE_ORIGIN);
    }
  }

  channel
    .on("broadcast", { event: "yjs-update" }, ({ payload }) => {
      applyEncodedUpdate(payload);
    })
    .on("broadcast", { event: "sync-request" }, () => {
      if (text.length) {
        void channel.send({
          type: "broadcast",
          event: "sync-state",
          payload: { update: encode(Y.encodeStateAsUpdate(document)) },
        });
      }
    })
    .on("broadcast", { event: "sync-state" }, ({ payload }) => {
      if (seedTimer) {
        clearTimeout(seedTimer);
        seedTimer = null;
      }
      applyEncodedUpdate(payload);
    })
    .on("presence", { event: "sync" }, publishPresence)
    .on("presence", { event: "join" }, publishPresence)
    .on("presence", { event: "leave" }, publishPresence)
    .subscribe((status) => {
      if (destroyed) return;
      if (status === "SUBSCRIBED") {
        onStatus("connected");
        void channel.track({ identity, status: "online" });
        void channel.send({
          type: "broadcast",
          event: "sync-request",
          payload: {},
        });

        seedTimer = setTimeout(
          () => {
            if (!text.length) text.insert(0, initialContent);
          },
          identity === "Harshita" ? 250 : 550,
        );
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onStatus("disconnected");
      }
    });

  document.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) {
      void channel.send({
        type: "broadcast",
        event: "yjs-update",
        payload: { update: encode(update) },
      });
    }
  });
  text.observe(() => onContent(text.toString()));

  return {
    replaceContent(content: string) {
      const current = text.toString();
      if (current === content) return;
      let prefix = 0;
      while (
        prefix < current.length &&
        prefix < content.length &&
        current[prefix] === content[prefix]
      ) {
        prefix += 1;
      }
      let suffix = 0;
      while (
        suffix < current.length - prefix &&
        suffix < content.length - prefix &&
        current[current.length - 1 - suffix] ===
          content[content.length - 1 - suffix]
      ) {
        suffix += 1;
      }
      document.transact(() => {
        text.delete(prefix, current.length - prefix - suffix);
        text.insert(prefix, content.slice(prefix, content.length - suffix));
      });
      void channel.track({ identity, status: "editing" });
      if (editingTimer) clearTimeout(editingTimer);
      editingTimer = setTimeout(() => {
        void channel.track({ identity, status: "online" });
      }, 1200);
    },
    destroy() {
      destroyed = true;
      if (seedTimer) clearTimeout(seedTimer);
      if (editingTimer) clearTimeout(editingTimer);
      void supabase.removeChannel(channel);
      document.destroy();
      onStatus("disconnected");
    },
  };
}
