const PREFIX = "agentChat.draft";

function key(userId: number, agentId: string): string {
  return `${PREFIX}.${userId}.${agentId}`;
}

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

export function writeDraft(userId: number, agentId: string, text: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (text.trim() === "") store.removeItem(key(userId, agentId));
    else store.setItem(key(userId, agentId), text);
  } catch {
  }
}

