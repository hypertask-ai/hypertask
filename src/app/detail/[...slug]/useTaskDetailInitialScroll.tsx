
import { useCallback, useEffect, useLayoutEffect } from "react";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import type { TaskDetailKeyboardContext } from "./TaskDetailKeyboardContext";
export function useTaskDetailInitialScroll(context: TaskDetailKeyboardContext) {
  const { bottomScrollCancelRef, hasBottomScrolledRef, newCommentsSnapshotReady, newCommentIds, comments, visibleCommentIndices, virtualizer, virtualizeIndexes, setPriority_, priorityForTaskTQ, setEstimate_, estimateForTaskTQ, showCreateTaskModal, _parsedTask, initialScrollGenerationRef, scrollElementRef, initialScrollGuard, hasScrolledToUnreadRef, initialScrollViewportRef, _mbl, searchParams, scrollVirtualize, focusOn, scrollSetting, defaultCommentFocus } = context;


  // --------------- update priorirty
  useEffect(() => {
    setPriority_(priorityForTaskTQ);
    console.log("🚀 ~ TaskDetail ~ priorityForTaskTQ:", priorityForTaskTQ);
  }, [priorityForTaskTQ]);

  // --------------- update estimate
  useEffect(() => {
    setEstimate_(estimateForTaskTQ);
    console.log("🚀 ~ TaskDetail ~ estimateForTaskTQ:", estimateForTaskTQ);
  }, [estimateForTaskTQ]);

  // Keep the @mention project scope in sync with the ticket being viewed.
  // MENTION_PROJECT_ID is a single global localStorage key that the create-task
  // modal overwrites while open and REMOVES on close (TiptapCreateTaskModal.tsx).
  // The detail page only set it on mount, so after closing that modal the key was
  // gone and the mention search returned no members until a full reload remounted
  // this component. Re-assert the ticket's project whenever the modal is closed
  // (skip while it is open so we don't clobber the modal's own mention scope).
  useEffect(() => {
    if (!showCreateTaskModal.show && _parsedTask?.projectId != null) {
      localStorage.setItem(taskDetailConfig.localStorage.mentionProjectId, _parsedTask.projectId);
    }
  }, [_parsedTask?.projectId, showCreateTaskModal.show]);

  // Reliably land at the very bottom of the thread on mobile.
  //
  // "Scroll to bottom" used to run defaultCommentFocus() -> scrollIntoView on
  // the #comment composer. On mobile that composer is position:fixed, so
  // scrollIntoView is a no-op (a fixed element is always "in view") and the
  // window never moved — the page stayed pinned to the top. Instead we scroll
  // the window itself to the bottom, and re-assert across a few frames: the
  // window virtualizer estimates each mobile row at 500px, so the document
  // height keeps shifting as the real rows measure in and a single scroll lands
  // short. We stop once the measured height settles (or hit a hard time cap).
  // behavior:"auto" means it just opens at the bottom with no visible scroll.
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
      // Re-assert to the current bottom until the height settles (every row has
      // measured) or we run out the clock. Growing OR shrinking heights both
      // just move the target, and each frame re-targets the true bottom.
      if (stableFrames < 3 && performance.now() - startedAt < 2500) {
        requestAnimationFrame(step);
      } else {
        cleanup();
      }
    };
    requestAnimationFrame(step);
    return cleanup;
  }, [initialScrollGuard, scrollElementRef]);

  // A scroll gesture owns initial positioning for one task.
  useLayoutEffect(() => {
    const generation = initialScrollGuard.reset();
    initialScrollGenerationRef.current = generation;
    hasScrolledToUnreadRef.current = false;
    hasBottomScrolledRef.current = false;

    return () => {
      initialScrollGuard.invalidate(generation);
    };
  }, [_parsedTask.id, initialScrollGuard]);

  // Rebind input listeners without restarting initial positioning.
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

  //Initial Scroll and focus when page loads
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
      } else if (searchParams?.get(taskDetailConfig.searchParams.inboxFlow)) {
        // Coming from the inbox: "Bottom" and "Inbox" both scroll to the bottom;
        // "None" leaves focus on the description.
        if (scrollSetting === taskDetailConfig.scrollSettings.none) {
          runInitialPositioning(() => focusOn(descriptionContainerId));
        } else if (_mbl) {
          // Select the composer, but DEFER the actual scroll to the snapshot-ready
          // effect below: it lands on the first unread comment (read new-onwards),
          // or the bottom when nothing is new. Scrolling here too would fight it.
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
          // Select the composer; the snapshot-ready effect below owns the mobile
          // scroll (first unread, else bottom) so it can decide from unread state.
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
  }, [_parsedTask.id]);



  // Where a freshly-opened task lands. Runs once the unread snapshot is ready so
  // it knows whether anything is new; the mount effect defers its mobile scroll
  // to here so the two don't fight. Preference: land on the FIRST UNREAD comment
  // (read new-onwards); if nothing is new, fall to the very bottom so the last
  // comment sits fully above the composer. Explicit deep-links win over both.
  useEffect(() => {
    const generation = initialScrollGenerationRef.current;
    const runInitialPositioning = (callback: () => void) =>
      initialScrollGuard.run(generation, callback);
    if (
      hasScrolledToUnreadRef.current ||
      !newCommentsSnapshotReady ||
      !initialScrollGuard.allows(generation)
    )
      return;

    const hash = window.location.hash.substring(1);
    const hasDeepLink =
      hash ||
      searchParams?.get(taskDetailConfig.searchParams.commentId) ||
      searchParams?.get(taskDetailConfig.searchParams.reply) ||
      searchParams?.get(taskDetailConfig.searchParams.audio);
    // Desktop keeps its prior behavior: a "bottom" preference is handled by the
    // mount effect (defaultCommentFocus), so skip here. On mobile the unread jump
    // wins, and we own the bottom fall-through, so we do NOT skip for bottom.
    const fromInbox = !!searchParams?.get(taskDetailConfig.searchParams.inboxFlow);
    const shouldScrollToBottom = fromInbox
      ? scrollSetting !== taskDetailConfig.scrollSettings.none
      : scrollSetting === taskDetailConfig.scrollSettings.bottom;
    if (hasDeepLink || (!_mbl && shouldScrollToBottom)) return;

    const firstNewCommentIndex = newCommentIds.length
      ? comments.findIndex((comment) => Number(comment.id) === newCommentIds[0])
      : -1;
    const visiblePosition =
      firstNewCommentIndex === -1
        ? -1
        : visibleCommentIndices.indexOf(firstNewCommentIndex);

    if (visiblePosition === -1) {
      // No locatable unread. If there are genuinely none, settle at the bottom
      // (mobile) ONCE — but don't mark "landed", so a later refetch that surfaces
      // unread can still jump to it. If unread exist but aren't locatable yet,
      // just wait for a re-run (comments/indices still filling in).
      if (
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

    // Unread located: stop any bottom settle, then land on the first new comment
    // so the user reads new-onwards. Set the "landed" ref inside the timeout (not
    // before) so a dependency change during the delay reschedules instead of
    // dropping the jump.
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
