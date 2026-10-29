import { HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG } from "@/lib/flags/definitions/htpr-8173-description-inline-drafts";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG } from "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { HTPR_7393_COMMENT_INLINE_AI_FLAG, HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
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
import { HTPR_6899_STABLE_LAYOUT_FLAG } from "@/lib/flags/keys";
export function useTaskDetailEditorEvents(context: TaskDetailEditorPresentation) {
  const stableLayout = useStableLayoutFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const { setShouldShowAITaskWriter, shouldTriggerAiTaskWriter, mode, reply, editor, isMbl, isSelected, handleFocus, shouldShowFullAiTaskWriter, divIds, calculatePopoverPosition, updateDrafts, editorContent, setEditorContent, defaultContent, resetDraft, discardDraft, setResetDraft, id, setAiTriggerData, currentTask, suggestReplyAbortRef, shouldShowInlineDraftAiRef, setTrigger, setEmojiGifPicker, handleOutsideClickDescription, handleOutsideClickComment } = context;


  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const commentInlineAi = useFlag(HTPR_7393_COMMENT_INLINE_AI_FLAG);
  const descriptionInlineDrafts = useFlag(HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG);
  const sidebarEditWithAi = editWithAiEnabled && !(commentInlineAi && (mode === "create-comment" || mode === "read-edit-comments")) && !(descriptionInlineDrafts && mode === "read-edit-description");
  const skillRunsInSidebar = useFlag(HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG);
  const { editTicketWithAi, runCommentSkill } = useCommentToAiChat();
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  let newTaskWindow = false;
  if (mode === "read-edit-description" && !descriptionInlineDrafts && composeEnabled && newTaskWindowFlag) newTaskWindow = true;
  const setCommands = useSetRecoilState(showCommandsAtom);

  useEffect(() => {
    setShouldShowAITaskWriter(shouldTriggerAiTaskWriter && !newTaskWindow);
  }, [mode, shouldTriggerAiTaskWriter, newTaskWindow]);

  const insertReply = (block: ScrollLogicalPosition = "start", behavior: ScrollBehavior = "smooth") => {
    if (reply) {
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
  useEffect(stableLayout ? () => insertReply("center", "auto") : insertReply, [editor, reply]);

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

  let handleAITrigger = (event: CustomEvent<AITaskWriterEventDetail>) => {
    if (event.detail.targetId === id) {
      if (newTaskWindow && !event.detail.prompt) {
        setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
        return;
      }
      setAiTriggerData({
        autoTrigger: !(descriptionInlineDrafts && mode === "read-edit-description"),
        initialPrompt: event.detail.prompt
      });
      setShouldShowAITaskWriter(true);
    }
  };
  if (sidebarEditWithAi) {
    handleAITrigger = (event: CustomEvent<AITaskWriterEventDetail>) => {
      if (event.detail.targetId === id) void editTicketWithAi(currentTask.id);
    };
  }

  if (skillRunsInSidebar && (mode === "create-comment" || mode === "read-edit-comments")) {
    const handleOtherAITrigger = handleAITrigger;
    handleAITrigger = (event: CustomEvent<AITaskWriterEventDetail>) => {
      if (event.detail.targetId !== id) return;
      if (!/^\/[a-z0-9][a-z0-9-]*\s/.test(event.detail.prompt ?? "")) {
        handleOtherAITrigger(event);
        return;
      }
      setShouldShowAITaskWriter(false);
      void runCommentSkill(currentTask.id, event.detail.prompt, editor?.getText() ?? "").then((sent) => {
        if (!sent) toast.error("Could not run the skill. Please try again.");
      }).catch(() => toast.error("Could not run the skill. Please try again."));
    };
  }

  useLayoutEffect(() => {
    window.addEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
    return () => window.removeEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
  }, [id, newTaskWindow, setCommands, sidebarEditWithAi, descriptionInlineDrafts, editTicketWithAi, currentTask?.id, skillRunsInSidebar, runCommentSkill, mode, editor]);

  useEffect(() => {
    if (mode !== "create-comment") return;

    const suggestReplyHandler = async () => {
      if (!editor || !currentTask?.id || suggestReplyAbortRef.current) return;
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
      suggestReplyAbortRef.current?.abort();
    };

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
