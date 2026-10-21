const SERVER_SAVE_DELAY_MS = 600;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

async function patchParticipant(sessionId: string, body: unknown): Promise<void> {
  try {
    await fetch(`/api/agent-chat/${sessionId}/participant`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
  }
}

const inFlight = new Map<string, Promise<void>>();

export function saveDraftToServer(sessionId: string, text: string): void {
  const queued = pending.get(sessionId);
  if (queued) clearTimeout(queued);
  pending.set(
    sessionId,
    setTimeout(() => {
      pending.delete(sessionId);
      const next = (inFlight.get(sessionId) ?? Promise.resolve()).then(() =>
        patchParticipant(sessionId, { draft: text }),
      );
      inFlight.set(sessionId, next);
      void next.finally(() => {
        if (inFlight.get(sessionId) === next) inFlight.delete(sessionId);
      });
    }, SERVER_SAVE_DELAY_MS),
  );
}

export function markChatRead(sessionId: string): void {
  void patchParticipant(sessionId, { read: true });
}
