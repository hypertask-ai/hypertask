// Tiptap.tsx
import { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { IAttachment, IDraft, IUser, RedirectAPIParams, RedirectMode } from "@/models/model";
import { updateDraftHelper } from "@/utils/api/Task Detail";
import useDebounceWithCancel from "@/hooks/General/useDebounceWithCancel";
import { USER_DRAFTS_QUERY_KEY } from "@/hooks/General/useGetUserDrafts";
import axios from "axios";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorState } from "./TaskDetailEditorState";

interface TiptapProps {
  attachments?: IAttachment[];
  carouselAttachments?: IAttachment[];
  defaultContent?: string;
  createdAt?: string;
  stack?: boolean;
  allowPerks: boolean;
  user?: IUser | undefined;
  creatorname: any;
  isSelected: boolean;
  id: string;
  allowEdit: boolean;
  reply?: string | null | undefined;
  mode: RedirectMode;
  customPlaceholder?: string;
  commentId?: string;
  className1?: string;
  currentUserclassName?: string;
  isMbl?: boolean;
  randomUserclassName?: string;
  currentUserCommentInfo?: string;
  randomUserCommentInfo?: string;
  descriptionClass?: string;
  handleSave?: (
    params: RedirectAPIParams
  ) => boolean | void | Promise<boolean | void>;
  setLoading?: Dispatch<SetStateAction<boolean>>;
  shouldTriggerAiTaskWriter?: boolean;
  currentTask?: any;
  createNewComment?: boolean;
  handleTaskOptions?: (val: boolean) => void;
}

interface PendingDraftUpdate {
  content: string;
  projectId: number | null | undefined;
  taskId: number | null | undefined;
}
export function useTaskDetailEditorDrafts(context: TaskDetailEditorState) {
  const { handleSave, mode, queryClient, currentUser, currentTask, hasDraftInit, setHasDraftInit, draftsFromTQ, draftQueryKey, editor, setTrigger, setEditMode, defaultCommentFocus, focusOn, scrollVirtualize, inViewObject, uploadingDescription } = context;


  // Draft management
  const invalidateUserDrafts = () => {
    queryClient.invalidateQueries({
      queryKey: USER_DRAFTS_QUERY_KEY(currentUser?.id),
    });
  };

  const discardDraft = async (discard: "Description" | "Comment") => {
    const body = { taskId: currentTask.id, draftType: discard };
    const response = await axios.post("/api/drafts/deleteDrafts", body);

    if (response.status === 200) {
      if (hasDraftInit) setHasDraftInit(false);
      const updatedDraft = draftsFromTQ
        ?.filter((draft: IDraft) => draft.type !== discard);

      queryClient.setQueryData(draftQueryKey, updatedDraft);
      invalidateUserDrafts();

      if (discard === "Comment") {
        editor?.commands.clearContent();
        setTrigger(prev => !prev);
      }

      editor?.commands.blur();
      setEditMode(null);

      if (discard === "Comment") {
        defaultCommentFocus();
      } else {
        focusOn(descriptionContainerId, false);
        scrollVirtualize("description");
      }
    }
  };

  const clearDescriptionDraftCache = () => {
    const currentDrafts: IDraft[] = queryClient.getQueryData(draftQueryKey) ?? [];
    queryClient.setQueryData(
      draftQueryKey,
      currentDrafts.filter((draft) => draft.type !== "Description")
    );
    if (hasDraftInit) setHasDraftInit(false);
    invalidateUserDrafts();
  };

  const updateDrafts = async (
    input: string,
    target?: Omit<PendingDraftUpdate, "content">
  ) => {
    // A debounced update may flush while navigation is changing the global
    // in-view task. Prefer the IDs captured with the editor update so content
    // can never be written into the next task's draft slot.
    const projectId = target ? target.projectId : inViewObject.taskProjectId;
    const taskId = target ? target.taskId : inViewObject.taskId;

    if (input === "" || !handleSave || !projectId || !taskId) {
      return;
    }

    const targetDraftQueryKey = [
      "draft for [task,userId]:",
      taskId,
      currentUser?.id,
    ];

    // Editing an existing comment must NOT autosave a draft. The edit editor
    // always initialises from comment.text (never the draft), so this write is
    // never read back for the edit — it only lands in the shared "Comment"
    // draft slot that the new-comment composer restores, leaving the composer
    // polluted with the edited comment's text after you exit. Skip it.
    if (mode === "read-edit-comments") return;

    const draftType = mode === "read-edit-description" ? "Description" : "Comment";

    // Don't update drafts if we're currently uploading/saving
    if (uploadingDescription) {
      return;
    }

    // Update draft via API (debounced calls will be canceled by the helper)
    void updateDraftHelper(
      projectId,
      taskId,
      currentUser.id!,
      draftType,
      input
    ).then((response) => {
      if (response?.status === 200) invalidateUserDrafts();
    });

    const currentDrafts: IDraft[] =
      queryClient.getQueryData(targetDraftQueryKey) ?? [];
    const existingDraft = currentDrafts.find((draft) => draft.type === draftType);

    if (existingDraft) {
      const updatedDrafts = currentDrafts.map((draft) =>
        draft.type === draftType ? { ...draft, content: input } : draft
      );
      queryClient.setQueryData(targetDraftQueryKey, updatedDrafts);
    } else {
      queryClient.setQueryData(targetDraftQueryKey, [
        ...currentDrafts,
        {
          id: -1,
          type: draftType,
          content: input,
          saved: false,
          userId: currentUser.id!,
          projectId,
          taskId,
        },
      ]);
    }
  };

  const [debouncedRequest, cancelDebounce] = useDebounceWithCancel((pending: PendingDraftUpdate) => {
    updateDrafts(pending.content, pending);
  }, 750, true);

  const cancelDebounceRef = useRef(cancelDebounce);

  useEffect(() => {
    cancelDebounceRef.current = cancelDebounce;
  }, [cancelDebounce]);
  return { invalidateUserDrafts, discardDraft, clearDescriptionDraftCache, updateDrafts, debouncedRequest, cancelDebounce, cancelDebounceRef };
}

export type TaskDetailEditorDraftState = TaskDetailEditorState & ReturnType<typeof useTaskDetailEditorDrafts>;
