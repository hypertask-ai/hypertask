import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7393_COMMENT_INLINE_AI_FLAG, HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG, HTPR_7792_REPLY_INBOX_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";

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
import { inboxMessageForTask } from "@/lib/taskDetailArchiveNavigation";
import { inboxDataQueryKey } from "@/lib/inboxQueryKeys";
import type { INotificationsFromTQ } from "@/hooks/Inbox/useGlobalFocusHandler";
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function useTaskDetailEditorSave(getContext: () => TaskDetailEditorContext) {
  const { cancelMobileExistingEditRef, setToggleHighlight, handleSave, saveInFlightRef, mobileEditSavingRef, mode, uploadingDescription, editor, newCommentAttachments, mobileExistingEditOpen, mobileEditSnapshotRef, hasDraft, hasDraftInit, setSaveInFlight, setMobileEditSaving, setShouldShowAITaskWriter, setChatHandoffOpen, setAiTriggerData, cancelDebounceRef, attachments, carouselAttachments, commentId, id, inboxFlow, currentTask, setTrigger, clearDescriptionDraftCache, setNewCommentAttachments, draftsFromTQ, queryClient, draftQueryKey, invalidateUserDrafts, allowEdit, isRecording, currentUser, isInboxFlow, inInbox, advanceOnSend, divIds, editMode, shouldShowAiTaskWriter, setEditMode, isMbl, isReadEditMode, mobileEditSessionActiveRef, toggleRecording, setEditState, defaultCommentFocus } = getContext();


  const toggleHighlightHandler = (state: boolean) => {
    return setToggleHighlight(state);
  };

  const handleCallback = async (mode_?: "moveToNext", inbox?: boolean, markAsDone?: boolean, refreshInbox = false) => {
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
      const content = editor?.getHTML()!;
      const text = editor?.getText() || "";
      if (refreshInbox && !inbox && currentUser?.id) {
        const { prefetchInboxQuery } = await import("@/hooks/Inbox/useGetNotifications");
        const queryKey = inboxDataQueryKey(currentUser.id);
        await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
        await prefetchInboxQuery(queryClient, currentUser.id);
        inbox = !!inboxMessageForTask(
          queryClient.getQueryData<INotificationsFromTQ>(queryKey)?.notifications,
          currentTask,
          currentUser.id,
        );
        if (inbox && isInboxFlow && advanceOnSend) mode_ = "moveToNext";
      }
      const result = await handleSave({
        content,
        text,
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

  const replyInbox = useFlag(HTPR_7792_REPLY_INBOX_FLAG);
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
        ((alwaysAdvance && isInboxFlow) ||
          (isInboxFlow && inInbox && advanceOnSend))
        ? "moveToNext"
        : undefined,
      !preserveTutorialInbox && inInbox,
      undefined,
      replyInbox && mode === "create-comment" && !preserveTutorialInbox,
    );
  };

  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  const setCommands = useSetRecoilState(showCommandsAtom);
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const commentInlineAi = useFlag(HTPR_7393_COMMENT_INLINE_AI_FLAG);
  const sidebarEditWithAi = editWithAiEnabled && !(commentInlineAi && (mode === "create-comment" || mode === "read-edit-comments"));
  const { editTicketWithAi } = useCommentToAiChat();
  const toggleAiTaskWriter = () => {
    if (sidebarEditWithAi) {
      editor?.commands.blur();
      setShouldShowAITaskWriter(false);
      if (mobileExistingEditOpen) setChatHandoffOpen(true);
      void editTicketWithAi(currentTask.id);
      return;
    }
    if (mode === "read-edit-description" && composeEnabled && newTaskWindowFlag) {
      setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
      return;
    }
    if (mobileExistingEditOpen) {
      setShouldShowAITaskWriter((prev) => !prev);
      return;
    }

    document.getElementById(divIds.popoverContainer)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    setShouldShowAITaskWriter((prev) => !prev);
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
    if (mode === "read-edit-comments") {
      setEditState(null);
      setEditMode(null);
    }
    defaultCommentFocus();
  }
  return { toggleHighlightHandler, handleCallback, sendComment, toggleAiTaskWriter, audioTiptapCallback, getAttachments, cancelMobileExistingEdit, handleCommentEscape };
}
