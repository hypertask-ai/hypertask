// The device copy in chatDrafts.ts is a crash cache; this is the durable one,
// so a draft typed on a laptop is still there on a phone, and the read marker
// survives the tab. Kept out of chatDrafts.ts on purpose: that helper is pure
// browser storage with no imports and no network.
//
// Writes are debounced because every keystroke would otherwise be a request.
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
    // The device copy still holds the text, so a dropped request costs the
    // cross-device restore, not the draft.
  }
}

// One thread's draft saves run one at a time, in the order they were made.
// Cancelling the timer is not enough on its own: two requests already in flight
// can finish in either order, and the loser would put back text the writer had
// already replaced or sent.
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

/** Move this person's read marker to now. The server stamps the time. */
export function markChatRead(sessionId: string): void {
  void patchParticipant(sessionId, { read: true });
}
