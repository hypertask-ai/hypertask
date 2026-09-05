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

// import useSetStickyHeight from "./useSetStickyHeight";
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
) => {
  const { navigate } = useHypertasksNavigate();
  const queryClient = useQueryClient();

  // const{setStickyElementHeight} =useSetStickyHeight()
  const [editMode, setEditMode] = useState<ITaskDetailEditMode>(null);
  // console.log("🚀 ~ useTaskDetailGlobalStates ~ editMode:", editMode)
  const [comments, setComments] = useState<IComment[]>(
    JSON.parse(_comments).comments ?? []
  );
  const [agentRunActivities, setAgentRunActivities] = useState<
    SerializedAgentRunActivity[]
  >(JSON.parse(_comments).agentRunActivities ?? []);

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
  // console.log("🚀 ~ useTaskDetailGlobalStates ~ stacked:", stacked)

  const [tasksPlayList, setTasksPlaylist] = useRecoilState(tasksPlayListAtom);
  const [__, setInboxTaskIndexAtom] = useRecoilState(InboxTaskIndexAtom);
  const [___, setSearchTaskIndexAtom] = useRecoilState(SearchTaskIndexAtom);
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [____, setArchivedTaskIndexAtom] = useRecoilState(
    ArchivedTaskIndexAtom
  );
  const [activeItem, _setActiveItem] = useRecoilState(activeItemAtom);
  const [_, setInViewObject] = useRecoilState(inViewObjectAtom);
  const showCommands = useRecoilValue(showCommandsAtom);
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

  // const {data:commentsFromQueryTQ, isRefetching:commentFromTQRefetching} = useGetAllComments([globalConstants.CommentsTQPrefixKey,_parsedTask.id], _parsedTask.id, currentUser.id)
  // ================= ON SCREEN DATA STATES
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

  // -------- History (activity) events: hidden by default; toggle to show --------
  const [showHistory, setShowHistory] = useRecoilState(showTaskHistoryAtom);
  const toggleHistory = useCallback(
    () => setShowHistory((prev) => !prev),
    [setShowHistory]
  );
  // Feed references retain original comment indexes so edit/react/stack/delete
  // handlers and `comment-${i}` DOM ids remain aligned while passive agent rows
  // are interleaved chronologically.
  const visibleFeedItems = useMemo(
    () => mergeTaskThreadFeed(comments, agentRunActivities, showHistory),
    [agentRunActivities, comments, showHistory],
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

    // 1. TaskInfo: Only exists at index 0 if on mobile
    const taskInfoVirtualIndex = _mbl ? currentCount++ : -1;

    // 2. Description: Appears at index 0 (non-mobile) or 1 (mobile)
    const descriptionVirtualIndex = currentCount++;

    // 3. Description Bottom Spacer: Appears at index 1 (non-mobile) or 2 (mobile)
    const descriptionBottomVirtualIndex = currentCount++;

    // 4. Stored thread rows: regular comments and passive agent activities.
    const commentsStartVirtualIndex = currentCount;
    const commentsLength = visibleFeedItems.length;
    currentCount += commentsLength;

    // 5. Uploading Comments: Start after regular comments
    const uploadingCommentsStartVirtualIndex = currentCount;
    const uploadingCommentsLength = uploadingComments?.length ?? 0;
    currentCount += uploadingCommentsLength;

    const totalCount = currentCount; // This is the new, reduced total count for the virtualizer

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
    // Each mounted row is a live Tiptap/ProseMirror editor under a ResizeObserver.
    // Mobile was hardcoded to overscan 100 — for a commented ticket that keeps
    // ~all comments mounted, so opening the content-height summary bottom sheet
    // forced a full-document reflow on every animation frame and the ~300ms
    // slide stretched into ~10s. Bound mobile overscan low (5–8) so only a small
    // buffer of editors stays mounted; desktop keeps its existing dynamic value.
    overscan: _mbl ? Math.min(8, dynamicOverscan) : dynamicOverscan,
    scrollMargin: 0,
    // HTPR-4950: keep the description row mounted at all times. Scrolling it out
    // of the virtual window unmounted the whole subtree, and an embedded Figma,
    // Loom or YouTube iframe cannot survive that: it cold-reloaded every time you
    // scrolled back. There is exactly one description per task, so the cost is a
    // single extra mounted row.
    //
    // This replaces the old AI-writer-only pin, which hardcoded index 0. That was
    // right on desktop and wrong on mobile, where index 0 is TaskInfo and the
    // description sits at 1, so the writer's own row was never pinned there.
    rangeExtractor: (range: Range) => {
      const normalRange = defaultRangeExtractor(range);
      const pinned = virtualizeIndexes.descriptionVirtualIndex;
      if (pinned < 0 || normalRange.includes(pinned)) return normalRange;
      // The virtualizer wants an ascending range, and the pinned index is not
      // always below the window's first item, so sort rather than prepend.
      return Array.from(new Set([pinned, ...normalRange])).sort((a, b) => a - b);
    },
    // measureElement: _mbl
    //   ? (element, _entry, instance) => {
    //       const direction = instance.scrollDirection;
    //       if (direction === "forward" || direction === null) {
    //         // Allow remeasuring when scrolling down or direction is null
    //         return element.getBoundingClientRect().height;
    //       } else {
    //         // When scrolling up, use cached measurement to prevent stuttering
    //         const indexKey = Number(element.getAttribute("data-index"));
    //         const cachedMeasurement =
    //           instance.measurementsCache[indexKey]?.size;
    //         return cachedMeasurement || element.getBoundingClientRect().height;
    //       }
    //     }
    //   : undefined,
  };

  // The normal detail page virtualizes against the browser window. Embedded
  // task detail has its own scrollable card, so keep the same renderer and
  // measurements while swapping only the scroll element.
  const windowVirtualizer = useWindowVirtualizer({
    ...virtualizerOptions,
    count: scrollElementRef ? 0 : _count,
  });
  const elementVirtualizer = useVirtualizer({
    ...virtualizerOptions,
    count: scrollElementRef ? _count : 0,
    getScrollElement: () => scrollElementRef?.current ?? null,
  });
  const virtualizer = scrollElementRef
    ? elementVirtualizer
    : windowVirtualizer;

  // Show the scroll-to-top button whenever we are away from the top, in either
  // direction. Tasks open pre-scrolled to the newest comment, so gating it on
  // an upward scroll kept it hidden until the user scrolled up first.
  // The button is mobile-only, so desktop never pays for the context update.
  useEffect(() => {
    if (!_mbl) return;

    // Read the live offset off the (stable) virtualizer instance on each native
    // scroll event: a React re-render is not guaranteed for every pixel.
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

  // ======================== update active item and inViewObejct
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

  // ------------------------FORCE ON AN ID HANDLER
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

  // ----------------- GO BACK HANDLER
  const onGoback = () => {
    // queryClient.refetchQueries({queryKey:["projectsAll"]});
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
    // console.log("🚀 ~ onGoback ~ window.history:", window.history)

    // Plain Back returns to the previous tab-history entry, which is often a
    // DIFFERENT board (reached via a notification, search result, @mention or a
    // pasted deep link). Never dump the user on an unrelated board: when Back
    // would land on another board, go to this task's own board instead. Reads
    // the previous entry via the Navigation API; falls back to Back where it's
    // unavailable (non-Chromium), so behaviour is unchanged there.
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
      navigate("Push", `/project?id=${currentTask?.projectId}`); // Redirect to the home page
    }
  };

  // --------------- callback handler for HTC shortcut Open Task Writer
  const refocusAndOpenTaskWriter = (prevActive: string) => {
    document.getElementById(prevActive)?.focus();
    CTRL_J_ENTER_Handler(true);
  };

  const CTRL_J_ENTER_Handler = (shouldTriggerAi: boolean = false) => {
    const currentFocusedType = returnCurrentFocusedType();
    // edit description
    if (currentFocusedType === "Description")
      editDescriptionHandler(shouldTriggerAi);
    // edit comments
    else if (currentFocusedType === "Edit-Comment") {
      const currentIndex: any = parseInt(
        document?.activeElement?.id?.split("-")[1]!
      ); // can use exclamation here because we are checking that
      editCommentHandler(currentIndex, shouldTriggerAi);
      // setEditMode("comment");
    }
    // edit new comment
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
      // commentRef.current?.focus()
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

  // ------------------ [ENTER] for reply handler
  const replyToCommentHandler = (currentIndex: number) => {
    if (currentIndex === -1) return replyComment(currentIndex);
    // ===================== for comments
    if (currentIndex === comments.length - 1) {
      replyComment(currentIndex);
    } else {
      updateStackedComments(currentIndex, true);
    }

    // console.log("stacked comments after",stacked , stacked[currentIndex],currentIndex)

    if (!stacked[currentIndex]) {
      replyComment(currentIndex);
    }
  };
  // ========================= comment reply
  const replyComment = (currentIndex: number) => {
    // focusOn("comment-input");
    if (document.querySelector(".Popover")) return; // meaning user has selected some text
    var content;
    var creator;
    // ===================== for description
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

    // const elementWithAttribute = document.querySelector('[data-placeholder="Comment"]');
    if (element) {
      setReplyQuote(wrapblockquote);
      focusOn("comment-input", false);
      setEditMode("comment");
      scrollVirtualize("comment", undefined, true);
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
      // commentElement&&scrollToCenterIfNearBottom(commentElement,20)
    } else setShowEmojiPickerAtCount(undefined);
  };

  const editCommentHandler = (
    currentIndex: number,
    shouldTriggerAi: boolean = false
  ) => {
    if (comments[currentIndex]?.creatorId === currentUser.id) {
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
        [commentIdx]: forceOpen ? false : !stacked[commentIdx], // Toggle the value (true to false or false to true)
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

  /**
   *Function responsible for oinning/starring comments
   *
   * @param {string} commentId
   * @param {ViewVisibility} type
   */
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
      isCurrentUserCreator:
        comments[index]?.creatorId === currentUser.id,
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
    if (type === "new-comment")
      virtualizer.scrollToIndex(_count - 1, { align: "center" });
    else if (type === "edit-description")
      virtualizer.scrollToIndex(1, { align: "center" });
    else if (type === "description")
      virtualizer.scrollToIndex(0, { align: "start" });
    else if (type === "comment" && commentId !== undefined) {
      const commentIndex = withCommentId
        ? comments.findIndex((x) => parseInt(x.id) === commentId)
        : commentId;
      //If no index was found, focus on comment as fallback.
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
      // getTotalSize() is only an estimate while rows below the viewport are
      // unmeasured, so scrolling to that offset lands short on long tasks.
      // scrollToIndex re-runs itself once measurement settles; scrollToOffset
      // does not. Leave `behavior` unset: the retry is skipped for "smooth".
      // HTPR-3752.
      virtualizer.scrollToIndex(_count - 1, { align: "end" });
    }
  };

  return {
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
