/* eslint-disable react-hooks/exhaustive-deps */
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { IAttachment, IComment } from "@/models/model";
import {
  emptyDescription,
  returnIfModalOrInputActive,
} from "@/utils/helperFunctions/helperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { useGetAllComments } from "../useGetComments";
import globalConstants from "@/lib/constants";
import { useTaskCommentsRealtime } from "@/hooks/realtime/useTaskCommentsRealtime";
import { shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  currentUserAtom,
  idToDeleteCommentAtom,
  taskDetailNonEssentialReadyAtom,
  toggleAllCommentsSignalAtom,
} from "@/store";
import axios from "axios";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  createEmojiFinder,
  ensureAtLeastOneCommentIsOpen,
  processComments,
} from "@/utils/helperFunctions/TaskDetail";
import { usePathname } from "next/navigation";
import { IShow } from "../useTaskDetailGlobalStates";
import useDescriptionReactions from "./useDescriptionReactions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { LIKESHORTCUTEVENT, thumbsUpEmoji } from "@/lib/constants/constants";
const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";
let onCommentKeys = new Set(["Tab", "ArrowDown", "ArrowUp"]);

const normalizeCommentsQueryPayload = (payload: any) => {
  if (Array.isArray(payload)) {
    return { comments: payload as IComment[], lastReadAt: null };
  }

  return {
    comments: Array.isArray(payload?.comments)
      ? (payload.comments as IComment[])
      : [],
    lastReadAt: payload?.lastReadAt ?? null,
  };
};

const getCommentId = (comment: IComment) => Number(comment.id);

const idsAreEqual = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const isNewCommentForSnapshot = (
  comment: IComment,
  userId: number,
  lastReadAt: string | Date | null
) => {
  if (comment.activity) return false;
  // agent comments carry the token owner's creatorId — still new to that user
  if (
    !comment.agentId &&
    (comment.creatorId === userId || comment.creator?.id === userId)
  ) {
    return false;
  }

  if (lastReadAt) {
    const commentTime = new Date(comment.createdAt).getTime();
    const lastReadTime = new Date(lastReadAt).getTime();
    if (Number.isFinite(commentTime) && Number.isFinite(lastReadTime)) {
      return commentTime > lastReadTime;
    }
  }

  return !(comment.seen ?? []).includes(userId);
};

