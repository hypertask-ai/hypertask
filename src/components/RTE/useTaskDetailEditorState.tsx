import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
// Tiptap.tsx
import { Dispatch, SetStateAction, useState, useRef } from "react";
import { IAttachment, IEditorAttachmentFile, IUser, RedirectAPIParams, RedirectMode } from "@/models/model";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom, inViewObjectAtom, showSetLinkModalAtom } from "@/store";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useTiptap from "./Tiptap";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useRouter, useSearchParams } from "next/navigation";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import type { EmojiGifPickerEventDetail } from "./Components/EmojiGifPicker";
import { shouldAdvanceAfterNotificationArchive } from "@/lib/taskDetailArchiveNavigation";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6559_KEEP_DIRECT_TASK_OPEN_FLAG } from "@/lib/flags/keys";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};

export type EditorAttachmentStateItem =
  | IEditorAttachmentFile
  | { id: number; file: IEditorAttachmentFile };

export interface TiptapProps {
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
export function useTaskDetailEditorState({
  allowPerks,
  defaultContent,
  createdAt,
  user,
  attachments,
  carouselAttachments,
  creatorname,
  isSelected,
  id,
  allowEdit,
  stack,
  reply,
  mode,
  handleSave,
  commentId,
  isMbl,
  shouldTriggerAiTaskWriter = false,
  setLoading,
  createNewComment = false,
  handleTaskOptions,
}: TiptapProps) {

  // Context and state setup
  const {
    parsedTask: taskFromServer,
    focusOn,
    setEditMode,
    setEditState,
    hasDraft,
    hasDraftInit,
    setHasDraftInit,
    editMode,
    currentId,
    descriptionFocusRequest,
    hasCommentDraft,
    defaultCommentFocus,
    isRecording,
    toggleRecording,
    scrollVirtualize,
    draftsFromTQ,
    setCarousalItems,
  } = useTaskContext();

  const { uploadingDescription, resetDraft, setResetDraft } = useDescriptionAndCommentsContext();
  const isApple = useDeviceContext();
  const queryClient = useQueryClient();
  const [currentUser] = useRecoilState(currentUserAtom);
  const [inViewObject] = useRecoilState(inViewObjectAtom);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Computed values
  const inboxFlow = searchParams?.get("inboxFlow");
  const currentTask = JSON.parse(taskFromServer);
  const inInbox = currentTask?._count?.notifications > 0;
  const isInboxFlow = shouldAdvanceAfterNotificationArchive(inboxFlow);
  const isReadEditMode =
    mode === "read-edit-description" || mode === "read-edit-comments";
  const isReadOnlyContent = isReadEditMode && !allowEdit;
  const { data: userPreferences } = useGetUserPreferences();
  const advanceOnSend = userPreferences.inboxAdvanceOnSend ?? true;
  const consistentCommentShortcuts = useFlag(
    "htpr-5913-consistent-comment-shortcuts",
  );
  const keepDirectTaskOpen = useFlag(HTPR_6559_KEEP_DIRECT_TASK_OPEN_FLAG);
  const draftQueryKey = ["draft for [task,userId]:", currentTask?.id, currentUser?.id];

  // State
  const { editor } = useTiptap({
    mode,
    defaultContent,
    createNewComment,
    mentionProjectId: currentTask?.projectId,
  });
  const [editorContent, setEditorContent] = useState<string>("");
  const [scrolledOnMobile, setScrolledOnMobile] = useState<boolean>(false);
  const [toggleHighlight, setToggleHighlight] = useState<boolean>(false);
  const [trigger, setTrigger] = useState(false);
  const [filesDropped, setFilesDropped] = useState<File[]>([]);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  const [writerOpen, setShouldShowAITaskWriter] = useState(shouldTriggerAiTaskWriter);
  const shouldShowAiTaskWriter = writerOpen && !(composeEnabled && newTaskWindowFlag);
  const [aiTriggerData, setAiTriggerData] = useState({
    autoTrigger: false,
    initialPrompt: ''
  });
  const suggestReplyAbortRef = useRef<AbortController | null>(null);
  const shouldShowInlineDraftAiRef = useRef(false);
  const [showSetLinkModal, setShowSetLinkModal] = useRecoilState(showSetLinkModalAtom);
  const pendingGuestDescriptionFocusTaskRef = useRef<number | null>(null);
  const handledDescriptionFocusNonceRef = useRef(0);
  const [emojiGifPicker, setEmojiGifPicker] = useState<
    Omit<EmojiGifPickerEventDetail, "editor"> | null
  >(null);
  const mobileExistingEditOpen = Boolean(isMbl && isReadEditMode && allowEdit);
  const mobileEditViewport = useMobileVisualViewport(mobileExistingEditOpen);
  const mobileEditHeight = mobileEditViewport
    ? `${mobileEditViewport.visibleHeight}px`
    : "100dvh";
  const [mobileEditSaving, setMobileEditSaving] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const mobileEditSavingRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const mobileEditSessionActiveRef = useRef(false);
  const cancelMobileExistingEditRef = useRef<() => void>(() => {});

  const mobileEditSnapshotRef = useRef<{
    html: string;
    attachments: EditorAttachmentStateItem[];
  } | null>(null);

  const [newCommentAttachments, setNewCommentAttachments] = useState<
    EditorAttachmentStateItem[]
  >(
    (attachments ?? []).map((originalItem, index) => ({
      id: index,
      file: {
        id: originalItem.id,
        createdAt: originalItem.createdAt,
        type: originalItem.fileType,
        source: originalItem.fileSource,
        name: originalItem.fileName,
        size: originalItem.fileSize,
        taskId: originalItem.taskId,
      },
    }))
  );
  // Debug: Log initial attachments format
  // Commented this out. Too many console logs when I am typing
  // console.log("🚀 ~ Initial newCommentAttachments format:", newCommentAttachments);

  // IDs for elements
  const divIds = {
    wrapperId: "main-wrapper-" + id,
    popoverContainer: "popover-wrapper-" + id,
    popoverId: "popoverId" + id,
    editorId: id,
    popoverTriggerButtonId: "popover-button-" + id,
  };
  return { allowPerks, defaultContent, createdAt, user, attachments, carouselAttachments, creatorname, isSelected, id, allowEdit, stack, reply, mode, handleSave, commentId, isMbl, shouldTriggerAiTaskWriter, setLoading, createNewComment, handleTaskOptions, taskFromServer, focusOn, setEditMode, setEditState, hasDraft, hasDraftInit, setHasDraftInit, editMode, currentId, descriptionFocusRequest, hasCommentDraft, defaultCommentFocus, isRecording, toggleRecording, scrollVirtualize, draftsFromTQ, setCarousalItems, uploadingDescription, resetDraft, setResetDraft, isApple, queryClient, currentUser, inViewObject, router, searchParams, inboxFlow, currentTask, inInbox, isInboxFlow, isReadEditMode, isReadOnlyContent, userPreferences, advanceOnSend, consistentCommentShortcuts, keepDirectTaskOpen, draftQueryKey, editor, editorContent, setEditorContent, scrolledOnMobile, setScrolledOnMobile, toggleHighlight, setToggleHighlight, trigger, setTrigger, filesDropped, setFilesDropped, shouldShowAiTaskWriter, setShouldShowAITaskWriter, aiTriggerData, setAiTriggerData, suggestReplyAbortRef, shouldShowInlineDraftAiRef, showSetLinkModal, setShowSetLinkModal, pendingGuestDescriptionFocusTaskRef, handledDescriptionFocusNonceRef, emojiGifPicker, setEmojiGifPicker, mobileExistingEditOpen, mobileEditViewport, mobileEditHeight, mobileEditSaving, setMobileEditSaving, saveInFlight, setSaveInFlight, mobileEditSavingRef, saveInFlightRef, mobileEditSessionActiveRef, cancelMobileExistingEditRef, mobileEditSnapshotRef, newCommentAttachments, setNewCommentAttachments, divIds };
}

export type useTaskDetailEditorStateValue = ReturnType<typeof useTaskDetailEditorState>;
