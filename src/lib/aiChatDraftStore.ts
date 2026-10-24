import type { Editor } from "@tiptap/react";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";

export function bindAiChatDraft(
  editor: Editor,
  userId: number,
  sessionId: string,
  drafts: { current: Map<string, string> },
  previousBinding: { current: { key: string; editor: Editor } | null },
  agentId?: string | null,
) {
  const key = `aiChat.draft.${userId}.${sessionId}`;
  const cached = drafts.current.get(key);
  let revision = cached || null;
  let stored = cached;
  let recovery: string | null = null;
  try {
    revision = window.localStorage.getItem(key);
    stored = revision ?? undefined;
  } catch {}
  try {
    recovery = window.sessionStorage.getItem(key);
    if (recovery !== null) stored = recovery;
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
      const currentRevision = window.localStorage.getItem(key);
      if (currentRevision !== revision || recovery !== null) {
        if (html === (currentRevision ?? "")) {
          window.sessionStorage.removeItem(key);
          recovery = null;
          revision = currentRevision;
        } else {
          window.sessionStorage.setItem(key, html);
          recovery = html;
        }
        lastHtml = html;
        return;
      }
      if (html) window.localStorage.setItem(key, html);
      else window.localStorage.removeItem(key);
      revision = html || null;
      if (agentId) writeDraft(userId, agentId, "");
      lastHtml = html;
      window.dispatchEvent(new window.Event("aiChatDraftChanged"));
    } catch {
      try {
        window.sessionStorage.setItem(key, html);
        recovery = html;
      } catch {}
      lastHtml = html;
    }
  };
  const synchronize = (event: Event) => {
    if ("key" in event && event.key !== null && event.key !== key) return;
    if ((editor.isEmpty ? "" : editor.getHTML()) !== lastHtml) return;
    try {
      const next = window.localStorage.getItem(key);
      const nextRecovery = window.sessionStorage.getItem(key);
      if (recovery !== null && nextRecovery === recovery) return;
      if (next === revision && nextRecovery === recovery) return;
      editor.commands.setContent(nextRecovery ?? next ?? "", { emitUpdate: false });
      revision = next;
      recovery = nextRecovery;
      lastHtml = editor.isEmpty ? "" : editor.getHTML();
      drafts.current.set(key, lastHtml);
    } catch {}
  };
  save();
  drafts.current.set(key, editor.isEmpty ? "" : editor.getHTML());
  const captureSubmission = () => {
    const html = editor.isEmpty ? "" : editor.getHTML();
    const document = editor.state.doc;
    const binding = previousBinding.current;
    const savedRevision = revision;
    const savedRecovery = recovery;
    return () => {
      if (drafts.current.get(key) !== html) return;
      if (previousBinding.current === binding && editor.state.doc !== document) return;
      drafts.current.set(key, "");
      try {
        if (savedRevision === html && window.localStorage.getItem(key) === savedRevision) {
          window.localStorage.removeItem(key);
        }
      } catch {}
      try {
        if (savedRecovery === html && window.sessionStorage.getItem(key) === savedRecovery) {
          window.sessionStorage.removeItem(key);
        }
      } catch {}
      window.dispatchEvent(new window.Event("aiChatDraftChanged"));
    };
  };
  editor.on("update", save);
  window.addEventListener("storage", synchronize);
  window.addEventListener("aiChatDraftChanged", synchronize);
  return {
    captureSubmission,
    cleanup: () => {
      editor.off("update", save);
      window.removeEventListener("storage", synchronize);
      window.removeEventListener("aiChatDraftChanged", synchronize);
    },
  };
}