const useDescriptionAndCommentsStates = () => {
  const {
    parsedTask: parsed_task,
    currentTask,
    setCurrentTask,
    editMode,
    currentId,
    focusOn,
    setEditMode,
    _comments,
    editCommentHandler,
    editDescriptionHandler,
    EnterCommentCreateMode,
    description,
    setDescription,
    stacked,
    setStacked,
    CTRL_J_ENTER_Handler,
    comments,
    setComments,
    stackData,
    showCommentDeleteModal,
    setShowCommentDeleteModal,
    hasDraft,
    hasDraftInit,
    hasCommentDraft,
    handlePinComment,
    replyToCommentHandler,
    replyQuote,
    InsertContentInCommentInput,
    showEmojiPickerAtComment,
    setShowEmojiPickerAtCount,
    toggleEmojiPicker,
    uploadingComments,
    setUploadingComments,
    uploadingDescription,
    setUploadingDescription,
    scrollVirtualize,
    defaultCommentFocus,
    visibleCommentIndices,
    isShareView,
    setNewCommentIds,
    setNewCommentsSnapshotReady,
  } = useTaskContext();
  const {
    showEmojiPickerDescription,
    setShowEmojiPickerDescription,
    handleClickOutside,
    toggleEmojiPickerDescription,
    emojiClickHandlerDescriptionr,
  } = useDescriptionReactions();
  const _parsedTask = useMemo(() => JSON.parse(parsed_task), [parsed_task]);
  const [descriptionAttachments, setDescriptionAttachments] = useState<
    IAttachment[]
  >(_parsedTask?.description_?.attachments ?? []);
  const [_, setIdToDelete] = useRecoilState<any>(idToDeleteCommentAtom);
  const [resetDraft, setResetDraft] = useState<
    "Comment" | "Description" | undefined
  >(undefined);
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  // HTPR-4879: a ref, not state. updateSeen used to flip this with setMounted,
  // which changed its own useCallback identity, which re-ran the layout effect
  // that calls it. That fired updateSeen twice per task open, and with it the
  // 2s /api/comments/updateSeen and /api/notifications/getByTask.
  const mountedRef = useRef(false);
  const [allStacked, setAllStacked] = useState<boolean>(true);
  const [allCommentsSignal] = useRecoilState(toggleAllCommentsSignalAtom);
  const allCommentsSignalRef = useRef(allCommentsSignal);
  const [showCommentOptions, setShowCommentOptions] = useState<IShow>();
  // const pathname = usePathname();
  // Lazy-load the 6k-line emoji data file: it only feeds hover-tooltip semantic
  // labels (the reaction glyph itself renders from the unified codepoint, no
  // data needed), so wait for the non-essential gate instead of fetching on
  // every task open (HTPR-3816, deferred further in HTPR-6056).
  const nonEssentialReady = useRecoilValue(taskDetailNonEssentialReadyAtom);
  const [emojiFinder, setEmojiFinder] = useState<(unified: any) => string>(
    () => () => ""
  );
  useEffect(() => {
    if (!nonEssentialReady) return;
    let active = true;
    import("@/lib/constants/emojiData").then(({ allEmojis }) => {
      if (active) setEmojiFinder(() => createEmojiFinder(allEmojis));
    });
    return () => {
      active = false;
    };
  }, [nonEssentialReady]);
  const queryClient = useQueryClient();

  const { data: commentsFromQueryTQ } = useGetAllComments(
    [globalConstants.CommentsTQPrefixKey, _parsedTask?.id],
    _parsedTask?.id,
    currentUser?.id,
    JSON.parse(_comments),
    { enabled: !isShareView && !!currentUser?.id }
  );
  const commentsQueryPayload = useMemo(
    () => normalizeCommentsQueryPayload(commentsFromQueryTQ),
    [commentsFromQueryTQ]
  );
  const commentsListFromQuery = commentsQueryPayload.comments;
  const lastReadAtFromQuery = commentsQueryPayload.lastReadAt;
  const unreadSnapshotRef = useRef<{
    taskId: number;
    knownCommentIds: Set<number>;
    lastReadAt: string | Date | null;
  } | null>(null);
  const newCommentIdsRef = useRef<number[]>([]);

  useTaskCommentsRealtime(_parsedTask?.id, {
    currentUserId: currentUser?.id,
    taskProjectId: _parsedTask?.projectId,
    taskUniqueIndex: _parsedTask?.uniqueIndex,
    setCurrentTask,
    setDescription,
    setDescriptionAttachments,
    preserveEditorContent: shouldPreserveTaskEditorContent({
      hasDraft,
      hasDraftInit,
      editMode,
      uploadingDescription,
    }),
  });

  const updateNotificationsByTask = () => {
    if (!currentUser?.id || !currentTask?.id) return;
    // HTPR-4465: no userId in the body. The server takes it from the session.
    axios.post("/api/notifications/getByTask", {
      taskId: currentTask.id,
    });
  };

  const markTaskReadOnLeave = useCallback(
    (useBeacon = false) => {
      if (isShareView || !currentUser?.id || !currentTask?.id) return;

      const body = JSON.stringify({ taskId: currentTask.id });
      if (
        useBeacon &&
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        const sent = navigator.sendBeacon(
          "/api/tasks/markRead",
          new Blob([body], { type: "application/json" })
        );
        if (sent) return;
      }

      void fetch("/api/tasks/markRead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch((error) => {
        console.log("🤔 ~ markTaskReadOnLeave ~ error:", error);
      });
    },
    [currentTask?.id, currentUser?.id, isShareView]
  );

  useEffect(() => {
    if (isShareView || !currentUser?.id || !currentTask?.id) return;

    const handlePageHide = () => markTaskReadOnLeave(true);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      markTaskReadOnLeave();
    };
  }, [currentTask?.id, currentUser?.id, isShareView, markTaskReadOnLeave]);

  const toggleCommentDeleteHandler = (val: boolean) => {
    setShowCommentDeleteModal(val);
  };

  // ---------------------- updateSeen
  const updateSeen = useCallback(async () => {
    if (!currentUser?.id || !currentTask?.id) return;

    const commentsList = commentsListFromQuery;
    if (!commentsList?.length) {
      updateNotificationsByTask();
      return;
    }

    try {
      const hash = window.location.hash;
      // HTPR-4465: no userId in the body. The server takes it from the session.
      const body = {
        commentIds: commentsList.map((item: IComment) => item.id).filter(Boolean),
        taskId: currentTask.id,
      };
      const stack_: any = queryClient.getQueryData([
        globalConstants.CommentStackStatusKey,
      ]);

      const initialMap = processComments(
        commentsList,
        currentUser.id,
        stack_?.stack,
        hash,
        newCommentIdsRef.current
      );
      if (!mountedRef.current) setStacked(initialMap);
      mountedRef.current = true;
      updateNotificationsByTask();
      await axios.post("/api/comments/updateSeen", body);
    } catch (error) {
      console.log("🤔 ~ updateSeen ~ error:", error);
    }
  }, [
    commentsListFromQuery,
    currentUser?.id,
    currentTask?.id,
    queryClient,
  ]);

  // ---------------------- updateStackfromSideBar
  const updateStackFromSidebar = async () => {
    try {
      if (commentsListFromQuery) {
        const hash = window.location.hash; // Get the hash without the '#'
        const initialMap = processComments(
          commentsListFromQuery || [],
          currentUser.id,
          stackData,
          hash,
          newCommentIdsRef.current
        );
        // console.log("stack initialMap at end of unseen is", initialMap);
        setStacked(initialMap);
      }
    } catch (error) {
      // console.log("🚀 ~ file: [...slug].tsx:921 ~ updateSeen ~ error:", error)
    }
  };

  // ----------------------- UPDATE THE STACK HASHMAP
  const updateStackedComments = useCallback(
    (commentIdx: number, forceOpen?: boolean) => {
      setStacked((prevCommentMap) =>
        ensureAtLeastOneCommentIsOpen(comments, {
          ...prevCommentMap,
          [commentIdx]: forceOpen ? false : !prevCommentMap[commentIdx],
        })
      );
    },
    [comments]
  );

  const toggleCommentOptionsModal = (commentIndex: number) => {
    if (!showCommentOptions || showCommentOptions.commentId !== commentIndex) {
      setShowCommentOptions({ commentId: commentIndex, show: true });
    } else setShowCommentOptions(undefined);
  };

  useLayoutEffect(() => {
    if (isShareView || !currentUser?.id || !currentTask?.id) return;
    if (!Array.isArray(commentsListFromQuery)) return;

    const taskId = currentTask.id;
    const currentCommentIds = commentsListFromQuery
      .map(getCommentId)
      .filter(Number.isFinite);

    const setSnapshotIds = (ids: number[]) => {
      newCommentIdsRef.current = ids;
      setNewCommentIds(ids);

      if (!ids.length) return;
      const newIdSet = new Set(ids);
      setStacked((prev) => {
        let changed = false;
        const next = { ...prev };

        commentsListFromQuery.forEach((comment, index) => {
          if (newIdSet.has(getCommentId(comment)) && next[index] !== false) {
            next[index] = false;
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    };

    if (!unreadSnapshotRef.current || unreadSnapshotRef.current.taskId !== taskId) {
      const initialNewCommentIds = commentsListFromQuery
        .filter((comment) =>
          isNewCommentForSnapshot(
            comment,
            currentUser.id,
            lastReadAtFromQuery
          )
        )
        .map(getCommentId)
        .filter(Number.isFinite);

      unreadSnapshotRef.current = {
        taskId,
        knownCommentIds: new Set(currentCommentIds),
        lastReadAt: lastReadAtFromQuery,
      };
      setSnapshotIds(initialNewCommentIds);
      setNewCommentsSnapshotReady(true);
      return;
    }

    const snapshot = unreadSnapshotRef.current;
    const nextNewIdSet = new Set(newCommentIdsRef.current);

    commentsListFromQuery.forEach((comment) => {
      const commentId = getCommentId(comment);
      if (!Number.isFinite(commentId) || snapshot.knownCommentIds.has(commentId)) {
        return;
      }

      snapshot.knownCommentIds.add(commentId);
      if (isNewCommentForSnapshot(comment, currentUser.id, snapshot.lastReadAt)) {
        nextNewIdSet.add(commentId);
      }
    });

    const orderedNewCommentIds = currentCommentIds.filter((id) =>
      nextNewIdSet.has(id)
    );
    if (!idsAreEqual(orderedNewCommentIds, newCommentIdsRef.current)) {
      setSnapshotIds(orderedNewCommentIds);
    }
  }, [
    commentsListFromQuery,
    currentTask?.id,
    currentUser?.id,
    isShareView,
    lastReadAtFromQuery,
    setNewCommentIds,
    setNewCommentsSnapshotReady,
    setStacked,
  ]);

  useLayoutEffect(() => {
    if (isShareView) return;
    if (commentsListFromQuery) {
      setComments(commentsListFromQuery);
      setStacked((prev) =>
        ensureAtLeastOneCommentIsOpen(commentsListFromQuery, prev)
      );
    }
    void updateSeen();
  }, [commentsListFromQuery, isShareView, updateSeen]);

  //trigger stack hashmap update after sidebar stack option is toggled
  useLayoutEffect(() => {
    updateStackFromSidebar();
  }, [stackData]);

  const isApple = useDeviceContext();
  // =================================================================================================
  const handleKeyDown = (e: any) => {
    // console.log("🚀 ~ handleKeyDown ~ document.activeElement?.id:", document.activeElement?.id)
    const currentIndex = parseInt(document.activeElement?.id.split("-")[1]!);
    const isInsideTipTap = Boolean(
      document.activeElement?.closest(".ProseMirror")
    );
    // console.log("🚀 ~ handleKeyDown ~ isInsideTipTap:", isInsideTipTap)
    const isInputFocused = [
      "input",
      "textarea",
      "textbox",
      "ProseMirror",
    ].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (returnIfModalOrInputActive() || isShareView) return;

    if (e.key === "Escape") {
      if (showEmojiPickerAtComment?.show) {
        setShowEmojiPickerAtCount(undefined);
        returnFocusToComment();
        return; // keep focus at the comment it was at
      }
    }
    //--------------------- if its any other key than escape, return
    else if (
      (isInputFocused && e.key !== "Escape") ||
      document.activeElement?.className === tipTapClassName ||
      showEmojiPickerAtComment?.show ||
      isInsideTipTap
    )
      return;

    // press [cmd/ctrl][j]
    if (e.keyCode === 74 && cmdControl) {
      e.preventDefault();
      CTRL_J_ENTER_Handler(true);
    }

    //edit title [f2]
    if (e.keyCode === 113) {
      e.preventDefault();
      setEditMode("title");
    }

    // ========================= ENTER
    if (e.key === "Enter" && !cmdControl) EnterHandler(e);
    // ========================= CTRL + ENTER
    if (e.key === "Enter" && cmdControl) CTRL_J_ENTER_Handler();

    if (e.keyCode === 79 && e.shiftKey && !cmdControl) {
      e.preventDefault();
      toggleAllComments();
    } else if (e.keyCode === 79 && !cmdControl && !e.shiftKey) {
      if (document.activeElement?.id?.indexOf("comment-") === 0) {
        const currentIndex = document.activeElement?.id.split("-")[1];
        if (parseInt(currentIndex) === comments.length - 1) return;
        updateStackedComments(parseInt(currentIndex));
      }
    }
    // [Attachments] cmd/cntrl + shift + a
    if (e.shiftKey && cmdControl && e.keyCode === 65) {
      e.preventDefault();
      if (document.activeElement?.id === descriptionContainerId)
        return enterDescriptionCreateMode(true);
      else {
        EnterCommentCreateMode();
        document.getElementById("create-comment-attachmentUpload")?.click();
      }
    }

    // [ctrl][shift][s]
    if (e.keyCode === 83 && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      // currentIndex can point past the end: this handler is bound to the
      // document and survives the comment list shrinking under it (a delete, a
      // task switch), which threw "reading 'activity' of undefined" straight
      // out of the keydown handler (HTPR-4822).
      const commentToPinPrivately = comments[currentIndex];
      if (!commentToPinPrivately || commentToPinPrivately.activity) return;
      updateStackedComments(currentIndex, true);
      return handlePinComment(commentToPinPrivately.id, "Private");
    }

    // [ctrl][shift][p]
    if (e.keyCode === 80 && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      const commentToPinPublicly = comments[currentIndex];
      if (!commentToPinPublicly || commentToPinPublicly.activity) return;
      updateStackedComments(currentIndex, true);
      return handlePinComment(commentToPinPublicly.id, "Public");
    }

    // -------------- [r] for reactions
    if (
      e.keyCode === 82 &&
      document.activeElement?.id === "comment" &&
      !e.ctrlKey
    ) {
      // console.log("🚀 ~ handleKeyDown ~ e.key:", e.key)
      e.preventDefault();
      const foundIndex = findCommentIndexAgainstActivity();
      if (foundIndex === -1) return false;
      setShowEmojiPickerAtCount({ commentId: foundIndex, show: true });
      scrollVirtualize("comment", foundIndex);
      // document.getElementById(`comment-${currentIndex}`)?.scrollIntoView({behavior:"smooth",block:"center"})
    }

    // -------------- [r] for reactions
    else if (e.keyCode === 82 && !e.ctrlKey) {
      e.preventDefault();
      rForReactionHanlder(currentIndex);
    }

    // --------------- [l] thumbsup shortcut
    if (e.keyCode === KeyCodes.L && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (currentId === descriptionContainerId)
        emojiClickHandlerDescriptionr(thumbsUpEmoji);
      else if (
        currentId === "comment" ||
        (currentId.startsWith("comment-") && !currentId.includes("-input"))
      ) {
        let comment_id = currentId;
        if (currentId === "comment") {
          const foundIndex = findCommentIndexAgainstActivity();
          if (foundIndex === -1) return emojiClickHandlerDescriptionr(thumbsUpEmoji);
          comment_id = `comment-${foundIndex}`;
        }
        const event = new CustomEvent(LIKESHORTCUTEVENT, {
          detail: {
            currentId: comment_id,
          },
        });
        window.dispatchEvent(event);
        return;
      }
    }

    if (e.keyCode === KeyCodes.COMMA && e.shiftKey && cmdControl) {
      e.preventDefault();
      setResetDraft("Comment");
    }

    if (onCommentKeys.has(e.key)) ArrowTabKeyHandler(e);
  };
  // ================================================================================================= HANDLE KEYDOWN OVER
  const findCommentIndexAgainstActivity = () => {
    let foundIndex = -1; // Default value if no comment with activity is found

    for (let i = comments.length - 1; i >= 0; i--) {
      if (!comments[i]?.activity) {
        foundIndex = i;
        break; // Exit the loop once the first matching comment is found
      }
    }

    return foundIndex;
  };

  // ----------------------- UPDATE ALL THE STACKS
  const toggleAllComments = () => {
    const initialMap: any = {};
    comments &&
      comments.map((item, index) => {
        initialMap[index] = !allStacked;
      });
    setStacked(ensureAtLeastOneCommentIsOpen(comments, initialMap));
    setAllStacked((prev) => !prev);
  };

  // Run the expand/collapse-all toggle when the command palette signals it
  // (skip the initial mount so opening a task doesn't auto-toggle).
  useEffect(() => {
    if (allCommentsSignalRef.current === allCommentsSignal) return;
    allCommentsSignalRef.current = allCommentsSignal;
    toggleAllComments();
  }, [allCommentsSignal]);

  // --------------- keypresses for all [tab] [arrow] movements
  const ArrowTabKeyHandler = (e: any) => {
    // console.log("🚀 ~ ArrowTabKeyHandler ~ e:", e)
    e.preventDefault();
    try {
      setEditMode(null);

      // =============== arrow/tab movements outside the comments section
      if (
        onCommentKeys.has(e.key) &&
        document.activeElement?.id?.indexOf("comment-") === -1
      )
        OutCommentsKeyHandler(e);
      // ========================== KEY MOVEMENTS WHEN INSIDE THE COMMENTS SECTION ==========================
      else if (
        document.activeElement?.id?.indexOf("comment-") === 0 &&
        onCommentKeys.has(e.key)
      )
        InCommentsKeyHandler(e);
    } catch (error) {
      console.log({ error });
    }
  };

  // --------------- keypresses for arrow/tab outside comments section to focus on elements
  const OutCommentsKeyHandler = (e: any) => {
    if (!document.activeElement || !document.activeElement.id) {
      focusOn("title");
    } else if (document.activeElement?.id === "title") {
      if (e.key === "ArrowDown" || (!e.shiftKey && e.key === "Tab")) {
        e.preventDefault();
        focusOn(descriptionContainerId, false);
        scrollVirtualize("description");
      }
    } else if (document.activeElement?.id === descriptionContainerId) {
      if (e.key === "ArrowDown" || (!e.shiftKey && e.key === "Tab")) {
        e.preventDefault();

        if (comments.length >= 1) {
          scrollVirtualize("comment", 0);
        } else if (comments.length == 0) {
          defaultCommentFocus();
        }
      } else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) {
        focusOn("title");
      }
    } else if (document.activeElement?.id === "comment" || currentId === "comment") {
      if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) {
        if (comments.length >= 1) {
          const a = comments.length - 1;
          scrollVirtualize("comment", a);
          // console.log(` --> ${comments.length}`)
        } else {
          focusOn(descriptionContainerId, false);
          scrollVirtualize("description");
        }
      }
      // scroll-to-bottom opens set currentId to "comment" without moving DOM
      // focus (avoidDocumentFocus), which left ArrowDown/Tab dead on a fresh
      // page load; give the comment box real focus so the key chain works
      else if (e.key === "ArrowDown" || e.key === "Tab") {
        focusOn(`comment`);
      }

      // else if (e.key==="Tab"){
      //    focusOn('title')
      // }
    }
    // unknown focus target (e.g. body-layout on a fresh page load): enter the chain at the title
    else focusOn("title");

    // else if(document.activeElement?.id === "copy-task-url-button"){
    //   if (e.key === "ArrowDown" || (!e.shiftKey && e.key === "Tab")) {
    //     e.preventDefault()
    //     focusOn("markAsDone");
    //   }
    //   else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) {
    //     focusOn("title")
    //   }
    // }

    // else if (document.activeElement?.id === "markAsDone") {
    //   if (e.key === "ArrowDown" || (!e.shiftKey && e.key === "Tab")) {

    //     focusOn(descriptionContainerId);
    //   } else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) {
    //       focusOn("copy-task-url-button")
    //   }
    // }
  };
  // --------------- keypresses inside comments section
  const InCommentsKeyHandler = (e: any) => {
    const currentIndex = parseInt(document.activeElement?.id.split("-")[1]!);
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey))
      InCommentsArrowDownHandler(currentIndex);
    else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab"))
      InCommentsArrowUpHandler(currentIndex);
    // inside comments but using 'tab'
    else if (e.key === "Tab") InCommentsTabHandlerInsideComments(currentIndex);
  };

  const InCommentsTabHandlerInsideComments = (currentIndex: number) => {
    const next = visibleCommentIndices.find((idx: number) => idx > currentIndex);
    if (next !== undefined) {
      scrollVirtualize("comment", next);
    } else {
      defaultCommentFocus();
    }
  };

  const InCommentsArrowUpHandler = (currentIndex: number) => {
    // move to the previous VISIBLE comment, or up to the description if none
    const prev = [...visibleCommentIndices]
      .reverse()
      .find((idx: number) => idx < currentIndex);
    if (prev === undefined) {
      focusOn(descriptionContainerId, false);
      scrollVirtualize("description");
    } else {
      scrollVirtualize("comment", prev);
    }
  };

  const InCommentsArrowDownHandler = (currentIndex: number) => {
    // move to the next VISIBLE comment, or to the composer if none remain
    const next = visibleCommentIndices.find((idx: number) => idx > currentIndex);
    if (next === undefined) {
      focusOn(`comment`);
    } else {
      scrollVirtualize("comment", next);
    }
  };

  const EnterHandler = (e: any) => {
    // ==-------------------== FOCUS TO DESCRIPTION
    if (document.activeElement?.id === descriptionContainerId)
      enterDescriptionCreateMode();
    // ==-------------------== reply to comment
    else if (document.activeElement?.id?.indexOf("comment-") === 0) {
      // console.log("enter pressesss five",document.activeElement?.id)
      const currentIndex: any = parseInt(
        document?.activeElement?.id?.split("-")[1]
      );
      replyToCommentHandler(currentIndex);
    }

    // ==-------------------== Enter Edit Comment Mode
    else if (document.activeElement?.id === "comment") EnterCommentCreateMode();
  };

  // ---------------------- return focus to comment
  const returnFocusToComment = () => {
    const extractedId = currentId.replace("-input", ""); // Remove the "-input" part
    focusOn(extractedId);
  };

  // --------------- [r] for reactions
  const rForReactionHanlder = (currentIndex: number) => {
    const comment = comments[currentIndex];
    if (!comment || comment.activity) return;
    setShowEmojiPickerAtCount({ commentId: currentIndex, show: true });
    scrollVirtualize("comment", currentIndex);
  };

  // ======================= FCM MESSAGE LISTENER =======================
  const updateOnMessageReceive = (mode: string, payload: any) => {
    if (mode === "newComment") {
      let comment_: IComment = JSON.parse(payload.comment);

      if (
        comment_ &&
        String(comment_?.taskId) === String(currentTask?.id) &&
        comment_.creatorId !== currentUser?.id
      ) {
        // console.log(payload.data)
        toast("Comment Added By " + comment_.creator?.displayName);

        setComments([...comments, { ...comment_ }]);
      }
    }

    if (mode === "newAssignee") {
      // let assignees =JSON.parse(payload.assignees)
      // setAssignedUsers([...assignedUsers,{...assignees}])
      queryClient.refetchQueries({
        queryKey: [
          "assignees",
          currentTask?.project?.name,
          currentTask?.uniqueIndex,
        ],
      });
    }
  };

  useEffect(() => {
    if (comments) {
      const parts = currentId.split("-");
      const index = parts[parts.length - 1];

      setIdToDelete(index && comments[index as any]?.id);
    }
  }, [comments, currentId]);

  // ======================== on messsage listener
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      let cancelled = false;
      let unsubscribe: (() => void) | undefined;

      const subscribeToMessages = async () => {
        const [{ app }, { getMessaging, onMessage, isSupported }] = await Promise.all([
          import("@/firebase"),
          import("firebase/messaging"),
        ]);
        if (cancelled) return;

        // Browsers without Push/SW support throw messaging/unsupported-browser (HTPR-4755)
        if (!(await isSupported())) return;
        if (cancelled) return;

        const messaging = getMessaging(app);
        unsubscribe = onMessage(messaging, (payload) => {
          console.log(
            "🚀 ~ file: TaskDetailComp.tsx:1458 ~ unsubscribe ~ payload:",
            payload
          );
          // =========================== on new comment

          updateOnMessageReceive(payload?.data?.type || "None", payload.data);
        });
      };

      void subscribeToMessages();
      return () => {
        cancelled = true;
        unsubscribe?.(); // Unsubscribe from the onMessage event
      };
    }
  }, [comments]);

  useEffect(() => {
    setDescription(_parsedTask?.description_?.content);
  }, [_parsedTask?.description_?.content]);
  useEffect(() => {
    setDescriptionAttachments(_parsedTask?.description_?.attachments);
  }, [_parsedTask?.description_?.attachments]);

  useEffect(() => {
    // Add event listeners when the component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Remove event listeners when the component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    handleKeyDown,
    hasDraft,
    hasDraftInit,
    hasCommentDraft,
    comments,
    currentId,
    isShareView
  ]);

  function enterDescriptionCreateMode(openAttachment?: boolean) {
    if (
      openAttachment ||
      (comments.length === 0 && description === "<p>Description</p>") ||
      description.length === 0 ||
      description === "<p></p>" ||
      (description as string) === emptyDescription
    ) {
      // console.log("enter pressesss two",document.activeElement?.id)

      setTimeout(() => {
        setEditMode("description");
        // descriptionRef.current?.focus()
        focusOn("description", false);
        scrollVirtualize("edit-description");
        setTimeout(() => {
          console.log("🚀 ~ setTimeout ~ openAttachment:", openAttachment);
          if (openAttachment)
            document
              .getElementById("read-edit-description-attachmentUpload")
              ?.click();
        }, 1);
      }, 1);
    } else {
      replyToCommentHandler(-1);
    }
  }

  const commentsStatesAndFunctions = {
    comments,
    setComments,
    stacked,
    setStacked,
    updateStackedComments,
    showEmojiPickerAtComment,
    setShowEmojiPickerAtCount,
    toggleEmojiPicker,
    replyQuote,
    InsertContentInCommentInput,
    editDescriptionHandler,
    editCommentHandler,
    replyToCommentHandler,
    showCommentOptions,
    setShowCommentOptions,
    toggleCommentOptionsModal,
    emojiFinder,
    showCommentDeleteModal,
    toggleCommentDeleteHandler,
    resetDraft,
    setResetDraft,
    uploadingComments,
    setUploadingComments,
    uploadingDescription,
    setUploadingDescription,
  };
  const descriptionStatesAndFunctions = {
    description,
    descriptionAttachments,
    setDescriptionAttachments,
    setDescription,
  };

  const descriptionReactionFunctions = {
    showEmojiPickerDescription,
    setShowEmojiPickerDescription,
    handleClickOutside,
    toggleEmojiPickerDescription,
    emojiClickHandlerDescriptionr,
  };

  return {
    ...descriptionStatesAndFunctions,
    ...commentsStatesAndFunctions,
    ...descriptionReactionFunctions,
  };
};

export default useDescriptionAndCommentsStates;
