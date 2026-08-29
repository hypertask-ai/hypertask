"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { Plus, Trash2 } from "lucide-react";
import useTiptap from "@/components/RTE/Tiptap";
import useSnippetManager from "@/hooks/General/useSnippetManager";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { takeSnippetDraftHandoff, type ISnippet } from "@/lib/snippets";
import styles from "@/styles/tiptap.module.scss";

const getPreview = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const Snippets = () => {
  const { snippets, saveSnippet, deleteSnippet, isPending } =
    useSnippetManager();
  const currentUser = useCurrentUser();
  const { editor } = useTiptap({
    mode: "snippet",
    trackFocus: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const draftHandoffTakenRef = useRef(false);

  // "Create snippet from draft" navigates here and leaves the editor's content
  // behind for us to pick up, once, as soon as the editor exists.
  useEffect(() => {
    // Wait for the account too: consuming the handoff before it is known would
    // drop the draft on the floor, and this effect only ever runs once.
    if (!editor || !currentUser?.id || draftHandoffTakenRef.current) return;
    draftHandoffTakenRef.current = true;
    const handedOverHtml = takeSnippetDraftHandoff(currentUser?.id);
    if (handedOverHtml) {
      editor.commands.setContent(handedOverHtml);
      editor.commands.focus("end");
    }
  }, [editor, currentUser?.id]);

  const startNewSnippet = () => {
    setEditingId(null);
    setTitle("");
    editor?.commands.clearContent();
    editor?.commands.focus();
  };

  const selectSnippet = (snippet: ISnippet) => {
    setEditingId(snippet.id);
    setTitle(snippet.title);
    editor?.commands.setContent(snippet.content);
    editor?.commands.focus("end");
  };

  const handleSave = async () => {
    const savedSnippet = await saveSnippet({
      editingId,
      title,
      content: editor?.getHTML() ?? "",
      isEmpty: !editor || editor.isEmpty,
    });
    if (!savedSnippet) return;

    setEditingId(savedSnippet.id);
    setTitle(savedSnippet.title);
    editor?.commands.setContent(savedSnippet.content);
  };

  const handleDelete = async () => {
    const snippet = snippets.find((item) => item.id === editingId);
    if (!snippet) return;

    const deleted = await deleteSnippet(snippet);
    if (deleted) startNewSnippet();
  };

  return (
    <main className="flex min-h-screen w-full justify-center bg-pageBackground">
      <div className="global-view-width flex min-h-screen flex-col bg-containerBackground px-4 py-9 md:px-8 lg:px-16">
        <div className="mb-6 flex w-full items-center justify-between">
          <h1 className="text-subheading font-bold text-white-black">
            Snippets
          </h1>
          <button
            type="button"
            onClick={startNewSnippet}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-[4px] bg-hypertasks-purple px-3 py-2 text-content font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={15} strokeWidth={1.75} /> New snippet
          </button>
        </div>

        <div className="grid min-h-0 w-full flex-1 gap-4 md:grid-cols-[minmax(220px,0.36fr)_minmax(0,1fr)]">
          <aside className="h-fit max-h-[calc(100svh-130px)] overflow-y-auto rounded-[4px] bg-cardBackground shadow-md">
            <div className="border-b border-light-black-border-1 px-4 py-3 text-meta font-medium text-text-light-gray">
              Saved snippets
            </div>
            {snippets.length ? (
              <ul>
                {snippets.map((snippet) => (
                  <li
                    key={snippet.id}
                    className="border-b border-light-black-border-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => selectSnippet(snippet)}
                      disabled={isPending}
                      className={`w-full px-4 py-3 text-left outline-none hover:bg-hover-active focus:bg-hover-active disabled:opacity-50 ${
                        editingId === snippet.id ? "bg-active-modal-element" : ""
                      }`}
                    >
                      <span className="block truncate text-content font-medium text-white-black">
                        {snippet.title}
                      </span>
                      <span className="mt-0.5 block truncate text-meta text-text-light-gray">
                        {getPreview(snippet.content) || "No preview"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-content text-text-light-gray">
                No snippets yet
              </p>
            )}
          </aside>

          <section className="flex min-h-[440px] flex-col rounded-[4px] bg-cardBackground p-5 shadow-md">
            <label
              htmlFor="snippet-title"
              className="mb-1 text-meta font-medium text-text-light-gray"
            >
              Title
            </label>
            <div className="mb-5 border-b border-light-black-border-1">
              <input
                id="snippet-title"
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Weekly update"
                style={{ border: 0, boxShadow: "none" }}
                className="w-full bg-transparent px-0 py-2 text-content text-white-black outline-none placeholder:text-text-light-gray focus:ring-0"
              />
            </div>

            <label className="mb-2 text-meta font-medium text-text-light-gray">
              Content
            </label>
            <div
              onClick={() => editor?.commands.focus()}
              className={`min-h-[280px] flex-1 cursor-text overflow-y-auto rounded-[4px] bg-containerBackground p-4 text-white-black shadow-md outline-none ${styles.editorContainer}`}
            >
              <EditorContent editor={editor} />
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              {editingId && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-[4px] px-3 py-2 text-content text-red-400 hover:bg-hover-active disabled:opacity-50"
                >
                  <Trash2 size={15} strokeWidth={1.75} /> Delete
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="rounded-[4px] bg-hypertasks-purple px-4 py-2 text-content font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Saving…" : editingId ? "Save" : "Create"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

export default Snippets;
