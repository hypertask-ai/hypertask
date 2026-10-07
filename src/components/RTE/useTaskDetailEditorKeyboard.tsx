
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { resolveCommentEnterShortcutAction } from "@/lib/taskDetailInboxFlow";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function useTaskDetailEditorKeyboard(getContext: () => TaskDetailEditorContext) {
  const { consistentCommentShortcuts, isInboxFlow, isApple, isRecording, isReadOnlyContent, mode, shouldShowInlineDraftAiRef, editor, mobileExistingEditOpen, discardDraft, inInbox, setFilesDropped, allowEdit, shouldShowAiTaskWriter, isMbl, handleTaskOptions, editMode, scrollVirtualize } = getContext();


  const handleKeydown = (e: any) => {
    const { cancelMobileExistingEdit, handleCallback, handleCommentEscape, toggleAiTaskWriter, sendComment } = getContext();
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (isRecording) return;
    // Persistent description and Figma-comment editors stay mounted while
    // reading. Their shortcuts must stay inert until edit mode is active.
    if (isReadOnlyContent) return;

    // Shift+R: same flow as Ctrl+K → Suggest reply (empty comment composer).
    // Inline AI float owns Shift+R while open (prompt state + empty draft).
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
      'j': () => cmdControl && (e.preventDefault(), toggleAiTaskWriter()),
    };

    // Shortcut handlers
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
      // Enter key combinations
      const enterAction = resolveCommentEnterShortcutAction({
        commandKey: cmdControl,
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        consistentCommentShortcuts,
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

    // When focus arrives from clicking inside the editor text, the browser has
    // already placed the caret at the click point — respect it. Only pull the
    // caret to the end when focus lands on the wrapper itself (e.g. clicking the
    // empty padding) or when forced via handleFocus(true)/handleFocus().
    if (focusEvent && focusEvent.target !== focusEvent.currentTarget) return false;

    editor?.commands.focus("end");

    if (isMbl) {
      //We shall look at mobile later
      //Too tired here. I think im supposed to replace this document scroll with scroll virtualize
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
