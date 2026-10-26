import { useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

export function useAiChatDraft({ editor, sessionId, userId, enabled = true }: {
  editor: Editor | null;
  sessionId?: string;
  userId?: number;
  enabled?: boolean;
}) {
  const drafts = useRef(new Map<string, string>());
  const previousKey = useRef<string | undefined>(undefined);
  const pendingDraft = useRef<{ userId: number | undefined; html: string } | undefined>(undefined);

  useLayoutEffect(() => {
    if (!editor || !enabled) return;
    if (!sessionId || !userId) {
      const rememberPending = () => { pendingDraft.current = { userId, html: editor.getHTML() }; };
      editor.on("update", rememberPending);
      return () => { editor.off("update", rememberPending); };
    }
    const key = `ht:aiChatDraft:${userId}:${sessionId}`;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch {}
    let saved = drafts.current.get(key);
    if (saved === undefined) {
      try { saved = storage?.getItem(key) ?? undefined; } catch {}
    }
    if (pendingDraft.current?.userId === userId) saved = pendingDraft.current.html;
    else if (!previousKey.current && !editor.isEmpty) saved = editor.getHTML();
    pendingDraft.current = undefined;
    previousKey.current = key;
    editor.commands.setContent(saved ?? "", { emitUpdate: false });
    editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins, schema: editor.schema }));
    const save = () => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      drafts.current.set(key, html);
      try {
        if (html) storage?.setItem(key, html);
        else storage?.removeItem(key);
      } catch {}
    };
    save();
    editor.on("update", save);
    return () => { editor.off("update", save); };
  }, [editor, sessionId, userId, enabled]);
}
