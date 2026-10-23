const SERVER_SAVE_DELAY_MS = 600;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

async function patchParticipant(sessionId: string, body: unknown, projectId?: number): Promise<void> {
  try {
    await fetch(`/api/agent-chat/${sessionId}/participant`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(projectId ? { "x-hypertask-sidebar-project": String(projectId) } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
  }
}

const inFlight = new Map<string, Promise<void>>();

export function saveDraftToServer(sessionId: string, text: string, projectId?: number): void {
  const queued = pending.get(sessionId);
  if (queued) clearTimeout(queued);
  pending.set(
    sessionId,
    setTimeout(() => {
      pending.delete(sessionId);
      const next = (inFlight.get(sessionId) ?? Promise.resolve()).then(() =>
        patchParticipant(sessionId, { draft: text }, projectId),
      );
      inFlight.set(sessionId, next);
      void next.finally(() => {
        if (inFlight.get(sessionId) === next) inFlight.delete(sessionId);
      });
    }, SERVER_SAVE_DELAY_MS),
  );
}

export function markChatRead(sessionId: string, projectId?: number): void {
  void patchParticipant(sessionId, { read: true }, projectId);
}

let nativeSidebarChat: { sessionId: string; projectId: number } | null = null;

export function setNativeSidebarChat(target: typeof nativeSidebarChat) {
  nativeSidebarChat = target;
}

export function getNativeSidebarChat() {
  return nativeSidebarChat;
}

export function sidebarChatHeaders(sessionId: string): Record<string, string> {
  const projectId = nativeSidebarChat?.sessionId === sessionId ? nativeSidebarChat.projectId : undefined;
  return projectId ? { "x-hypertask-sidebar-project": String(projectId) } : {};
}
