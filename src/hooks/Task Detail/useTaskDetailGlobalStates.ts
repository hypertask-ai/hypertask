"use client";
import {
  IAllCommands,
  IAttachment,
  IComment,
  IDraft,
  ISavedContent,
  ITask,
  IUser,
  StackedType,
  TCarousalItems,
} from "@/models/model";
import {
  tasksPlayListAtom,
  ArchivedTaskIndexAtom,
  SearchTaskIndexAtom,
  InboxTaskIndexAtom,
  activeItemAtom,
  inViewObjectAtom,
  currentUserAtom,
  showTaskHistoryAtom,
  showCommandsAtom,
} from "@/store";

import {
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import useHypertasksNavigate from "../MultiPages/Route/useHypertasksNavigate";
import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import {
  emptyDescription,
  selectPElementWithDataPlaceholderInDiv,
} from "@/utils/helperFunctions/helperFunctions";
import useHasDrafts, {
  isMeaningfulDescriptionDraft,
} from "../General/useHasDrafts";
import { CommandMode } from "@/models/enums";
import { ViewVisibility } from "@prisma/client";
import toast from "react-hot-toast";
import { useStarAndPin } from "./useStarAndPin";
import { useQueryClient } from "@tanstack/react-query";
import globalConstants from "@/lib/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import useCommentAndDescriptionUploadingStates from "./CommentAndDescriptionHooks/useUploadingStates";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useGetUserPreferences } from "../General/useGetUserPreferences";
import { wrapBlockQuote } from "@/utils/helperFunctions/TaskDetail";
import type { SerializedAgentRunActivity } from "@/lib/agentRuns/model";
import { mergeTaskThreadFeed } from "@/lib/agentRuns/taskActivityFeed";
import { isCommentCreatedByUser } from "@/lib/htc/isCommentCreatedByUser";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { useFlag } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6899_STABLE_LAYOUT_FLAG, HTPR_6551_QUIET_RUN_ACTIVITY_FLAG, HTPR_7116_TICKET_STAYS_OPEN_FLAG } from "@/lib/flags/keys";

export type TReturnFocusedEl =
  | "Description"
  | "Edit-Comment"
  | "New-Comment"
  | "Others"
  | undefined;
export interface IShow {
  commentId: number;
  show: boolean;
}

