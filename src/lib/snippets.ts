import type { Editor } from "@tiptap/core";

// Type alias, not an interface: Prisma's InputJsonValue needs an implicit
// index signature, which interfaces don't get.
export type ISnippet = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

export const OPEN_COMMENT_SNIPPET_EVENT = "hypertask:open-comment-snippet";

// Creating a snippet from the current draft navigates to the snippets page, so
// the editor's content is handed over through sessionStorage rather than props.
// Read once and cleared, so a later visit starts empty.
const SNIPPET_DRAFT_HANDOFF_KEY = "snippet-draft-handoff";

// sessionStorage is scoped to the tab, not to the account, so the handoff
// carries the user it was written for. A tab reused after logout, or an
// interrupted navigation, must not drop one account's draft into another's
// editor.
export const putSnippetDraftHandoff = (
  userId: number | undefined,
  html: string
) => {
  try {
    if (!html || !userId) {
      sessionStorage.removeItem(SNIPPET_DRAFT_HANDOFF_KEY);
      return;
    }
    sessionStorage.setItem(
      SNIPPET_DRAFT_HANDOFF_KEY,
      JSON.stringify({ userId, html })
    );
  } catch {}
};

export const takeSnippetDraftHandoff = (userId: number | undefined) => {
  try {
    const stored = sessionStorage.getItem(SNIPPET_DRAFT_HANDOFF_KEY);
    if (!stored) return "";
    sessionStorage.removeItem(SNIPPET_DRAFT_HANDOFF_KEY);
    if (!userId) return "";
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { userId?: unknown }).userId !== userId ||
      typeof (parsed as { html?: unknown }).html !== "string"
    ) {
      return "";
    }
    return (parsed as { html: string }).html;
  } catch {
    return "";
  }
};

let cachedSnippets: ISnippet[] | null = null;
let snippetsRequest: Promise<ISnippet[]> | null = null;
let lastFocusedEditor: Editor | null = null;
let forcedPickerEditor: Editor | null = null;
const editorsByMode = new Map<string, Editor>();

export const getSnippets = async () => {
  if (cachedSnippets) return cachedSnippets;
  if (snippetsRequest) return snippetsRequest;

  snippetsRequest = fetch("/api/users/preferences")
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to load snippets");
      const data = await response.json();
      cachedSnippets = Array.isArray(data.settings?.snippets)
        ? data.settings.snippets
        : [];
      return cachedSnippets!;
    })
    .finally(() => {
      snippetsRequest = null;
    });

  return snippetsRequest;
};

export const setCachedSnippets = (snippets: ISnippet[]) => {
  cachedSnippets = snippets;
};

export const registerTiptapEditor = (
  mode: string,
  editor: Editor,
) => {
  editorsByMode.set(mode, editor);
};

export const focusTiptapEditor = (editor: Editor) => {
  lastFocusedEditor = editor;
};

export const unregisterTiptapEditor = (mode: string, editor: Editor) => {
  if (editorsByMode.get(mode) === editor) editorsByMode.delete(mode);
  if (lastFocusedEditor === editor) lastFocusedEditor = null;
  if (forcedPickerEditor === editor) forcedPickerEditor = null;
};

export const getLastFocusedTiptapEditor = () => lastFocusedEditor;

export const getTiptapEditorForMode = (mode: string) =>
  editorsByMode.get(mode) ?? null;

export const openSnippetPicker = (editor = lastFocusedEditor) => {
  if (!editor || editor.isDestroyed) return false;
  forcedPickerEditor = editor;
  editor.chain().focus().insertContent(";").run();
  return true;
};

export const isForcedSnippetPicker = (editor: Editor) =>
  forcedPickerEditor === editor;

export const clearForcedSnippetPicker = (editor: Editor) => {
  if (forcedPickerEditor === editor) forcedPickerEditor = null;
};

export const requestCommentSnippetPicker = () => {
  window.dispatchEvent(new CustomEvent(OPEN_COMMENT_SNIPPET_EVENT));
};
