// Tiptap.tsx
import {
  Dispatch,
  SetStateAction,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
} from "react";
import "@/styles/attachmentUpload.scss";
import {
  IAttachment,
  IDraft,
  ITaskLabel,
  IUser,
  RedirectAPIParams,
  RedirectMode,
} from "@/models/model";
import { useQueryClient } from "@tanstack/react-query";
import {
  cancelPendingDraftUpdates,
  updateDraftHelper,
  updateTask,
} from "@/utils/api/Task Detail";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom, inViewObjectAtom, showSetLinkModalAtom } from "@/store";
import useDebounceWithCancel from "@/hooks/General/useDebounceWithCancel";
import { USER_DRAFTS_QUERY_KEY } from "@/hooks/General/useGetUserDrafts";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import toast from "react-hot-toast";
import TiptapProvider from "@/lib/contexts/TaskDetail/TiptapProvider";
import TiptapBubbleMenu from "./Components/TiptapBubbleMenu";
import TiptapMainContainer from "./Components/TiptapMainContainer";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import useTiptap from "./Tiptap";
import { setInLocalStorage } from "@/utils/helperFunctions/helperFunctions";
import { AITaskWriterWithProvider as AITaskWriterContainer } from "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useRouter, useSearchParams } from "next/navigation";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import axios from "axios";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { userPreferencesRoute } from "@/lib/constants/APIRouteConstants";
import { AI_TASK_WRITER_EVENT, AITaskWriterEventDetail } from "../PageComponents/TaskDetail/TopRow/CreateSummaryButton";
import {
  AI_SUGGEST_REPLY_ENDPOINT,
  AI_SUGGEST_REPLY_EVENT,
} from "@/lib/constants/aiEvents";
import type { Content } from "@tiptap/core";
import { Node, Fragment } from "@tiptap/pm/model";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { cn } from "@/utils/undoActions/helperFuncs";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import EmojiGifPicker, {
  OPEN_EMOJI_GIF_PICKER_EVENT,
} from "./Components/EmojiGifPicker";
import type { EmojiGifPickerEventDetail } from "./Components/EmojiGifPicker";
import { isGuestUser } from "@/lib/demo/guest";
import { isContentCarouselImage } from "@/utils/helperFunctions/isContentCarouselImage";
import {
  subscribeGuestDescriptionEditRequests,
  syncGuestDescriptionEditorState,
} from "@/lib/demo/guestDescriptionEdit";
import {
  getLearnTutorialStorageKey,
  parseLearnTutorialState,
  shouldPreserveLearnTutorialInboxOnComment,
} from "@/lib/tutorial/learnTutorialState";
import {
  buildTaskWriterAutoDraftPrompt,
  resolveTaskDetailWriterOpening,
  resolveTaskWriterDescription,
} from "@/lib/ai/taskWriterAutoDraft";
import {
  AUTO_DESCRIPTION_SUGGESTION_DELAY_MS,
  canTakeOverDescription,
  canUndoDescriptionTakeover,
  dismissDescriptionSuggestion,
  hasDescriptionContent,
  type AutoDescriptionTakeover,
  isDescriptionSuggestionDismissed,
  shouldSuggestDescription,
} from "@/lib/ai/autoDescriptionSuggestion";
import { shouldAdvanceAfterNotificationArchive } from "@/lib/taskDetailArchiveNavigation";
import {
  isInternalTaskDetailHref,
  preserveInboxFlowOnTaskHref,
  resolveCommentEnterShortcutAction,
} from "@/lib/taskDetailInboxFlow";
const SetLinkModal = dynamic(
  () => import("../Modals/LinksModal/SetLinkModal"),
  {
    ssr: false,
  }
);

const generateAttachmentFromImgEl = (img: HTMLImageElement, idx: number) => ({
  id: idx + 1,
  createdAt: -1,
  fileType: "image/png",
  taskId: 1,
  fileSource: img.src,
  fileName: "Image.png",
});

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};

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
  handleSave?: (params: RedirectAPIParams) => void;
  setLoading?: Dispatch<SetStateAction<boolean>>;
  shouldTriggerAiTaskWriter?: boolean;
  currentTask?: any;
  createNewComment?: boolean;
  handleTaskOptions?: (val: boolean) => void;
  autoDescriptionSlotId?: string;
}

