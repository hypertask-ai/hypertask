import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
// Tiptap.tsx
import { useEffect, useLayoutEffect } from "react";
import toast from "react-hot-toast";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import axios from "axios";
import { AI_TASK_WRITER_EVENT, AITaskWriterEventDetail } from "../PageComponents/TaskDetail/TopRow/CreateSummaryButton";
import { AI_SUGGEST_REPLY_ENDPOINT, AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { OPEN_EMOJI_GIF_PICKER_EVENT } from "./Components/EmojiGifPicker";
import type { EmojiGifPickerEventDetail } from "./Components/EmojiGifPicker";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorPresentation } from "./taskDetailEditorPresentation";
import { useFlag as useStableLayoutFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6899_STABLE_LAYOUT_FLAG } from "@/lib/flags/keys";
export function useTaskDetailEditorEvents(context: TaskDetailEditorPresentation) {
  const instantTicketOpen = useStableLayoutFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const stableLayout = useStableLayoutFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const { setShouldShowAITaskWriter, shouldTriggerAiTaskWriter, mode, reply, editor, isMbl, isSelected, handleFocus, shouldShowFullAiTaskWriter, divIds, calculatePopoverPosition, updateDrafts, editorContent, setEditorContent, defaultContent, resetDraft, discardDraft, setResetDraft, id, setAiTriggerData, currentTask, suggestReplyAbortRef, shouldShowInlineDraftAiRef, setTrigger, setEmojiGifPicker, handleOutsideClickDescription, handleOutsideClickComment } = context;


  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  let newTaskWindow = false;
  if (mode === "read-edit-description" && composeEnabled && newTaskWindowFlag) newTaskWindow = true;
  const setCommands = useSetRecoilState(showCommandsAtom);

  useEffect(() => {
    // Ctrl/Cmd+J changes the parent edit mode after this editor has already
    // mounted. Keep the local writer surface in sync for descriptions and
    // existing comments as well as the new-comment composer.
    setShouldShowAITaskWriter(shouldTriggerAiTaskWriter && !newTaskWindow);
  }, [mode, shouldTriggerAiTaskWriter, newTaskWindow]);

  const insertReply = (block: ScrollLogicalPosition = "start", behavior: ScrollBehavior = "smooth") => {
    if (reply) {
      // ponytail: quote starts with an inline mention, so it would glue onto whatever
      // the user already typed. Insert a real text node (HTML leading spaces get trimmed).
      const $from = editor?.state.selection.$from;
      const textBefore = $from ? $from.parent.textBetween(0, $from.parentOffset) : "";
      if (textBefore && !/\s$/.test(textBefore)) {
        editor?.commands.insertContent({ type: "text", text: " " });
      }
      editor?.commands.insertContent(reply + "<p></p>");
      if(isMbl) editor?.commands.focus('end')
    }
    if (isSelected) {
      if (mode === "create-comment") {
        document.getElementById("comment-input")?.scrollIntoView({
          behavior,
          block
        });
      }
      !isMbl && handleFocus();
      if (isMbl) {
        setTimeout(() => {
          document.getElementById("bottom")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      }
    }
  };
  useEffect(stableLayout && instantTicketOpen ? () => insertReply("center", "auto") : insertReply, [editor, reply]);

  useEffect(() => {
    if (!shouldShowFullAiTaskWriter) return;

    const timeoutId = setTimeout(() => {
      const popover = document.getElementById(divIds.popoverId);
      const targetDiv = document.getElementById(divIds.wrapperId);

      const resizeObserver = new ResizeObserver(() => {
        console.log("Size ==> is changing");
        if (popover && targetDiv) {
          calculatePopoverPosition(targetDiv, popover);
        }
      });

      if (popover) {
        resizeObserver.observe(popover);
      } else {
        targetDiv!.style.minHeight = "unset";
      }

      return () => resizeObserver.disconnect();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [shouldShowFullAiTaskWriter, divIds.popoverId, divIds.wrapperId]);

  useEffect(() => {
    const resetHighlight = () => {
      if (shouldShowFullAiTaskWriter) {
        updateDrafts(editorContent);
      }
    };

    if (shouldShowFullAiTaskWriter) {
      setEditorContent(editor?.getHTML() ?? defaultContent ?? "");
      editor?.chain().selectAll().setHighlight({ color: "#F0D8FF" }).run();
    }

    window.addEventListener("beforeunload", resetHighlight);
    return () => window.removeEventListener("beforeunload", resetHighlight);
  }, [editor, shouldShowFullAiTaskWriter]);

  useEffect(() => {
    if (resetDraft === "Description" || resetDraft === "Comment") {
      discardDraft(resetDraft);
      setResetDraft(undefined);
    }
  }, [resetDraft]);

  useLayoutEffect(() => {
    const handleAITrigger = (event: CustomEvent<AITaskWriterEventDetail>) => {
      if (event.detail.targetId === id) {
        if (newTaskWindow && !event.detail.prompt) {
          setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
          return;
        }
        setAiTriggerData({
          autoTrigger: true,
          initialPrompt: event.detail.prompt
        });
        setShouldShowAITaskWriter(true);
      }
    };

    window.addEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
    return () => window.removeEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
  }, [id, newTaskWindow, setCommands]);

  // Ctrl+K "Suggest reply": generate a draft reply into this comment composer.
  // The editor's update listener persists it as the user's private Comment
  // draft; publishing stays manual via the normal send/delete affordances.
  useEffect(() => {
    if (mode !== "create-comment") return;

    const suggestReplyHandler = async () => {
      if (!editor || !currentTask?.id || suggestReplyAbortRef.current) return;
      // Never overwrite an existing draft — the user must send or discard it
      // first, otherwise Suggest reply would silently destroy their text.
      const composerSnapshot = editor.getHTML().trim();
      if (composerSnapshot && composerSnapshot !== "<p></p>") {
        toast("Send or delete the current comment draft first.");
        return;
      }
      const loadingToast = toast.loading("Generating reply suggestion…");
      const abortController = new AbortController();
      suggestReplyAbortRef.current = abortController;
      try {
        document.getElementById("comment-input")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        const response = await axios.post(
          AI_SUGGEST_REPLY_ENDPOINT,
          { taskId: currentTask.id },
          { signal: abortController.signal }
        );
        if (response.status !== 200 || !response.data?.html) {
          throw new Error(response.data?.error ?? "No suggestion returned");
        }
        // The composer stayed editable while generating; if the user typed in
        // the meantime, don't replace what they wrote.
        if (editor.getHTML().trim() !== composerSnapshot) {
          toast.dismiss(loadingToast);
          toast("You started typing — the suggestion was not inserted.");
          return;
        }
        editor.commands.setContent(response.data.html, { emitUpdate: true });
        if (shouldShowInlineDraftAiRef.current) {
          editor.commands.selectAll();
        } else {
          editor.commands.focus("end");
        }
        setTrigger((prev) => !prev);
        toast.dismiss(loadingToast);
        toast.success("Reply draft ready — review, edit, then send or delete.");
      } catch (error) {
        // Navigating away from the task aborts the request on purpose; still
        // clear the loading toast so it can't linger.
        toast.dismiss(loadingToast);
        if (!axios.isCancel(error)) {
          toast.error("Could not generate a reply suggestion");
        }
      } finally {
        if (suggestReplyAbortRef.current === abortController)
          suggestReplyAbortRef.current = null;
      }
    };

    window.addEventListener(AI_SUGGEST_REPLY_EVENT, suggestReplyHandler as EventListener);
    return () => {
      window.removeEventListener(AI_SUGGEST_REPLY_EVENT, suggestReplyHandler as EventListener);
      // A stale suggestion for a previous task must never land in a new one.
      suggestReplyAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editor, currentTask?.id]);

  useEffect(() => {
    const handleOpenEmojiGifPicker = (event: Event) => {
      const detail = (event as CustomEvent<EmojiGifPickerEventDetail>).detail;
      if (mode !== "create-comment" || detail.editor !== editor) return;

      setEmojiGifPicker({
        initialTab: detail.initialTab,
        position: detail.position,
        anchorRect: detail.anchorRect,
      });
    };

    window.addEventListener(
      OPEN_EMOJI_GIF_PICKER_EVENT,
      handleOpenEmojiGifPicker
    );
    return () =>
      window.removeEventListener(
        OPEN_EMOJI_GIF_PICKER_EVENT,
        handleOpenEmojiGifPicker
      );
  }, [editor, mode]);

  useClickOutside(null, handleOutsideClickDescription, "description-container");
  useClickOutside(null, handleOutsideClickComment, "comment-input");
}
