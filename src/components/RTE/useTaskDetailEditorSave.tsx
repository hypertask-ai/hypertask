
import { IDraft, IEditorAttachmentFile, RedirectMode } from "@/models/model";
import { cancelPendingDraftUpdates } from "@/utils/api/Task Detail";
import toast from "react-hot-toast";
import { shouldSkipUnchangedMobileDescriptionSave } from "./draftSync";
import { getLearnTutorialStorageKey, parseLearnTutorialState, shouldPreserveLearnTutorialInboxOnComment } from "@/lib/tutorial/learnTutorialState";
import { snapshotDescriptionAttachments } from "@/lib/ai/autoDescriptionSuggestion";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function useTaskDetailEditorSave(getContext: () => TaskDetailEditorContext) {
  const { cancelMobileExistingEditRef, setToggleHighlight, handleSave, saveInFlightRef, mobileEditSavingRef, mode, uploadingDescription, editor, newCommentAttachments, mobileExistingEditOpen, mobileEditSnapshotRef, hasDraft, hasDraftInit, setSaveInFlight, setMobileEditSaving, setShouldShowAITaskWriter, setAiTriggerData, cancelDebounceRef, attachments, carouselAttachments, commentId, id, inboxFlow, currentTask, setTrigger, clearDescriptionDraftCache, setNewCommentAttachments, draftsFromTQ, queryClient, draftQueryKey, invalidateUserDrafts, allowEdit, isRecording, currentUser, keepDirectTaskOpen, isInboxFlow, inInbox, advanceOnSend, divIds, editMode, shouldShowAiTaskWriter, setEditMode, isMbl, isReadEditMode, mobileEditSessionActiveRef, toggleRecording, setEditState, defaultCommentFocus } = getContext();


  // Event handlers
  const toggleHighlightHandler = (state: boolean) => {
    return setToggleHighlight(state);
  };

  const handleCallback = async (mode_?: "moveToNext", inbox?: boolean, markAsDone?: boolean) => {
    if (!handleSave || saveInFlightRef.current) return;
    if (mobileEditSavingRef.current) return;

    if (mode === "read-edit-description" && uploadingDescription) return false;

    if (mode === "create-comment" && editor?.isEmpty && newCommentAttachments.length === 0) {
      toast("Cannot post a blank comment");
      return false;
    }

    const isMobileExistingSave = mobileExistingEditOpen;
    const openingSnapshot = mobileEditSnapshotRef.current;
    if (
      openingSnapshot &&
      editor &&
      shouldSkipUnchangedMobileDescriptionSave({
        isMobileExistingSave,
        mode,
        hasDraft: hasDraft || hasDraftInit,
        openingHtml: openingSnapshot.html,
        currentHtml: editor.getHTML(),
        attachmentsChanged:
          snapshotDescriptionAttachments(openingSnapshot.attachments) !==
          snapshotDescriptionAttachments(newCommentAttachments),
      })
    ) {
      cancelMobileExistingEditRef.current();
      return true;
    }

    saveInFlightRef.current = true;
    setSaveInFlight(true);

    if (isMobileExistingSave) {
      mobileEditSavingRef.current = true;
      setMobileEditSaving(true);
      setShouldShowAITaskWriter(false);
      setAiTriggerData({ initialPrompt: "", autoTrigger: false });
    }
    editor?.setEditable(false, false);

    cancelDebounceRef.current?.();
    if (mode === "read-edit-description") cancelPendingDraftUpdates();
    editor?.commands.blur();

    console.log("🚀 ~ Saving", mode, "with", newCommentAttachments.length, "attachments");
    const currentAttachmentFiles = newCommentAttachments.map((attachment) =>
      "file" in attachment ? attachment.file : attachment,
    );
    let attachmentFilesForSave: IEditorAttachmentFile[] | undefined =
      currentAttachmentFiles;
    // An undefined attachment list means this editor has no replacement
    // snapshot (desktop comments); preserve stored files in that case. Mobile
    // editing passes [] when the user intentionally removes every file.
    const hasAttachmentSnapshot = attachments !== undefined;
    if (mode === "read-edit-comments" && !hasAttachmentSnapshot) {
      attachmentFilesForSave =
        currentAttachmentFiles.length === 0
          ? undefined
          : [
              ...(carouselAttachments ?? []).map((attachment) => ({
                name: attachment.fileName,
                size: attachment.fileSize,
                type: attachment.fileType,
                source: attachment.fileSource,
              })),
              ...currentAttachmentFiles,
            ];
    }
    try {
      const result = await handleSave({
        content: editor?.getHTML()!,
        text: editor?.getText() || "",
        id: mode === "read-edit-comments" ? commentId! : id,
        mode: mode as RedirectMode,
        attachments_: attachmentFilesForSave,
        navigateToNext: mode_ ? true : false,
        inbox: inbox,
        inboxFlow: inboxFlow,
        markAsDone: markAsDone,
        taskStatus: currentTask?.status,
      });
      const saved = result !== false;
      if (!saved) return false;

      setTrigger(prev => !prev);
      if (mode === "read-edit-description") {
        clearDescriptionDraftCache();
      } else {
        setNewCommentAttachments([]);
        const updatedDraft = draftsFromTQ
          ?.filter((draft: IDraft) => draft.type === "Description");
        queryClient.setQueryData(draftQueryKey, updatedDraft);
        invalidateUserDrafts();
      }

      if (mode === "create-comment") {
        editor?.commands.setContent("");
        editor?.commands.blur();
      }
      return true;
    } catch (error) {
      console.error("Could not save editor content", error);
      toast.error("Could not save. Your changes are still here.");
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaveInFlight(false);
      if (isMobileExistingSave) {
        mobileEditSavingRef.current = false;
        setMobileEditSaving(false);
      }
      if (allowEdit && editor && !editor.isDestroyed) {
        editor.setEditable(!isRecording, false);
      }
    }
  };

  // A task can still carry an inbox notification when opened from another
  // surface. The fix limits advancement to Inbox lineage while its flag is on.
  const sendComment = (alwaysAdvance = false) => {
    const tutorialState = currentUser?.id
      ? parseLearnTutorialState(
          window.sessionStorage.getItem(
            getLearnTutorialStorageKey(currentUser.id),
          ),
        )
      : null;
    const preserveTutorialInbox = shouldPreserveLearnTutorialInboxOnComment(
      tutorialState,
      currentTask?.id,
    );
    return handleCallback(
      !preserveTutorialInbox &&
        ((alwaysAdvance && (!keepDirectTaskOpen || isInboxFlow)) ||
          (isInboxFlow && inInbox && advanceOnSend))
        ? "moveToNext"
        : undefined,
      !preserveTutorialInbox && inInbox,
    );
  };

  const toggleAiTaskWriter = () => {
    if (mobileExistingEditOpen) {
      setShouldShowAITaskWriter((prev) => !prev);
      return;
    }

    document.getElementById(divIds.popoverContainer)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    setShouldShowAITaskWriter((prev) => !prev);
    //Make sure when toggling the edit Mode is updated as well.
    if (editMode === "description" && !shouldShowAiTaskWriter)
      setEditMode("description-ai");
  };

  const audioTiptapCallback = (text: string, setContent: boolean = false) => {
    if (isMbl && isReadEditMode && !mobileEditSessionActiveRef.current) return;
    if (editor) {
      setContent ?
        editor.chain().setContent(text).focus("end").run() :
        editor.chain().focus().insertContent(text).run();
    }
  };

  const getAttachments = async (files: File[]) => {
    setNewCommentAttachments(files.map((file, id) => ({ id, file })));
  };

  const cancelMobileExistingEdit = () => {
    if (!mobileExistingEditOpen || mobileEditSavingRef.current) return;

    mobileEditSessionActiveRef.current = false;
    toggleRecording(false);
    cancelDebounceRef.current?.();
    if (mode === "read-edit-description") cancelPendingDraftUpdates();
    setShouldShowAITaskWriter(false);
    setAiTriggerData({ initialPrompt: "", autoTrigger: false });

    const snapshot = mobileEditSnapshotRef.current;
    if (snapshot && editor && !editor.isDestroyed) {
      editor.commands.setContent(snapshot.html, { emitUpdate: false });
      setNewCommentAttachments(snapshot.attachments);
      setTrigger((prev) => !prev);
      editor.commands.blur();
    }

    if (mode === "read-edit-comments") setEditState(null);
    setEditMode(null);
  };
  cancelMobileExistingEditRef.current = cancelMobileExistingEdit;

  function handleCommentEscape () {
    editor?.commands.blur();
    // Editing an existing comment: actually leave edit mode (revert to the
    // read view) instead of only blurring. editState/editMode are what keep
    // CommentText rendering the editor, so clearing them is the real exit —
    // for both ESC and the footer's cancel trash. Unchanged for create-comment.
    if (mode === "read-edit-comments") {
      setEditState(null);
      setEditMode(null);
    }
    defaultCommentFocus();
  }
  return { toggleHighlightHandler, handleCallback, sendComment, toggleAiTaskWriter, audioTiptapCallback, getAttachments, cancelMobileExistingEdit, handleCommentEscape };
}
