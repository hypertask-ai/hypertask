// HTPR-6059: the @tiptap/extension-emoji package embeds its emoji dataset in
// the same module as the Emoji node, and the node's default options reference
// the data, so any static import keeps the full dataset in the editor chunk
// that loads on every task open. The local LazyEmoji node therefore starts
// with this shared, empty array and the dataset is pulled in once, on demand,
// through a dynamic import. Because every consumer reads the dataset at call
// time (rendering, input/paste rules, autocomplete via editor.storage), filling
// this one array activates emoji behavior everywhere at once.
import type { EmojiItem } from "@tiptap/extension-emoji";

const items: EmojiItem[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getEmojiItems(): EmojiItem[] {
  return items;
}

// Notified once the dataset has been installed; used to rebuild caches that
// were derived from the (empty) initial dataset, e.g. the emoticon regex.
export function onEmojiDataInstalled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Single-flight loader. The stored promise is returned directly (not through
// an async wrapper) so concurrent callers observe the same in-flight request.
// A failed fetch clears the flight so the next call retries; a succeeded one
// never re-imports.
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
