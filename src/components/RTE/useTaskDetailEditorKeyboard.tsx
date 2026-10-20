
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7393_COMMENT_INLINE_AI_FLAG, HTPR_7337_EDIT_WITH_AI_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { resolveCommentEnterShortcutAction } from "@/lib/taskDetailInboxFlow";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function useTaskDetailEditorKeyboard(getContext: () => TaskDetailEditorContext) {
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const setCommands = useSetRecoilState(showCommandsAtom);
  const { isInboxFlow, isApple, isRecording, isReadOnlyContent, mode, shouldShowInlineDraftAiRef, editor, mobileExistingEditOpen, discardDraft, inInbox, setFilesDropped, allowEdit, shouldShowAiTaskWriter, isMbl, handleTaskOptions, editMode, scrollVirtualize } = getContext();
  const commentInlineAi = useFlag(HTPR_7393_COMMENT_INLINE_AI_FLAG);
  const sidebarEditWithAi = editWithAiEnabled && !(commentInlineAi && (mode === "create-comment" || mode === "read-edit-comments"));


  const handleKeydown = (e: any) => {
    const { cancelMobileExistingEdit, handleCallback, handleCommentEscape, toggleAiTaskWriter, sendComment } = getContext();
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (isRecording) return;
    if (isReadOnlyContent) return;

    if (
      mode === "create-comment" &&
      !shouldShowInlineDraftAiRef.current &&
      e.shiftKey &&
      !cmdControl &&
      !e.altKey &&
      e.keyCode === 82 &&
      editor?.isEmpty
    ) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(AI_SUGGEST_REPLY_EVENT));
      return;
    }

    const handleEscape = () => {
      if (mobileExistingEditOpen) {
        cancelMobileExistingEdit();
        return;
      }
      if (mode === "read-edit-description") {
        void handleCallback();
        return;
      }
      handleCommentEscape();
    };
    const keyHandlers: Record<string, () => void> = {
      'Escape': handleEscape,
    };

    if (cmdControl) {
      if (e.shiftKey) {
        const shiftHandlers: Record<string, () => void> = {
          "49": () => (
            e.preventDefault(),
            editor?.chain().focus().toggleHeading({ level: 1 }).run()
          ),
          "50": () => (
            e.preventDefault(),
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          ),
          "65": () => (
            e.preventDefault(),
            document.getElementById(mode + "-attachmentUpload")?.click()
          ),
          "67": () => {
            e.preventDefault();
            const selectAllIfNeeded = () => {
              const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
              if (from === to) editor?.chain().focus().selectAll().run();
              return editor?.state.selection ?? { from: 0, to: 0 };
            };

            if (e.altKey) {
              const { from, to } = selectAllIfNeeded();
              const text = editor?.state.doc.textBetween(from, to, "\n");
              editor?.chain().focus().deleteSelection().insertContent({
                type: "codeBlock",
                content: text ? [{ type: "text", text }] : undefined,
                attrs: { language: "javascript" },
              }).run();
            } else {
              const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
              editor?.chain()
                .focus()
                .command(({ commands }) => (from === to ? commands.selectAll() : true))
                .setCode()
                .run();
            }
          },
          "68": () =>
            !isRecording &&
            (e.preventDefault(),
            document
              .getElementById(
                shouldShowInlineDraftAiRef.current
                  ? "inline-draft-ai-audio-button"
                  : mode + "-audio-button",
              )
              ?.click()),
          "70": () =>
            !isRecording &&
            !shouldShowInlineDraftAiRef.current &&
            (e.preventDefault(),
            document.getElementById(mode + "-audio-button-improve")?.click()),
          "188": () => (
            e.preventDefault(),
            discardDraft(mode === "create-comment" ? "Comment" : "Description")
          ),
        };
        shiftHandlers[e.keyCode]?.();
      }
      const enterAction = resolveCommentEnterShortcutAction({
        commandKey: cmdControl,
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        isInboxFlow,
        isCommentMode: mode === "create-comment",
        inInbox,
      });
      if (enterAction) {
        if (enterAction === "ignore") return;
        e.preventDefault();
        if (enterAction === "send-and-move") {
          sendComment(true);
        } else if (enterAction === "send-and-stay") {
          handleCallback();
        } else if (enterAction === "send-and-complete") {
          handleCallback(undefined, inInbox, true);
        } else if (enterAction === "send") {
          sendComment();
        }
      }
    }

    if (e.altKey && e.keyCode === 86 && !isRecording) {
      e.preventDefault();
      document
        .getElementById(
          shouldShowInlineDraftAiRef.current
            ? "inline-draft-ai-audio-button"
            : mode + "-audio-button",
        )
        ?.click();
    }

    if (e.key === "j" && cmdControl) {
      e.preventDefault();
      if (sidebarEditWithAi) setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
      else toggleAiTaskWriter();
    }
    keyHandlers[e.key]?.();
  };

  const resetDropFiles = () => {
    return setFilesDropped([]);
  };
  const handleFileDrop = async (droppedFiles: FileList) => {
    console.log("🚀 ~ handleFileDrop ~ droppedFiles:", droppedFiles);
    if (droppedFiles?.length > 0) setFilesDropped([...droppedFiles]);
  };

  const handleFocus = (forceFocus?: any) => {
    if (!allowEdit) return false;
    const focusEvent =
      forceFocus && typeof forceFocus === "object" ? forceFocus : null;
    if (editor?.isFocused || (shouldShowAiTaskWriter && !forceFocus)) return false;

    if (focusEvent && focusEvent.target !== focusEvent.currentTarget) return false;

    editor?.commands.focus("end");

    if (isMbl) {
      setTimeout(() => {
        document.getElementById("bottom")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        handleTaskOptions?.(false);
      }, 100);
    } else if (!isMbl && editMode === "description") {
      setTimeout(() => scrollVirtualize("edit-description"), 100);
    }
  };

  const handleOutsideClickDescription = () => {
    const { handleCallback } = getContext();
    if (
      mode === "read-edit-description" &&
      editor?.isFocused &&
      isMbl &&
      !mobileExistingEditOpen
    ) {
      handleCallback();
    }
  };

  const handleOutsideClickComment = () => {
    if (mode === "create-comment" && editor?.isFocused && isMbl) {
      editor?.commands.blur();
      handleTaskOptions?.(true);
    }
  };
  return { handleKeydown, resetDropFiles, handleFileDrop, handleFocus, handleOutsideClickDescription, handleOutsideClickComment };
}
