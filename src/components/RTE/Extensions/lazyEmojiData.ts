import type { EmojiItem } from "@tiptap/extension-emoji";

const items: EmojiItem[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getEmojiItems(): EmojiItem[] {
  return items;
}

export function onEmojiDataInstalled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensureEmojiData(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = import("@tiptap/extension-emoji")
      .then(({ emojis }) => {
        if (!loaded) {
          items.push(...emojis);
          loaded = true;
        }
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error("[emoji] data install listener failed", error);
          }
        }
      })
      .catch((error) => {
        inFlight = null;
        throw error;
      });
  }
  return inFlight;
}
