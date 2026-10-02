"use client";

import { appendTitleDictation } from "@/components/Modals/CreateTaskGloballyModal/titleDictation";
import { IProject, ITask } from "@/models/model";
import axios from "axios";
import { useCallback, useEffect, type KeyboardEvent } from "react";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSend } from "./useAgentChatSend";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "composerEditorRef"
  | "setDraft"
  | "composerRef"
  | "draftRef"
  | "mentionOpen"
  | "dismissMention"
  | "setMentionStart"
  | "setMentionResults"
  | "setMentionIndex"
  | "setMentionLoading"
  | "setMentionLoadError"
  | "setMentionQuery"
  | "mentionQuery"
  | "mentionSearchGenRef"
  | "draft"
  | "mentionStart"
  | "mentionResults"
  | "mentionIndex"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "mentionProjects"
  | "mentionProjectsLoading"
  | "mentionProjectsLoadError"
> &
  Pick<
  ReturnType<typeof useAgentChatSend>,
  | "handleSend"
>;

export function useAgentChatComposer({
  composerEditorRef, setDraft, composerRef, draftRef, mentionOpen, dismissMention, setMentionStart,
  setMentionResults, setMentionIndex, setMentionLoading, setMentionLoadError, setMentionQuery,
  mentionQuery, mentionSearchGenRef, mentionProjects, mentionProjectsLoading,
  mentionProjectsLoadError, draft, mentionStart, mentionResults, mentionIndex, handleSend,
}: Props) {
  // AudioButton's dictation callback. There is no Tiptap editor here, so this
  // mirrors appendDictationToTitle (TaskTitleModal.tsx): append transcript
  // text to the plain-string draft, same append helper.
  const insertDictation = useCallback((transcript: string) => {
    const editor = composerEditorRef.current;
    if (editor) {
      const prefix = editor.getText().trim() ? " " : "";
      editor.chain().focus("end").insertContent(prefix + transcript).run();
      return;
    }
    setDraft((current) => appendTitleDictation(current, transcript));
    composerRef.current?.focus();
  }, []);

  // Detects an in-progress "@mention" ending at the cursor (must start at the
  // beginning of the text or after whitespace, same rule as the composer's
  // other autocomplete-style features).
  const handleComposerChange = (value: string, cursor: number) => {
    setDraft(value);
    // Typing is the one path fast enough to outrun the passive effect that
    // normally mirrors `draft`, and selectAgent reads this ref to decide what
    // to save for the agent being left.
    draftRef.current = value;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) {
      if (mentionOpen) dismissMention();
      return;
    }
    setMentionStart(cursor - match[1].length - 1);
    setMentionResults([]);
    setMentionIndex(0);
    setMentionLoading(true);
    setMentionLoadError(false);
    setMentionQuery(match[1]);
  };

  // Same endpoint and request shape as the Ctrl+K task search modal
  // (src/components/Modals/commands/searchTasks.tsx).
  useEffect(() => {
    if (mentionQuery === null) return;
    const myGen = ++mentionSearchGenRef.current;
    const projectIds = (mentionProjects as IProject[]).map((p) => p.id);
    if (projectIds.length === 0) {
      setMentionResults((prev) => (prev.length === 0 ? prev : []));
      setMentionIndex(0);
      setMentionLoading(mentionProjectsLoading);
      setMentionLoadError(mentionProjectsLoadError);
      return;
    }
    let active = true;
    setMentionResults((prev) => (prev.length === 0 ? prev : []));
    setMentionIndex(0);
    setMentionLoading(true);
    setMentionLoadError(false);
    const timeout = setTimeout(
      async () => {
        try {
          const res = await axios.post("/api/tasks/searchAll", {
            projectIds,
            ...(mentionQuery.trim()
              ? { searchQuery: mentionQuery.trim() }
              : { mode: "recent" }),
          });
          if (!active || myGen !== mentionSearchGenRef.current) return;
          const results = Array.isArray(res.data) ? res.data : [];
          setMentionResults(results.slice(0, 8));
          setMentionIndex(0);
        } catch {
          if (active && myGen === mentionSearchGenRef.current) {
            setMentionResults([]);
            setMentionLoadError(true);
          }
        } finally {
          if (active && myGen === mentionSearchGenRef.current) {
            setMentionLoading(false);
          }
        }
      },
      mentionQuery.trim() ? 150 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [
    mentionProjects,
    mentionProjectsLoadError,
    mentionProjectsLoading,
    mentionQuery,
  ]);

  const pickMention = (task: ITask) => {
    const ticket = task.ticketNumber ?? `${task.projectId}-${task.uniqueIndex}`;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    const inserted = `${before}${ticket} ${after}`;
    setDraft(inserted);
    dismissMention();
    requestAnimationFrame(() => {
      const editor = composerEditorRef.current;
      if (editor) {
        editor.commands.setContent(inserted, { emitUpdate: false });
        editor.commands.focus();
        const pos = Math.min(
          before.length + ticket.length + 2,
          editor.state.doc.content.size,
        );
        editor.commands.setTextSelection(pos);
        return;
      }
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + ticket.length + 1;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissMention();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, Math.max(mentionResults.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && mentionResults[mentionIndex]) {
        e.preventDefault();
        pickMention(mentionResults[mentionIndex]);
        return;
      }
    }
    // Plain Enter already sends (unless Shift+Enter, which stays a newline);
    // Ctrl/Cmd+Enter is the same action, so no extra branch is needed for it.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };


  return {
    insertDictation, handleComposerChange, pickMention, handleComposerKeyDown,
  };
}
