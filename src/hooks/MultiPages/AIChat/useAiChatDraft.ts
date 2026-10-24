import type { Editor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";

export function useAiChatDraft(
  editor: Editor | null,
  userId: number | undefined,
  sessionId: string | null | undefined,
  enabled: boolean,
  agentId?: string | null,
) {
  const drafts = useRef(new Map<string, string>());
  const previousBinding = useRef<{ key: string; editor: Editor } | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !editor || userId === undefined || !sessionId) return;
    const key = `aiChat.draft.${userId}.${sessionId}`;
    const cached = drafts.current.get(key);
    let revision = cached || null;
    let stored = cached;
    try {
      revision = window.localStorage.getItem(key);
      stored = revision ?? undefined;
    } catch {}
    const sameBinding = previousBinding.current?.key === key && previousBinding.current.editor === editor;
    const hasInitialText = previousBinding.current === null && !editor.isEmpty;
    const hasLocalEdits = sameBinding && cached !== undefined && (editor.isEmpty ? "" : editor.getHTML()) !== cached;
    const legacy = stored === undefined && agentId ? readDraft(userId, agentId) : "";
    if (!hasInitialText && !hasLocalEdits && (!sameBinding || stored !== cached || legacy)) {
      editor.commands.setContent(stored ?? (legacy ? {
        type: "doc",
        content: legacy.split("\n").map((text) => ({
          type: "paragraph",
          ...(text ? { content: [{ type: "text", text }] } : {}),
        })),
      } : ""), { emitUpdate: false });
    }
    previousBinding.current = { key, editor };
    let lastHtml = editor.isEmpty ? "" : editor.getHTML();
    if (hasInitialText || hasLocalEdits || legacy) lastHtml = stored ?? "";
    if (hasLocalEdits) revision = cached || null;

    const save = () => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      if (html === lastHtml) return;
      drafts.current.set(key, html);
      try {
        if (window.localStorage.getItem(key) !== revision) return;
        if (html) window.localStorage.setItem(key, html);
        else window.localStorage.removeItem(key);
        revision = html || null;
        if (agentId) writeDraft(userId, agentId, "");
        lastHtml = html;
        window.dispatchEvent(new window.Event("aiChatDraftChanged"));
      } catch {
        lastHtml = html;
      }
    };
    const synchronize = (event: Event) => {
      if ("key" in event && event.key !== null && event.key !== key) return;
      if ((editor.isEmpty ? "" : editor.getHTML()) !== lastHtml) return;
      try {
        const next = window.localStorage.getItem(key);
        if (next === revision) return;
        editor.commands.setContent(next ?? "", { emitUpdate: false });
        revision = next;
        lastHtml = editor.isEmpty ? "" : editor.getHTML();
        drafts.current.set(key, lastHtml);
      } catch {}
    };
    save();
    drafts.current.set(key, editor.isEmpty ? "" : editor.getHTML());
    editor.on("update", save);
    window.addEventListener("storage", synchronize);
    window.addEventListener("aiChatDraftChanged", synchronize);
    return () => {
      editor.off("update", save);
      window.removeEventListener("storage", synchronize);
      window.removeEventListener("aiChatDraftChanged", synchronize);
    };
  }, [editor, userId, sessionId, enabled, agentId]);
}
