import type { Editor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";

export function useAiChatDraft(
  editor: Editor | null,
  userId: number | undefined,
  sessionId: string | null | undefined,
  enabled: boolean,
) {
  const drafts = useRef(new Map<string, string>());
  const previousBinding = useRef<{ key: string; editor: Editor } | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !editor || userId === undefined || !sessionId) return;
    const key = `aiChat.draft.${userId}.${sessionId}`;
    let stored = drafts.current.get(key);
    if (stored === undefined) {
      try {
        stored = window.localStorage.getItem(key) ?? undefined;
      } catch {}
    }
    const sameBinding = previousBinding.current?.key === key && previousBinding.current.editor === editor;
    const hasInitialText = previousBinding.current === null && !editor.isEmpty;
    if (!sameBinding && !hasInitialText) {
      editor.commands.setContent(stored ?? "", { emitUpdate: false });
    }
    previousBinding.current = { key, editor };

    const save = () => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      drafts.current.set(key, html);
      try {
        if (html) window.localStorage.setItem(key, html);
        else window.localStorage.removeItem(key);
      } catch {}
    };
    save();
    editor.on("update", save);
    return () => {
      save();
      editor.off("update", save);
    };
  }, [editor, userId, sessionId, enabled]);
}
