// Unsent Agent Chat composer text, kept per user and per agent so switching
// agents (and reloading) restores what was being typed instead of dropping it,
// and so one agent's chat never shows another's text. Drafts stay on the
// device: they are private until the user actually sends them.
//
// The user id is part of the key because a shared browser would otherwise hand
// the next account the previous one's unsent message.
const PREFIX = "agentChat.draft";

function key(userId: number, agentId: string): string {
  return `${PREFIX}.${userId}.${agentId}`;
}

// localStorage is unavailable during SSR and throws outright in some privacy
// modes; a lost draft must never take the chat down with it.
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(userId: number, agentId: string): string {
  try {
    return storage()?.getItem(key(userId, agentId)) ?? "";
  } catch {
    return "";
  }
}

/** Whitespace-only is the same as no draft, so it clears the slot. */
export function writeDraft(userId: number, agentId: string, text: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (text.trim() === "") store.removeItem(key(userId, agentId));
    else store.setItem(key(userId, agentId), text);
  } catch {
    // Quota or a blocked store: the draft simply isn't restored later.
  }
}

export function clearDraft(userId: number, agentId: string): void {
  writeDraft(userId, agentId, "");
}
