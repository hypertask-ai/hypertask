
import { useCallback, useEffect, useLayoutEffect } from "react";
import { initialTicketPosition } from "@/lib/taskDetail/initialTicketPosition";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import type { TaskDetailKeyboardContext } from "./TaskDetailKeyboardContext";
import { useFlag } from "@/hooks/useFlag";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6899_STABLE_LAYOUT_FLAG, HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG } from "@/lib/flags/keys";
export function useTaskDetailInitialScroll(context: TaskDetailKeyboardContext) {
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const stableLayout = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const unreadTicketOpensTop = useFlag(HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG);
  const { cachedLayout, newCommentsLastReadAt, liveRowsPending } = useTaskContext();
  const { bottomScrollCancelRef, hasBottomScrolledRef, newCommentsSnapshotReady, newCommentIds, comments, visibleCommentIndices, virtualizer, virtualizeIndexes, setPriority_, priorityForTaskTQ, setEstimate_, estimateForTaskTQ, showCreateTaskModal, _parsedTask, initialScrollGenerationRef, scrollElementRef, initialScrollGuard, hasScrolledToUnreadRef, initialScrollViewportRef, _mbl, searchParams, scrollVirtualize, focusOn, scrollSetting, defaultCommentFocus } = context;


  const position = unreadTicketOpensTop ? initialTicketPosition({
    hasDeepLink: false,
    scrollSetting,
    fromInbox: !!searchParams?.get(taskDetailConfig.searchParams.inboxFlow),
    lastReadAt: newCommentsLastReadAt,
    firstUnreadCommentId: newCommentIds[0],
  }) : null;

  useEffect(() => {
    setPriority_(priorityForTaskTQ);
    console.log("🚀 ~ TaskDetail ~ priorityForTaskTQ:", priorityForTaskTQ);
  }, [priorityForTaskTQ]);

  useEffect(() => {
    setEstimate_(estimateForTaskTQ);
    console.log("🚀 ~ TaskDetail ~ estimateForTaskTQ:", estimateForTaskTQ);
  }, [estimateForTaskTQ]);

  useEffect(() => {
    if (!showCreateTaskModal.show && _parsedTask?.projectId != null) {
      localStorage.setItem(taskDetailConfig.localStorage.mentionProjectId, _parsedTask.projectId);
    }
  }, [_parsedTask?.projectId, showCreateTaskModal.show]);

  const scrollWindowToBottomMobile = useCallback(() => {
    let cancelled = false;
    let lastHeight = -1;
    let stableFrames = 0;
    const startedAt = performance.now();
    const generation = initialScrollGenerationRef.current;
    const scrollTarget = scrollElementRef?.current;
    const cleanup = () => {
      cancelled = true;
    };

    const step = () => {
      if (cancelled || !initialScrollGuard.allows(generation)) return cleanup();
      const height =
        scrollTarget?.scrollHeight ?? document.documentElement.scrollHeight;
      (scrollTarget ?? window).scrollTo({ top: height, behavior: "auto" });
      if (height === lastHeight) stableFrames += 1;
      else {
        stableFrames = 0;
        lastHeight = height;
      }
      if (stableFrames < 3 && performance.now() - startedAt < 2500) {
        requestAnimationFrame(step);
      } else {
        cleanup();
      }
    };
    requestAnimationFrame(step);
    return cleanup;
  }, [initialScrollGuard, scrollElementRef]);

  useLayoutEffect(() => {
    const generation = initialScrollGuard.reset();
    initialScrollGenerationRef.current = generation;
    hasScrolledToUnreadRef.current = false;
    hasBottomScrolledRef.current = false;

    return () => {
      initialScrollGuard.invalidate(generation);
    };
  }, [_parsedTask.id, initialScrollGuard]);

  useLayoutEffect(() => {
    const previousViewport = initialScrollViewportRef.current;
    if (
      previousViewport.taskId === _parsedTask.id &&
      previousViewport.isMobile !== _mbl
    ) {
      initialScrollGuard.invalidate(initialScrollGenerationRef.current);
    }
    initialScrollViewportRef.current = {
      taskId: _parsedTask.id,
      isMobile: _mbl,
    };

    return initialScrollGuard.listen(scrollElementRef?.current ?? window);
  }, [_mbl, _parsedTask.id, initialScrollGuard, scrollElementRef]);

  useEffect(() => {
    const generation = initialScrollGenerationRef.current;
    const runInitialPositioning = (callback: () => void) =>
      initialScrollGuard.run(generation, callback);
    const hash = window.location.hash.substring(1);
    window.history.scrollRestoration = "manual";
    const commentIdFromParams = searchParams?.get(taskDetailConfig.searchParams.commentId);
    if (hash || commentIdFromParams) {
      const scrollToElement = () => {
        const commentIndex = parseInt(
          (commentIdFromParams ?? hash).split("-")[1]
        );
        scrollVirtualize(taskDetailConfig.elementIds.comment, commentIndex, undefined, true);
      };
      const timeout = setTimeout(
        () => runInitialPositioning(scrollToElement),
        taskDetailConfig.delays.scrollToElement
      );
      return () => clearTimeout(timeout);
    } else {
      if (searchParams?.get(taskDetailConfig.searchParams.reply)) {
        const timeout = setTimeout(
          () =>
            runInitialPositioning(() =>
              focusOn(taskDetailConfig.elementIds.commentInput)
            ),
          taskDetailConfig.delays.focusCommentInput
        );
        return () => clearTimeout(timeout);
      } else if (searchParams?.get(taskDetailConfig.searchParams.audio)) {
        const timeout = setTimeout(
          () =>
            runInitialPositioning(() =>
              focusOn(taskDetailConfig.elementIds.commentInput)
            ),
          taskDetailConfig.delays.focusCommentInput
        );
        document.getElementById(`${taskDetailConfig.audioButtons.createComment}-${taskDetailConfig.audioButtons.suffix}`)?.click();
        return () => clearTimeout(timeout);
      } else if (stableLayout && instantTicketOpen && cachedLayout) {
        return;
      } else if (unreadTicketOpensTop) {
        return;
      } else if (searchParams?.get(taskDetailConfig.searchParams.inboxFlow)) {
        if (scrollSetting === taskDetailConfig.scrollSettings.none) {
          runInitialPositioning(() => focusOn(descriptionContainerId));
        } else if (_mbl) {
          runInitialPositioning(() =>
            focusOn(taskDetailConfig.elementIds.comment, false, undefined, undefined, true)
          );
          return;
        } else {
          const timeout = setTimeout(
            () => runInitialPositioning(defaultCommentFocus),
            taskDetailConfig.delays.defaultCommentFocus
          );
          return () => clearTimeout(timeout);
        }
      } else {
        if (_mbl) {
          const timeout = setTimeout(
            () =>
              runInitialPositioning(() =>
                focusOn(taskDetailConfig.elementIds.comment, false, undefined, undefined, true)
              ),
            taskDetailConfig.delays.mobileFocusComment
          );
          return () => clearTimeout(timeout);
        } else {
          if (scrollSetting !== taskDetailConfig.scrollSettings.bottom) {
            runInitialPositioning(() => focusOn(descriptionContainerId));
          } else {
            const timeout = setTimeout(
              () => runInitialPositioning(defaultCommentFocus),
              taskDetailConfig.delays.defaultCommentFocus
            );
            return () => clearTimeout(timeout);
          }
        }
      }
    }
  }, [_parsedTask.id, stableLayout, instantTicketOpen, cachedLayout, unreadTicketOpensTop]);

  useEffect(stableLayout && instantTicketOpen && cachedLayout ? () => {} : () => {
    const generation = initialScrollGenerationRef.current;
    const runInitialPositioning = (callback: () => void) =>
      initialScrollGuard.run(generation, callback);
    if (
      hasScrolledToUnreadRef.current ||
      !newCommentsSnapshotReady ||
      liveRowsPending ||
      !initialScrollGuard.allows(generation)
    )
      return;

    const hash = window.location.hash.substring(1);
    const hasDeepLink =
      hash ||
      searchParams?.get(taskDetailConfig.searchParams.commentId) ||
      searchParams?.get(taskDetailConfig.searchParams.reply) ||
      searchParams?.get(taskDetailConfig.searchParams.audio);
    const fromInbox = !!searchParams?.get(taskDetailConfig.searchParams.inboxFlow);
    const shouldScrollToBottom = fromInbox
      ? scrollSetting !== taskDetailConfig.scrollSettings.none
      : scrollSetting === taskDetailConfig.scrollSettings.bottom;
    if (hasDeepLink) return;
    if (unreadTicketOpensTop) {
      if (position === "top") {
        bottomScrollCancelRef.current?.();
        bottomScrollCancelRef.current = null;
        runInitialPositioning(() => {
          hasScrolledToUnreadRef.current = true;
          focusOn(descriptionContainerId, true, "auto", "start");
          (scrollElementRef?.current ?? window).scrollTo({ top: 0, behavior: "auto" });
        });
        return;
      }
      if (position === "bottom") {
        const scrollToBottom = () => runInitialPositioning(() => {
          hasScrolledToUnreadRef.current = true;
          if (_mbl) {
            focusOn(taskDetailConfig.elementIds.comment, false, undefined, undefined, true);
            hasBottomScrolledRef.current = true;
            bottomScrollCancelRef.current = scrollWindowToBottomMobile();
          } else {
            defaultCommentFocus();
          }
        });
        if (_mbl && fromInbox) {
          scrollToBottom();
          return;
        }
        const timeout = setTimeout(
          scrollToBottom,
          _mbl ? taskDetailConfig.delays.mobileFocusComment : taskDetailConfig.delays.defaultCommentFocus
        );
        return () => clearTimeout(timeout);
      }
    } else if (!_mbl && shouldScrollToBottom) return;

    const firstNewCommentIndex = newCommentIds.length
      ? comments.findIndex((comment) => Number(comment.id) === newCommentIds[0])
      : -1;
    const visiblePosition =
      firstNewCommentIndex === -1
        ? -1
        : visibleCommentIndices.indexOf(firstNewCommentIndex);

    if (visiblePosition === -1) {
      if (
        !unreadTicketOpensTop &&
        !newCommentIds.length &&
        _mbl &&
        shouldScrollToBottom &&
        !hasBottomScrolledRef.current
      ) {
        hasBottomScrolledRef.current = true;
        bottomScrollCancelRef.current = scrollWindowToBottomMobile();
      }
      return;
    }

    bottomScrollCancelRef.current?.();
    bottomScrollCancelRef.current = null;
    const timeout = setTimeout(() => {
      runInitialPositioning(() => {
        hasScrolledToUnreadRef.current = true;
        focusOn(`comment-${firstNewCommentIndex}`, false);
        virtualizer.scrollToIndex(
          virtualizeIndexes.commentsStartVirtualIndex + visiblePosition,
          { align: "start", behavior: "auto" }
        );
        requestAnimationFrame(() => {
          runInitialPositioning(() => {
            (scrollElementRef?.current ?? window).scrollBy({
              top: -Math.round(window.innerHeight / 3),
              behavior: "auto",
            });
          });
        });
      });
    }, taskDetailConfig.delays.scrollToElement);

    return () => clearTimeout(timeout);
  }, [
    _parsedTask.id,
    comments,
    focusOn,
    initialScrollGuard,
    newCommentIds,
    newCommentsSnapshotReady,
    liveRowsPending,
    newCommentsLastReadAt,
    position,
    unreadTicketOpensTop,
    defaultCommentFocus,
    cachedLayout,
    stableLayout,
    instantTicketOpen,
    scrollSetting,
    scrollElementRef,
    scrollWindowToBottomMobile,
    searchParams,
    virtualizer,
    virtualizeIndexes.commentsStartVirtualIndex,
    visibleCommentIndices,
  ]);
  return { scrollWindowToBottomMobile };
}

export type useTaskDetailInitialScrollValue = TaskDetailKeyboardContext & ReturnType<typeof useTaskDetailInitialScroll>;