const useTaskDetailGlobalStates = (
  _parsedTask: ITask | any,
  _comments: string,
  _initialStacked: StackedType,
  stack: any,
  isShareView = false,
  scrollElementRef?: RefObject<HTMLDivElement | null>,
  cachedNavigation = false,
) => {
  const { navigate } = useHypertasksNavigate();
  const queryClient = useQueryClient();

  const [editMode, setEditMode] = useState<ITaskDetailEditMode>(null);
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const { editTicketWithAi } = useCommentToAiChat();
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const stableLayout = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const initialCommentsPayload = useMemo(() => JSON.parse(_comments), [_comments]);
  const [cachedLayout] = useState(instantTicketOpen && stableLayout && (cachedNavigation || Boolean(initialCommentsPayload.pending)));
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(!instantTicketOpen || !initialCommentsPayload.pending);
  const ticketStaysOpen = useFlag(HTPR_7116_TICKET_STAYS_OPEN_FLAG);
  useEffect(() => {
    if (secondaryPanelsReady) return;
    const reveal = ticketStaysOpen
      ? () => startTransition(() => setSecondaryPanelsReady(true))
      : () => setSecondaryPanelsReady(true);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(reveal);
    });
    return () => cancelAnimationFrame(frame);
  }, [secondaryPanelsReady, ticketStaysOpen]);
  const [comments, setComments] = useState<IComment[]>(
    initialCommentsPayload.comments ?? []
  );
  const [agentRunActivities, setAgentRunActivities] = useState<
    SerializedAgentRunActivity[]
  >(initialCommentsPayload.agentRunActivities ?? []);

  const [currentId, setCurrentId] = useState<string>("");
  const [editState, setEditState] = useState<null | number>(null);
  const [description, setDescription] = useState<string>(
    _parsedTask?.description_?.content ?? ""
  );
  const [descriptionFocusRequest, setDescriptionFocusRequest] = useState<{
    taskId: number;
    nonce: number;
  } | null>(null);
  const requestDescriptionFocus = useCallback((taskId: number) => {
    setDescriptionFocusRequest((previous) => ({
      taskId,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);
  const [stacked, setStacked] = useState<StackedType>(_initialStacked ?? {});

  const [tasksPlayList, setTasksPlaylist] = useRecoilState(tasksPlayListAtom);
  const [__, setInboxTaskIndexAtom] = useRecoilState(InboxTaskIndexAtom);
  const [___, setSearchTaskIndexAtom] = useRecoilState(SearchTaskIndexAtom);
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [____, setArchivedTaskIndexAtom] = useRecoilState(
    ArchivedTaskIndexAtom
  );
  const [activeItem, _setActiveItem] = useRecoilState(activeItemAtom);
  const [_, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const [isSummaryExpanded, setIsSummaryExpand] = useState<boolean>(false);
  const [showSubtaskLinkingModal, setShowSubtaskLinkingModal] =
    useState<boolean>(false);
  const [showCommentDeleteModal, setShowCommentDeleteModal] = useState(false);
  const [showTaskDeleteModal, setShowTaskDeleteModal] =
    useState<boolean>(false);
  const [showRemindMeModal, setShowRemindMeModal] = useState(false);
  const [showTaskOptionsModal, setShowTaskOptionsModal] =
    useState<boolean>(false);
  const [showRemoveSubtaskModal, setShowRemoveSubtaskModal] =
    useState<boolean>(false);
  const [carousalItems, setCarousalItems] = useState<TCarousalItems>(undefined);
  const [showScrollToTop, setShowScrollToTop] = useState<boolean>(false);
  const _mbl = useContext(MobileViewContext);

  const [currentTask, setCurrentTask] = useState<ITask | null>(_parsedTask);
  const { hasDraft, hasCommentDraft, draftsFromTQ, draftsHydrated } =
    useHasDrafts(_parsedTask.id, currentUser?.id);

  const { data: userPreferences } = useGetUserPreferences();

  const [hasDraftInit, setHasDraftInit] = useState<boolean>(
    currentTask?.drafts?.some((draft: IDraft) =>
      isMeaningfulDescriptionDraft(draft)
    ) ?? false
  );
  const [replyQuote, setReplyQuote] = useState<null | string>(null);
  const [showEmojiPickerAtComment, setShowEmojiPickerAtCount] =
    useState<IShow>();
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const { pinComment, starTask } = useStarAndPin();
  const isApple = useDeviceContext();
  const {
    uploadingComments,
    setUploadingComments,
    uploadingDescription,
    setUploadingDescription,
  } = useCommentAndDescriptionUploadingStates();
  const listRef = useRef<HTMLDivElement | null>(null);

  const quietRunActivityEnabled = useFlag(HTPR_6551_QUIET_RUN_ACTIVITY_FLAG);
  const [showHistory, setShowHistory] = useRecoilState(showTaskHistoryAtom);
  const toggleHistory = useCallback(
    () => setShowHistory((prev) => !prev),
    [setShowHistory]
  );
  const visibleFeedItems = useMemo(
    quietRunActivityEnabled
      ? () =>
          mergeTaskThreadFeed(
            comments,
            agentRunActivities,
            showHistory,
            true,
          )
      : () => mergeTaskThreadFeed(comments, agentRunActivities, showHistory),
    [agentRunActivities, comments, quietRunActivityEnabled, showHistory],
  );
  const visibleCommentIndices = useMemo(
    () =>
      visibleFeedItems.flatMap((item) =>
        item.kind === "comment" ? [item.commentIndex] : [],
      ),
    [visibleFeedItems],
  );

  const virtualizeIndexes = useMemo(() => {
    let currentCount = 0;

    const taskInfoVirtualIndex = _mbl ? currentCount++ : -1;

    const descriptionVirtualIndex = currentCount++;

    const descriptionBottomVirtualIndex = currentCount++;

    const commentsStartVirtualIndex = currentCount;
    const commentsLength = visibleFeedItems.length;
    currentCount += commentsLength;

    const uploadingCommentsStartVirtualIndex = currentCount;
    const uploadingCommentsLength = uploadingComments?.length ?? 0;
    currentCount += uploadingCommentsLength;

    const totalCount = currentCount;

    return {
      totalCount,
      taskInfoVirtualIndex,
      descriptionVirtualIndex,
      descriptionBottomVirtualIndex,
      commentsStartVirtualIndex,
      uploadingCommentsStartVirtualIndex,
      numberOfComments: commentsLength,
      numberOfUploadingComments: uploadingCommentsLength,
    };
  }, [_mbl, visibleFeedItems, uploadingComments]);

  const _count = isShareView ? 0 : virtualizeIndexes.totalCount;
  const dynamicOverscan = Math.min(
    30,
    Math.max(5, Math.ceil(_count / (userPreferences.commentsStacked ? 4 : 10)))
  );
  const virtualItemKey = useCallback(
    (index: number) => {
      if (index === virtualizeIndexes.taskInfoVirtualIndex) return "task-info";
      if (index === virtualizeIndexes.descriptionVirtualIndex) return "description";
      if (index === virtualizeIndexes.descriptionBottomVirtualIndex) {
        return "description-bottom";
      }
      const feedPosition = index - virtualizeIndexes.commentsStartVirtualIndex;
      if (feedPosition >= 0 && feedPosition < visibleFeedItems.length) {
        return visibleFeedItems[feedPosition].id;
      }
      const uploadingPosition =
        index - virtualizeIndexes.uploadingCommentsStartVirtualIndex;
      return `uploading-comment-${uploadingComments[uploadingPosition]?.id ?? uploadingPosition}`;
    },
    [uploadingComments, virtualizeIndexes, visibleFeedItems],
  );

  const virtualizerOptions = {
    getItemKey: virtualItemKey,
    estimateSize: () => (_mbl ? 500 : 100),
    overscan: _mbl ? Math.min(8, dynamicOverscan) : dynamicOverscan,
    scrollMargin: 0,
    shouldAdjustScrollPositionOnItemSizeChange: () => false,
    rangeExtractor: (range: Range) => {
      const normalRange = defaultRangeExtractor(range);
      if (cachedLayout) {
        const topRows = Array.from({ length: virtualizeIndexes.commentsStartVirtualIndex }, (_, index) => index);
        return Array.from(new Set([...topRows, ...normalRange])).sort((a, b) => a - b);
      }
      const pinned = virtualizeIndexes.descriptionVirtualIndex;
      if (pinned < 0 || normalRange.includes(pinned)) return normalRange;
      return Array.from(new Set([pinned, ...normalRange])).sort((a, b) => a - b);
    },
  };

  const hydrated = useHydrated();
  const windowVirtualizer = useWindowVirtualizer({
    ...virtualizerOptions,
    count: scrollElementRef ? 0 : _count,
    initialRect: instantTicketOpen && hydrated ? { width: window.innerWidth, height: window.innerHeight } : undefined,
  });
  const elementVirtualizer = useVirtualizer({
    ...virtualizerOptions,
    count: scrollElementRef ? _count : 0,
    getScrollElement: () => scrollElementRef?.current ?? null,
  });
  const virtualizer = scrollElementRef
    ? elementVirtualizer
    : windowVirtualizer;

  useEffect(() => {
    if (!_mbl) return;

    const syncScrollToTop = () =>
      setShowScrollToTop((virtualizer.scrollOffset ?? 0) > 200);

    syncScrollToTop();
    const scrollTarget = scrollElementRef?.current ?? window;
    scrollTarget.addEventListener("scroll", syncScrollToTop, { passive: true });

    return () => {
      scrollTarget.removeEventListener("scroll", syncScrollToTop);
    };
  }, [_mbl, scrollElementRef, virtualizer]);

  const currentItemInTasksPlaylist = {
    projectId: _parsedTask.projectId,
    uniqueIndex: _parsedTask.uniqueIndex,
  };

  const toggleSubtaskLinkingModal = () => {
    setShowSubtaskLinkingModal((prev) => !prev);
  };

  const toggleRecording = (val: boolean) => setIsRecording(val);

  const editModeCheck =
    typeof window !== "undefined" &&
    !(
      editMode !== null ||
      (document?.activeElement &&
        (document?.activeElement?.id === "title-input" ||
          document?.activeElement?.id === "description" ||
          document?.activeElement?.id === "comment-input"))
    );

  function returnCurrentFocusedType(): TReturnFocusedEl {
    if (
      currentTask?.userId?.toString === currentUser.id.toString &&
      document.activeElement?.id === descriptionContainerId &&
      (description !== "Description" ||
        (description as string) !== emptyDescription)
    )
      return "Description";
    else if (document.activeElement?.id?.indexOf("comment-") === 0)
      return "Edit-Comment";
    else if (document.activeElement?.id === "comment") return "New-Comment";
    else return "Others";
  }

  const updateActiveItemAndItemInView = (taskId: number | null) => {
    _setActiveItem(taskId);
    setInViewObject({
      taskId: taskId,
      taskProjectId: currentTask?.projectId ?? null,
      sectionId: currentTask?.sectionId ?? null,
      taskTicketNumber: currentTask?.ticketNumber ?? null,
      sectionTitle: currentTask?.section ?? null,
      taskTitle: currentTask?.title ?? null,
    });
  };

  const focusOn = (
    id: string,
    scroll: boolean = true,
    behavior: ScrollBehavior = "smooth",
    block: ScrollLogicalPosition | any = "center",
    avoidDocumentFocus = false
  ) => {
    if (!avoidDocumentFocus) document.getElementById(id)?.focus();
    if (scroll)
      document?.getElementById(id)?.scrollIntoView({
        behavior: behavior,
        block: block,
      });
    setCurrentId(id);
  };

  const defaultCommentFocus = () =>
    focusOn("comment", true, "auto", "center", true);

  const onGoback = () => {
    if (tasksPlayList) {
      const indexOf = tasksPlayList.findIndex(
        (obj) =>
          obj.projectId === currentItemInTasksPlaylist.projectId &&
          obj.uniqueIndex === currentItemInTasksPlaylist.uniqueIndex
      );
      const setTo = indexOf > -1 ? indexOf : 0;
      setInboxTaskIndexAtom(setTo);
      setSearchTaskIndexAtom(setTo);
      setArchivedTaskIndexAtom(setTo);
    }
    updateActiveItemAndItemInView(currentTask?.id ?? null);

    const backLandsOnDifferentBoard = () => {
      try {
        const nav = (window as any).navigation;
        const entries = nav?.entries?.();
        const idx = nav?.currentEntry?.index;
        if (!entries || typeof idx !== "number" || idx <= 0) return false;
        const prevUrl = entries[idx - 1]?.url;
        if (!prevUrl) return false;
        const prev = new URL(prevUrl);
        if (prev.origin !== window.location.origin) return false;
        if (prev.pathname !== "/project") return false;
        const prevBoardId = prev.searchParams.get("id");
        return !!prevBoardId && Number(prevBoardId) !== currentTask?.projectId;
      } catch {
        return false;
      }
    };

    if (window.history.length > 2 && !backLandsOnDifferentBoard()) {
      updateActiveItemAndItemInView(currentTask?.id ?? null);
      console.log("Navigating back");
      navigate("Back");
    } else {
      navigate("Push", `/project?id=${currentTask?.projectId}`);
    }
  };

  const refocusAndOpenTaskWriter = (prevActive: string) => {
    if (editWithAiEnabled) {
      void editTicketWithAi(currentTask!.id);
      return;
    }
    document.getElementById(prevActive)?.focus();
    CTRL_J_ENTER_Handler(true);
  };

  const CTRL_J_ENTER_Handler = (shouldTriggerAi: boolean = false) => {
    if (shouldTriggerAi && editWithAiEnabled) {
      setShowCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
      return;
    }
    const currentFocusedType = returnCurrentFocusedType();
    if (currentFocusedType === "Description")
      editDescriptionHandler(shouldTriggerAi);
    else if (currentFocusedType === "Edit-Comment") {
      const currentIndex: any = parseInt(
        document?.activeElement?.id?.split("-")[1]!
      );
      editCommentHandler(currentIndex, shouldTriggerAi);
    }
    else if (currentFocusedType === "New-Comment") {
      EnterCommentCreateMode(shouldTriggerAi);
    }
  };

  const EnterCommentCreateMode = (shouldTriggerAi: boolean = false) => {
    const editModeToSelect: ITaskDetailEditMode = shouldTriggerAi
      ? "new-comment-ai"
      : "comment";
    setTimeout(() => {
      setEditMode(editModeToSelect);
      focusOn(
        "comment-input",
        undefined,
        undefined,
        undefined,
        shouldTriggerAi
      );
    }, 100);
    focusOn("comment-input", undefined, undefined, undefined, shouldTriggerAi);
  };

  const editDescriptionHandler = (shouldTriggerAi: boolean = false) => {
    if (editMode === "description" || editMode === "description-ai") return;
    setTimeout(() => {
      const editModeToSelect = shouldTriggerAi
        ? "description-ai"
        : "description";
      const elementIdToGet = shouldTriggerAi
        ? "popover-wrapper-" + "description"
        : descriptionContainerId;
      setEditMode(editModeToSelect);
      focusOn("description", false);
      document
        .getElementById(elementIdToGet)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const replyToCommentHandler = (currentIndex: number) => {
    if (currentIndex === -1) return replyComment(currentIndex);
    if (currentIndex === comments.length - 1) {
      replyComment(currentIndex);
    } else {
      updateStackedComments(currentIndex, true);
    }


    if (!stacked[currentIndex]) {
      replyComment(currentIndex);
    }
  };
  const replyComment = (currentIndex: number) => {
    if (document.querySelector(".Popover")) return;
    var content;
    var creator;
    if (currentIndex === -1) {
      content = description;
      creator = currentTask?.user;
      if (description === "<p></p>" || description.length === 0)
        return toast("Cannot quote an empty description");
    } else {
      content = comments[currentIndex].text;
      creator = comments[currentIndex].creator;
    }
    console.log("🚀 ~ replyComment ~ content:", content);

    InsertContentInCommentInput(content, creator!);
  };

  const InsertContentInCommentInput = (content: string, quoter: IUser) => {
    const wrapblockquote = wrapBlockQuote(content, quoter);

    const element = selectPElementWithDataPlaceholderInDiv(
      "comment-input-input"
    );

    if (element) {
      setReplyQuote(wrapblockquote);
      focusOn("comment-input", false);
      setEditMode("comment");
      if (!cachedLayout || _mbl) {
        scrollVirtualize(cachedLayout ? "new-comment" : "comment", undefined, true);
      }
      setTimeout(() => {
        setReplyQuote("");
      }, 100);
    }
  };

  const toggleEmojiPicker = (commentIndex: number) => {
    if (
      !showEmojiPickerAtComment ||
      showEmojiPickerAtComment.commentId !== commentIndex
    ) {
      setShowEmojiPickerAtCount({ commentId: commentIndex, show: true });
      const commentElement = document.getElementById(`comment-${commentIndex}`);
    } else setShowEmojiPickerAtCount(undefined);
  };

  const editCommentHandler = (
    currentIndex: number,
    shouldTriggerAi: boolean = false
  ) => {
    if (isCommentCreatedByUser(comments[currentIndex], currentUser?.id)) {
      const editModeToSelect: ITaskDetailEditMode = shouldTriggerAi
        ? "edit-comment-ai"
        : "edit-comment";
      const elementIdToGet = shouldTriggerAi
        ? "popover-wrapper-" + "description"
        : descriptionContainerId;
      setEditMode(editModeToSelect);
      setEditState(currentIndex);
      setTimeout(() => {
        focusOn(
          `comment-${currentIndex}-input`,
          undefined,
          undefined,
          undefined,
          shouldTriggerAi
        );
      }, 300);
      if (currentIndex === comments.length - 1) return;
      updateStackedComments(currentIndex, true);
    }
  };

  const updateStackedComments = useCallback(
    (commentIdx: number, forceOpen?: boolean) => {
      setStacked((prevCommentMap) => ({
        ...prevCommentMap,
        [commentIdx]: forceOpen ? false : !stacked[commentIdx],
      }));
    },
    [stacked]
  );

  const handleStarTask = async () => {
    const response = await starTask(currentTask?.id!, currentTask?.projectId!);
    if (response.status === 200) {
      setCurrentTask((prev) => {
        if (!prev) return null;
        return { ...prev, savedContent: [{ ...response.data }] };
      });

      toast(`Starred Task ${currentTask?.ticketNumber?.toUpperCase()}`);
    } else {
      setCurrentTask((prev) => {
        if (!prev) return null;
        return { ...prev, savedContent: [] };
      });
      toast(`Unstarred Task ${currentTask?.ticketNumber?.toUpperCase()}`);
    }
  };

  const handlePinComment = async (commentId: string, type: ViewVisibility) => {
    const response = await pinComment(
      currentTask?.id!,
      currentTask?.projectId!,
      commentId,
      type
    );
    updateStarredComment(commentId.toString(), type, response.data.saved);
    if (response.status === 200) {
      toast(
        `${type === "Private" ? "Starred" : "Pinned"} Comment-${commentId}`
      );
    } else {
      toast(
        `${type === "Private" ? "Unstarred" : "Unpinned"} Comment-${commentId}`
      );
    }
  };

  const updateStarredComment = (
    commentId: string,
    type: ViewVisibility,
    content?: ISavedContent
  ) => {
    const updatedComments = comments.map((comment: IComment) => {
      if (comment.id.toString() === commentId.toString()) {
        const contentToSave = comment.savedContent
          ? [...comment.savedContent]
          : [];
        const filtered = contentToSave.filter((item) => item.type !== type);
        const updatedSavedContent: ISavedContent[] = content
          ? [...filtered, { ...content }]
          : [...filtered];
        return { ...comment, savedContent: updatedSavedContent };
      }
      return comment;
    });
    queryClient.setQueryData(
      [globalConstants.CommentsTQPrefixKey, currentTask?.id],
      (prev: any) => {
        return { ...prev, comments: updatedComments };
      }
    );

    setComments(updatedComments);
  };

  const getTaskOptions = () => {
    return {
      isApple,
      isArchived: currentTask?.status === "Archive",
      hasNotifications: !!(
        currentTask?._count?.notifications &&
        currentTask?._count?.notifications > 0
      ),
      isKanban: false,
      hasSubtasks: !!(
        currentTask?.subTasks && currentTask?.subTasks.length > 0
      ),
      hasParent: !!currentTask?.parentTaskId,
      isStarred: !!(
        currentTask?.savedContent && currentTask?.savedContent?.length > 0
      ),
      showHistory,
      timeTrackingEnabled: !!currentTask?.project?.timeTrackingEnabled,
    };
  };

  const getCommentOptions = (index: number) => {
    const comment = comments[index];
    return {
      isApple,
      isCurrentUserCreator: isCommentCreatedByUser(
        comments[index],
        currentUser?.id,
      ),
      isPinned: !!comment?.savedContent?.find((item) => item.type === "Public"),
      isStarred: !!comment?.savedContent?.find(
        (item) => item.type === "Private"
      ),
      creatorId: comments[index]?.creatorId,
    };
  };

  const createContextOptionsForHTC = (): IAllCommands => {
    const currentFocused = returnCurrentFocusedType();
    const focusedCommentIndex = parseInt(
      document.activeElement?.id.split("-")[1]!
    );
    const commentIndex =
      typeof showCommands.commentIndex === "number"
        ? showCommands.commentIndex
        : currentFocused === "Edit-Comment"
          ? focusedCommentIndex
          : undefined;

    return {
      context: "Task",
      task: currentTask ? {
        taskId: currentTask.id,
        projectId: currentTask.projectId,
        sectionId: currentTask.sectionId ?? null,
      } : undefined,
      taskOptions: { ...getTaskOptions() },
      commentOptions:
        typeof commentIndex === "number"
          ? { ...getCommentOptions(commentIndex) }
          : undefined,
    };
  };

  const scrollVirtualize = (
    type: "new-comment" | "comment" | "description" | "edit-description",
    commentId?: number,
    end?: boolean,
    withCommentId?: boolean
  ) => {
    if (type === "new-comment") {
      if (cachedLayout && !_mbl) {
        document.getElementById("comment")?.scrollIntoView({ behavior: "auto", block: "center" });
      } else {
        virtualizer.scrollToIndex(_count - 1, { align: "center" });
      }
    } else if (type === "edit-description")
      virtualizer.scrollToIndex(1, { align: "center" });
    else if (type === "description")
      virtualizer.scrollToIndex(0, { align: "start" });
    else if (type === "comment" && commentId !== undefined) {
      const commentIndex = withCommentId
        ? comments.findIndex((x) => parseInt(x.id) === commentId)
        : commentId;
      if (commentIndex === -1) return defaultCommentFocus();
      const visiblePosition = visibleFeedItems.findIndex(
        (item) => item.kind === "comment" && item.commentIndex === commentIndex,
      );
      if (visiblePosition === -1) return defaultCommentFocus();
      focusOn(`comment-${commentIndex}`, false);
      virtualizer.scrollToIndex(
        visiblePosition + virtualizeIndexes.commentsStartVirtualIndex,
        {
        align: "center",
        behavior: "auto",
      });
    } else if (type === "comment" && end !== undefined) {
      virtualizer.scrollToIndex(_count - 1, { align: "end" });
    }
  };

  return {
    cachedLayout,
    secondaryPanelsReady,
    setEditMode,
    editMode,
    currentTask,
    setCurrentTask,
    currentId,
    setCurrentId,
    focusOn,
    currentItemInTasksPlaylist,
    onGoback,
    editModeCheck,
    editState,
    setEditState,
    setIsSummaryExpand,
    isSummaryExpanded,
    refocusAndOpenTaskWriter,
    EnterCommentCreateMode,
    editDescriptionHandler,
    editCommentHandler,
    description,
    setDescription,
    descriptionFocusRequest,
    requestDescriptionFocus,
    stacked,
    setStacked,
    returnCurrentFocusedType,
    CTRL_J_ENTER_Handler,
    comments,
    setComments,
    agentRunActivities,
    setAgentRunActivities,
    showSubtaskLinkingModal,
    toggleSubtaskLinkingModal,
    showCommentDeleteModal,
    setShowCommentDeleteModal,
    hasDraft,
    hasDraftInit,
    setHasDraftInit,
    hasCommentDraft,
    showTaskDeleteModal,
    setShowTaskDeleteModal,
    showRemindMeModal,
    setShowRemindMeModal,
    showTaskOptionsModal,
    setShowTaskOptionsModal,
    showRemoveSubtaskModal,
    setShowRemoveSubtaskModal,
    handlePinComment,
    handleStarTask,
    createContextOptionsForHTC,
    replyToCommentHandler,
    replyQuote,
    setReplyQuote,
    InsertContentInCommentInput,
    toggleEmojiPicker,
    showEmojiPickerAtComment,
    setShowEmojiPickerAtCount,
    isRecording,
    toggleRecording,
    uploadingComments,
    setUploadingComments,
    uploadingDescription,
    setUploadingDescription,
    virtualizer,
    _count,
    scrollVirtualize,
    listRef,
    stackData: userPreferences.commentsStacked,
    virtualizeIndexes,
    showHistory,
    toggleHistory,
    visibleCommentIndices,
    visibleFeedItems,
    carousalItems,
    setCarousalItems,
    showScrollToTop,
    setShowScrollToTop,
    defaultCommentFocus,
    draftsFromTQ,
    draftsHydrated,
  };
};

export default useTaskDetailGlobalStates;