interface PendingDraftUpdate {
  content: string;
  projectId: number | null | undefined;
  taskId: number | null | undefined;
}

const Tiptap = ({
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
  autoDescriptionSlotId,
}: TiptapProps) => {
  // Context and state setup
  const {
    parsedTask: taskFromServer,
    focusOn,
    setEditMode,
    setEditState,
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
    draftsHydrated,
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
  const {
    data: userPreferences,
    isFetched: preferencesFetched,
    isSuccess: preferencesFetchSucceeded,
  } = useGetUserPreferences();
  const preferencesHydrated = preferencesFetched && preferencesFetchSucceeded;
  const advanceOnSend = userPreferences.inboxAdvanceOnSend ?? true;
  const draftQueryKey = ["draft for [task,userId]:", currentTask?.id, currentUser?.id];
  
  // State
  const { editor } = useTiptap({ mode, defaultContent, createNewComment });
  const [editorContent, setEditorContent] = useState<string>("");
  const [scrolledOnMobile, setScrolledOnMobile] = useState<boolean>(false);
  const [toggleHighlight, setToggleHighlight] = useState<boolean>(false);
  const [trigger, setTrigger] = useState(false);
  const [filesDropped, setFilesDropped] = useState<File[]>([]);
  const [shouldShowAiTaskWriter, setShouldShowAITaskWriter] = useState(shouldTriggerAiTaskWriter);
  const [autoDescriptionVisible, setAutoDescriptionVisible] = useState(false);
  const [autoDescriptionDismissed, setAutoDescriptionDismissed] = useState(false);
  const [autoDescriptionTakeover, setAutoDescriptionTakeover] =
    useState<AutoDescriptionTakeover | null>(null);
  const autoDescriptionVisitRef = useRef({ taskId: currentTask?.id, started: false });
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
  
  const [newCommentAttachments, setNewCommentAttachments] = useState<any[]>(
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

  const descriptionDraft = draftsFromTQ?.find(
    (draft: IDraft) => draft.type === "Description",
  )?.content;
  useEffect(() => {
    autoDescriptionVisitRef.current = {
      taskId: currentTask?.id,
      started: false,
    };
    setAutoDescriptionVisible(false);
    setAutoDescriptionTakeover(null);
    if (!currentTask?.id || !currentUser?.id) {
      setAutoDescriptionDismissed(true);
      return;
    }
    setAutoDescriptionDismissed(
      isDescriptionSuggestionDismissed(
        window.localStorage,
        currentUser.id,
        currentTask.id,
      ),
    );
  }, [currentTask?.id, currentUser?.id]);

  useEffect(() => {
    if (mode !== "read-edit-description" || !editor || !currentTask?.id) return;
    if (shouldShowAiTaskWriter) {
      autoDescriptionVisitRef.current.started = true;
      setAutoDescriptionVisible(false);
      return;
    }
    const eligible = shouldSuggestDescription({
      enabled: userPreferences.autoDescriptionSuggestions ?? true,
      isDesktop: !isMbl,
      title: currentTask.title,
      savedDescription: currentTask.description_?.content,
      draftDescription: descriptionDraft,
      draftsHydrated,
      preferencesHydrated,
      dismissed: autoDescriptionDismissed,
    });
    if (!eligible) {
      setAutoDescriptionVisible(false);
      return;
    }
    if (autoDescriptionVisitRef.current.started) return;

    const taskId = currentTask.id;
    const timeout = window.setTimeout(() => {
      if (
        autoDescriptionVisitRef.current.taskId !== taskId ||
        hasDescriptionContent(editor.getHTML())
      ) {
        return;
      }
      autoDescriptionVisitRef.current.started = true;
      setAutoDescriptionVisible(true);
    }, AUTO_DESCRIPTION_SUGGESTION_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [
    autoDescriptionDismissed,
    currentTask?.description_?.content,
    currentTask?.id,
    currentTask?.title,
    descriptionDraft,
    draftsHydrated,
    editor,
    isMbl,
    mode,
    preferencesHydrated,
    shouldShowAiTaskWriter,
    userPreferences.autoDescriptionSuggestions,
  ]);

  useEffect(() => {
    if (!editor || mode !== "read-edit-description") return;
    const onUpdate = () => {
      const html = editor.getHTML();
      if (autoDescriptionVisible && hasDescriptionContent(html)) {
        autoDescriptionVisitRef.current.started = true;
        setAutoDescriptionVisible(false);
      }
      if (autoDescriptionTakeover && html !== autoDescriptionTakeover.inserted) {
        setAutoDescriptionTakeover(null);
      }
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [autoDescriptionTakeover, autoDescriptionVisible, editor, mode]);

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

  // Event handlers
  const toggleHighlightHandler = (state: boolean) => setToggleHighlight(state);

  const handleCallback = async (mode_?: "moveToNext", inbox?: boolean, markAsDone?: boolean) => {
    if (!handleSave) return;

    if (mode === "read-edit-description" && uploadingDescription) {
      return;
    }

    cancelDebounceRef.current?.();

    if (mode === "read-edit-description") {
      cancelPendingDraftUpdates();
      clearDescriptionDraftCache();
    }

    editor?.commands.blur();

    setTrigger(prev => !prev);
    
    if (mode !== "read-edit-description") {
      setNewCommentAttachments([]);
      const updatedDraft = draftsFromTQ
      ?.filter((draft: IDraft) => draft.type === "Description");
      queryClient.setQueryData(draftQueryKey, updatedDraft);
      invalidateUserDrafts();
    }

    if (mode === "create-comment" && editor?.isEmpty && newCommentAttachments.length === 0) {
      return toast("Cannot post a blank comment");
    }

    console.log("🚀 ~ Saving", mode, "with", newCommentAttachments.length, "attachments");
    handleSave({
      content: editor?.getHTML()!,
      text: editor?.getText() || "",
      id: mode === "read-edit-comments" ? commentId! : id,
      mode: mode as RedirectMode,
      attachments_: newCommentAttachments,
      navigateToNext: mode_ ? true : false,
      inbox: inbox,
      inboxFlow: inboxFlow,
      markAsDone: markAsDone,
      taskStatus: currentTask?.status,
    });
    
    if (mode === "create-comment") {
      editor?.commands.setContent("");
      editor?.commands.blur();
    }
  };

  // A task can still carry an inbox notification when opened from another
  // surface. Only the inbox route may advance after sending.
  const sendComment = () => {
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
      !preserveTutorialInbox && isInboxFlow && inInbox && advanceOnSend
        ? "moveToNext"
        : undefined,
      !preserveTutorialInbox && inInbox,
    );
  };

  const toggleAiTaskWriter = () => {
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
    if (editor) {
      setContent ? 
        editor.chain().setContent(text).focus("end").run() :
        editor.chain().focus().insertContent(text).run();
    }
  };

  const getAttachments = async (files: File[]) => {
    setNewCommentAttachments(files);
  };

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

  const handleKeydown = (e: any) => {
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
    
    const keyHandlers: Record<string, () => void> = {
      'Escape': () => mode === "read-edit-description" ? handleCallback() : handleCommentEscape(),
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
        isInboxFlow,
        isCommentMode: mode === "create-comment",
        inInbox,
      });
      if (enterAction) {
        if (enterAction === "ignore") return;
        e.preventDefault();
        if (enterAction === "send-and-stay") {
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

  const resetDropFiles = () => setFilesDropped([]);
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
    if (mode === "read-edit-description" && editor?.isFocused && isMbl) {
      handleCallback();
    }
  };

  const handleOutsideClickComment = () => {
    if (mode === "create-comment" && editor?.isFocused && isMbl) {
      editor?.commands.blur();
      handleTaskOptions?.(true);
    }
  };

  const calculatePopoverPosition = (targetDiv: HTMLElement, popover: HTMLElement) => {
    const popoverHeight = popover.offsetHeight;
    console.log("Size ===> new min height", popoverHeight + 30);
    targetDiv.style.minHeight = `${popoverHeight + 30}px`;
  };

  const updateTaskTitleDescription = async (value: string, description: string) => {
    try {
      const newTask = { title: value, id: currentTask?.id };
      if (value) {
        const response = await updateTask(newTask);
        if (response.status === 200) {
          router.refresh();
          toast("Task title updated!");
        }
      }
    } catch (error) {
      console.log("🚀 ~ updateTaskTitle ~ error:", error);
    } finally {
      updateDrafts(description);
    }
  };

  // AI Task Writer handlers
  const handleEscape = () => {
    setShouldShowAITaskWriter(false);
    editor?.commands.unsetHighlight();
    handleFocus(true);
    setAiTriggerData({ initialPrompt: "", autoTrigger: false });
  };

  function setLinkHandlerCallback(task?: any, keyword?: string) {
    setShowSetLinkModal(false);
    console.log("🚀 ~ setLinkHandlerCallback ~ task:", task, keyword);
    
    let urlToSet: string = "";
    
    if (task) {
      // Generate URL for the task: /detail/project-${projectId}/${uniqueIndex}
      urlToSet = `/detail/project-${task.projectId}/${task.uniqueIndex}`;
    } else if (keyword) {
      // Check if keyword is a valid URL
      const trimmedKeyword = keyword.trim();
      
      // Check if it's already a valid absolute URL (http://, https://)
      if (trimmedKeyword.startsWith("http://") || trimmedKeyword.startsWith("https://")) {
        try {
          new URL(trimmedKeyword);
          urlToSet = trimmedKeyword;
        } catch {
          // Invalid URL format
          urlToSet = "";
        }
      }
      // Check if it's a relative URL (starts with /)
      else if (trimmedKeyword.startsWith("/")) {
        urlToSet = trimmedKeyword;
      }
      // Check if it looks like a domain (contains .)
      else if (trimmedKeyword.includes(".") && !trimmedKeyword.includes(" ")) {
        try {
          // Try to validate as URL with http:// prefix
          new URL(`http://${trimmedKeyword}`);
          urlToSet = `http://${trimmedKeyword}`;
        } catch {
          // Not a valid domain, treat as text
          urlToSet = "";
        }
      }
      // Otherwise, it's likely just text, not a URL
      else {
        urlToSet = "";
      }
    }
    
    if (urlToSet) {
      editor?.chain().focus().extendMarkRange("link").setLink({ href: urlToSet }).unsetHighlight().run();
    }
  }

  const handleAISave = (content: Node | Content | Fragment, attachments?: any[]) => {
    editor?.commands.setContent(content);
    
    // Map AI attachments to match FileItem structure: { id, file }
    // where file contains the attachment properties
    const mappedAttachments = attachments?.map((attachment, idx) => ({
      id: idx,
      file: {
        id: attachment.id || `ai-${idx}`,
        createdAt: new Date().toISOString(),
        type: attachment.file.type,
        source: attachment.preview, // S3 URL from the uploaded attachment
        name: attachment.file.name,
        size: attachment.file.size.toString(),
        taskId: null, // AI generated attachments don't have a taskId yet
      }
    })) || [];
    
    console.log("🚀 ~ AI attachments mapped for TipTap:", mappedAttachments);
    setNewCommentAttachments(mappedAttachments);
    setTrigger(prev => !prev);
    setShouldShowAITaskWriter(false);
    editor?.commands.unsetHighlight();
    handleFocus(true);
    setAiTriggerData({ initialPrompt: "", autoTrigger: false });
  };

  const handleAutoDescriptionTakeover = (
    content: Node | Content | Fragment,
    generatedAttachments?: AIGeneratedAttachment[],
  ) => {
    if (!editor || !canTakeOverDescription(editor.getHTML())) {
      setAutoDescriptionVisible(false);
      toast("Your description changed, so the AI draft was not inserted.");
      return;
    }
    const before = editor.getHTML();
    setEditMode("description");
    handleAISave(content, generatedAttachments);
    setAutoDescriptionVisible(false);
    setAutoDescriptionTakeover({ before, inserted: editor.getHTML() });
  };

  const undoAutoDescriptionTakeover = () => {
    if (!editor || !autoDescriptionTakeover) return;
    if (!canUndoDescriptionTakeover(editor.getHTML(), autoDescriptionTakeover)) {
      setAutoDescriptionTakeover(null);
      return;
    }
    editor.commands.setContent(autoDescriptionTakeover.before, { emitUpdate: true });
    setAutoDescriptionTakeover(null);
  };

  const turnOffAutoDescriptionForTask = () => {
    if (currentUser?.id && currentTask?.id) {
      dismissDescriptionSuggestion(
        window.localStorage,
        currentUser.id,
        currentTask.id,
      );
    }
    setAutoDescriptionDismissed(true);
    setAutoDescriptionVisible(false);
  };

  const turnOffAutoDescriptionsPermanently = async () => {
    try {
      const response = await axios.post(userPreferencesRoute, {
        autoDescriptionSuggestions: false,
      });
      if (response.status !== 200) throw new Error("Preference update failed");
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (previous) => ({
          ...(previous ?? userPreferences),
          autoDescriptionSuggestions: false,
        }),
      );
      setAutoDescriptionVisible(false);
    } catch {
      toast.error("Could not turn off description suggestions");
    }
  };

  const handleTitleAndDescriptionReturn = (title: string, description: string) => {
    updateTaskTitleDescription(title, description);
  };

  const getDefaultMode = () => mode === "read-edit-description" ? "AiTaskWriter" : "WriteWithAI";
  const shouldShowInlineDraftAi = Boolean(
    shouldShowAiTaskWriter && getDefaultMode() === "WriteWithAI"
  );
  shouldShowInlineDraftAiRef.current = shouldShowInlineDraftAi;
  const shouldShowFullAiTaskWriter =
    shouldShowAiTaskWriter && !shouldShowInlineDraftAi;
  const getAdditionalContext = () => mode === "read-edit-description" 
    ? "You have to write your response in a manner thats well suited to be in a task description"
    : "You have to write your response in a manner thats well suited to add as a comment or when replying to a thread";
  const taskWriterDescription = resolveTaskWriterDescription(
    editor?.getHTML(),
    defaultContent,
    currentTask.description_?.content,
    editorContent,
  );
  const getBackgroundContent = () => taskWriterDescription;
  const autoDraftPrompt =
    mode === "read-edit-description"
      ? buildTaskWriterAutoDraftPrompt({
          title: currentTask.title,
          description: taskWriterDescription,
          tags: currentTask.taskLabels?.map(
            (taskLabel: ITaskLabel) => taskLabel.label,
          ),
          priority: currentTask.priority,
          estimate: currentTask.estimate,
        })
      : null;
  const taskWriterOpening = resolveTaskDetailWriterOpening(
    aiTriggerData.autoTrigger,
    aiTriggerData.initialPrompt,
    autoDraftPrompt,
  );

  const handleReadOnlyContentClick = (
    event: ReactMouseEvent<HTMLDivElement>
  ) => {
    if (!isReadOnlyContent) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    // The Figma thumbnail is a button, not an inline attachment. Let its
    // NodeView swap in the live iframe instead of opening the image carousel.
    if (target.closest("[data-figma-embed-preview]")) return;

    const image = target.closest("img");
    if (image instanceof HTMLImageElement) {
      const images = Array.from(
        event.currentTarget.querySelectorAll<HTMLImageElement>(".ProseMirror img")
      ).filter(isContentCarouselImage);
      const currentIndex = images.indexOf(image);
      if (currentIndex < 0) return;

      setCarousalItems({
        attachments: [
          ...images.map(generateAttachmentFromImgEl),
          ...(carouselAttachments ?? attachments ?? []),
        ],
        currentIndex,
      });
      return;
    }

    const link = target.closest("a");
    const href = link?.getAttribute("href");
    if (href && isInternalTaskDetailHref(href)) {
      event.preventDefault();
      router.push(preserveInboxFlowOnTaskHref(href, inboxFlow));
    }
  };

  // Effects
  useLayoutEffect(() => {
    pendingGuestDescriptionFocusTaskRef.current = null;
    if (mode !== "read-edit-description" || !currentTask?.id) return;

    return subscribeGuestDescriptionEditRequests({
      root: window,
      taskId: currentTask.id,
      editorId: id,
      onRequest: (taskId) => {
        pendingGuestDescriptionFocusTaskRef.current = taskId;
      },
      onClear: () => {
        pendingGuestDescriptionFocusTaskRef.current = null;
      },
    });
  }, [currentTask?.id, id, mode]);

  useEffect(() => {
    if (!editor || isReadOnlyContent) return;
    const handleEditorUpdate = () => {
      // Serialize while Tiptap is alive. If navigation happens before the
      // debounce expires, useDebounceWithCancel flushes this captured value on
      // unmount instead of calling getHTML() on a destroyed editor.
      if (editor.isDestroyed) return;
      debouncedRequest({
        content: editor.getHTML(),
        projectId: inViewObject.taskProjectId,
        taskId: inViewObject.taskId,
      });
    };
    // Remove only our own handler on cleanup. The blanket editor.off("update")
    // this replaces also tore off listeners other hooks had registered on the
    // same editor (useTiptap's draft-seeding guard among them).
    editor.on("update", handleEditorUpdate);
    return () => {
      editor.off("update", handleEditorUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, inViewObject.taskId, inViewObject.taskProjectId, isReadOnlyContent]);

  useLayoutEffect(() => {
    if (
      !editor ||
      pendingGuestDescriptionFocusTaskRef.current !== currentTask.id
    ) return;

    // The guest's discrete click commits edit mode synchronously. Complete the
    // matching editor handoff before paint, leaving no keyboard-event window
    // between React's commit and ProseMirror becoming editable/focused.
    syncGuestDescriptionEditorState({
      editor,
      editable: allowEdit && !isRecording,
      isGuest: isGuestUser(currentUser),
      isMobile: Boolean(isMbl),
      mode,
      taskId: currentTask.id,
      pendingTaskId: pendingGuestDescriptionFocusTaskRef.current,
      clearPending: () => {
        pendingGuestDescriptionFocusTaskRef.current = null;
      },
    });
  }, [allowEdit, currentTask.id, currentUser, editor, isMbl, isRecording, mode]);

  useEffect(() => {
    if (editor) {
      // emitUpdate:false — setEditable fires a fake "update" otherwise, which the
      // draft autosave reads as a real edit and writes an empty draft over a
      // stored one (and which hides a draft that is still loading).
      editor.setEditable(allowEdit && !isRecording, false);
    }
  }, [allowEdit, editor, isRecording]);

  useEffect(() => {
    if (
      !descriptionFocusRequest ||
      descriptionFocusRequest.taskId !== currentTask.id ||
      handledDescriptionFocusNonceRef.current === descriptionFocusRequest.nonce ||
      !allowEdit ||
      mode !== "read-edit-description" ||
      !isSelected ||
      !editor ||
      isRecording ||
      editor.isFocused
    ) return;

    // Ctrl/Cmd+D selects the description wrapper before React commits edit
    // mode. Focus ProseMirror once both that commit and the dynamic editor
    // initialization have completed.
    editor.commands.focus("end");
    handledDescriptionFocusNonceRef.current = descriptionFocusRequest.nonce;
  }, [allowEdit, currentTask.id, descriptionFocusRequest, editor, isRecording, isSelected, mode]);

  useEffect(() => {
    if (editor) {
      setLoading?.(false);
      editor.view.dispatch(editor.view.state.tr);

      if (allowEdit && isMbl && !scrolledOnMobile) {
        document.getElementById("bottom")?.scrollIntoView({ 
          behavior: "smooth", 
          block: "start" 
        });
        setScrolledOnMobile(true);
      }
    } else {
      setLoading?.(true);
    }
  }, [isMbl, editor, allowEdit, id, stack]);

  const lastDefaultContentRef = useRef(defaultContent);
  const wasEditableRef = useRef(allowEdit);
  useEffect(() => {
    const didFinishEditing = wasEditableRef.current && !allowEdit;
    const contentChanged = defaultContent !== lastDefaultContentRef.current;

    wasEditableRef.current = allowEdit;
    lastDefaultContentRef.current = defaultContent;
    if (!editor || allowEdit || (!didFinishEditing && !contentChanged)) return;

    const normalizedContent = new DOMParser().parseFromString(
      defaultContent ?? "",
      "text/html"
    ).body.innerHTML;
    if (editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(defaultContent ?? "", { emitUpdate: false });
    }
  }, [allowEdit, defaultContent, editor]);

  useEffect(() => {
    // Ctrl/Cmd+J changes the parent edit mode after this editor has already
    // mounted. Keep the local writer surface in sync for descriptions and
    // existing comments as well as the new-comment composer.
    setShouldShowAITaskWriter(shouldTriggerAiTaskWriter);
  }, [mode, shouldTriggerAiTaskWriter]);

  useEffect(() => {
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
          behavior: "smooth", 
          block: "start" 
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
  }, [editor, reply]);

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
        setAiTriggerData({
          autoTrigger: true,
          initialPrompt: event.detail.prompt
        });
        setShouldShowAITaskWriter(true);
      }
    };

    window.addEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
    return () => window.removeEventListener(AI_TASK_WRITER_EVENT, handleAITrigger as EventListener);
  }, [id]);

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

  const autoDescriptionSlot =
    autoDescriptionSlotId && typeof document !== "undefined"
      ? document.getElementById(autoDescriptionSlotId)
      : null;
  const autoDescriptionStateMatchesTask =
    autoDescriptionVisitRef.current.taskId === currentTask?.id;
  let autoDescriptionContent: React.ReactNode = null;
  if (
    autoDescriptionStateMatchesTask &&
    autoDescriptionVisible &&
    autoDraftPrompt
  ) {
    autoDescriptionContent = (
      <AITaskWriterContainer
        key={`auto-description-${currentTask.id}-${autoDraftPrompt}`}
        id={`auto-description-writer-${currentTask.id}`}
        backgroundContent=""
        EscapeHandler={() => setAutoDescriptionVisible(false)}
        AISaveHandler={handleAutoDescriptionTakeover}
        returnTitleAndDescription={() => undefined}
        defaultMode="AiTaskWriter"
        autoTrigger
        initialPrompt={autoDraftPrompt}
        currentTask={currentTask}
        editMode={editMode}
        presentation="description-suggestion"
        requestKind="auto-description"
        onTurnOffTask={turnOffAutoDescriptionForTask}
        onTurnOffPermanently={turnOffAutoDescriptionsPermanently}
        toggleRecording={toggleRecording}
        isRecording={isRecording}
      />
    );
  } else if (autoDescriptionStateMatchesTask && autoDescriptionTakeover) {
    autoDescriptionContent = (
      <div className="mt-3 flex items-center gap-2 rounded-[4px] bg-cardBackground px-3 py-2 text-dense text-text-light-gray">
        <span>Draft moved into the description.</span>
        <button
          type="button"
          className="font-semibold text-hypertasks-ai-purple"
          onClick={undoAutoDescriptionTakeover}
        >
          Undo
        </button>
      </div>
    );
  }
  const autoDescriptionPortal = autoDescriptionSlot
    ? createPortal(autoDescriptionContent, autoDescriptionSlot)
    : null;

  return (
    <>
    <div
      id={divIds.wrapperId}
      onClickCapture={handleReadOnlyContentClick}
      className={cn("col-start-1 col-end-3 relative text-white-black", isMbl ? taskDetailSpacing.mobile.descriptionContainer : "")}
    >
        <TiptapProvider
          id={id}
          newCommentAttachments={newCommentAttachments}
          creator={{ creator: creatorname, createdAt }}
          trigger={trigger}
          isEditable={allowEdit && !isRecording}
          isEditModeActive={allowEdit}
          toggleHighlightHandler={toggleHighlightHandler}
          createdAt={createdAt}
          editor={editor}
          stack={stack}
          user={user}
          isSelected={isSelected}
          handleCallback={handleCallback}
          sendComment={sendComment}
          handleFocus={(e) => handleFocus(e)}
          getAttachments={getAttachments}
          handleKeydown={handleKeydown}
          handleCommentEscape={handleCommentEscape}
          mode={mode}
          inbox={inInbox}
          status={currentTask?.status}
          handleTaskOptions={handleTaskOptions}
          handleFileDrop={handleFileDrop}
          droppedFiles={filesDropped}
          resetDropFiles={resetDropFiles}
          discardDraft={discardDraft}
          toggleAiTaskWriter={toggleAiTaskWriter}
          shouldShowInlineDraftAi={shouldShowInlineDraftAi}
          closeInlineDraftAi={() => {
            setShouldShowAITaskWriter(false);
            setAiTriggerData({ initialPrompt: "", autoTrigger: false });
          }}
          aiProjectId={inViewObject.taskProjectId}
          aiTaskId={currentTask.id}
          showDeleteComment={hasCommentDraft}
          audioTiptapCallback={audioTiptapCallback}
          toggleRecording={toggleRecording}
          isRecording={isRecording}
        >
          {!isMbl && allowEdit && (
            <TiptapBubbleMenu
              currentProjectId={inViewObject.taskProjectId}
              currentTaskId={currentTask.id}
              toggleHighlightHandler={toggleHighlightHandler}
              allowPerks={allowPerks}
              editor={editor}
              toggleHighlight={toggleHighlight}
              hideMenu={shouldShowAiTaskWriter}
            />
          )}

          <div
            id={divIds.popoverContainer}
            className={`w-full absolute z-[1000] ${
              shouldShowFullAiTaskWriter
                ? "block h-full"
                : "hidden h-0"
            }`}
          >
            {shouldShowFullAiTaskWriter && (
              <AITaskWriterContainer
                id={divIds.popoverId}
                backgroundContent={getBackgroundContent()}
                EscapeHandler={handleEscape}
                AISaveHandler={handleAISave}
                attachments={newCommentAttachments}
                returnTitleAndDescription={handleTitleAndDescriptionReturn}
                defaultMode={getDefaultMode()}
                // additionalContext={getAdditionalContext()}
                toggleRecording={toggleRecording}
                isRecording={isRecording}
                // A fresh opening intentionally requests a fresh draft. The
                // container guard prevents duplicates within that opening.
                autoTrigger={taskWriterOpening.autoTrigger}
                initialPrompt={taskWriterOpening.initialPrompt}
                currentTask={currentTask}
                editMode={editMode}
              />
            )}
          </div>

          <TiptapMainContainer />

          <button
            className="hidden"
            onClick={() => setShouldShowAITaskWriter((prev) => !prev)}
            id={divIds.popoverTriggerButtonId}
          />
        </TiptapProvider>
      </div>
      {autoDescriptionPortal}
      {showSetLinkModal && (
        <SetLinkModal
          closeHandler={() => setShowSetLinkModal(false)}
          callbackHandler={setLinkHandlerCallback}
        />
      )}
      {emojiGifPicker && editor && (
        <EmojiGifPicker
          anchorRect={emojiGifPicker.anchorRect}
          editor={editor}
          initialTab={emojiGifPicker.initialTab}
          insertPosition={emojiGifPicker.position}
          onClose={() => setEmojiGifPicker(null)}
        />
      )}
    </>
  );
};

export default Tiptap;
