"use client";

import { useEffect } from "react";
import {
  advanceLearnTutorialForPath,
  LEARN_TUTORIAL_COMMENT_SAVED_EVENT,
  LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
  LEARN_TUTORIAL_COLUMN_MOVE_EVENT,
  LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT,
  LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
  LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT,
  LEARN_TUTORIAL_TASK_MOVED_EVENT,
  observeLearnTutorialBoardMove,
  observeLearnTutorialColumnCreated,
  observeLearnTutorialColumnMove,
  observeLearnTutorialEscape,
  observeLearnTutorialInboxArchive,
  observeLearnTutorialInboxFocus,
  observeLearnTutorialInboxNavigation,
  observeLearnTutorialInboxTaskOpen,
  observeLearnTutorialInboxZero,
  observeLearnTutorialTaskFocus,
  observeLearnTutorialSurface,
  type LearnTutorialColumnCreatedDetail,
  type LearnTutorialColumnMoveDetail,
  type LearnTutorialInboxArchivedDetail,
  type LearnTutorialTaskMovedDetail,
  type LearnTutorialTaskPersistedDetail,
} from "@/lib/tutorial/learnTutorialState";
import type { LearnTutorialContext } from "./learnTutorialActions";
import {
  dispatchTutorialEscape,
  dismissTutorialTaskModal,
  getRenderedBoardPosition,
  getRenderedTutorialInboxNotificationIds,
} from "./learnTutorialDom";

export const useLearnTutorialColumnObservers = (context: LearnTutorialContext) => {
  const {
    router,
    showCommands,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    hydrated,
    pendingSurface,
    pendingColumnCreation,
    pendingColumnMove,
    openSurfaces,
    clearPendingSurface,
  } = context;

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    setTutorialState((state) => {
      const next = observeLearnTutorialSurface(
        state,
        "ai-writer",
        openSurfaces.aiWriter,
        pendingSurface.current === "ai-writer",
      );
      if (next !== state) clearPendingSurface();
      return next;
    });
  }, [
    openSurfaces.aiWriter,
    clearPendingSurface,
    hydrated,
    tutorialEligible,
    tutorialState.active,
  ]);

  useEffect(() => {
    const surface =
      tutorialState.scene === "addColumnSearch"
        ? ("add-column" as const)
        : tutorialState.scene === "moveTaskCommand"
          ? ("move-to-column" as const)
          : null;
    const opened =
      surface === "add-column"
        ? Boolean(document.getElementById("addColumnModal"))
        : surface === "move-to-column"
          ? Boolean(document.getElementById("MoveModal"))
          : false;
    if (!surface || !opened || pendingSurface.current !== surface) return;

    setTutorialState((state) =>
      observeLearnTutorialSurface(state, surface, true, true),
    );
    clearPendingSurface();
  }, [clearPendingSurface, showCommands, tutorialState.scene]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;

    const handleColumnCreated = (event: Event) => {
      if (!pendingColumnCreation.current) return;
      const detail = (event as CustomEvent<LearnTutorialColumnCreatedDetail>)
        .detail;
      if (!detail) return;
      const next = observeLearnTutorialColumnCreated(tutorialState, detail);
      if (next === tutorialState || next.learnBoardId === null) return;
      pendingColumnCreation.current = false;
      setTutorialState(next);
      router.push(
        `/project?id=${next.learnBoardId}&tutorial=1${next.returnBoardId !== null
          ? `&tutorialReturn=${next.returnBoardId}`
          : ""
        }`,
      );
    };
    window.addEventListener(
      LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
      handleColumnCreated,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
        handleColumnCreated,
      );
  }, [hydrated, router, tutorialEligible, tutorialState]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;

    const handleColumnMove = (event: Event) => {
      if (!pendingColumnMove.current) return;
      const detail = (event as CustomEvent<LearnTutorialColumnMoveDetail>)
        .detail;
      if (!detail) return;
      const next = observeLearnTutorialColumnMove(tutorialState, detail);
      if (next === tutorialState) return;
      pendingColumnMove.current = false;
      setTutorialState(next);
    };
    window.addEventListener(LEARN_TUTORIAL_COLUMN_MOVE_EVENT, handleColumnMove);
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_COLUMN_MOVE_EVENT,
        handleColumnMove,
      );
  }, [hydrated, tutorialEligible, tutorialState]);
};

export const useLearnTutorialInboxObservers = (context: LearnTutorialContext) => {
  const {
    pathname,
    inboxFocus,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    hydrated,
    setPressedKey,
    pendingInboxGAt,
    pendingInboxMovement,
    pendingInboxArchiveTarget,
    pendingInboxOpenTarget,
    inboxContextVerified,
    setInboxNavigationStarted,
    clearPendingInboxMovement,
  } = context;

  useEffect(() => {
    if (
      !hydrated ||
      !tutorialEligible ||
      !tutorialState.active ||
      tutorialState.scene !== "inboxTriage" ||
      pendingInboxMovement.current === null
    ) {
      return;
    }
    const pending = pendingInboxMovement.current;
    setTutorialState((state) => {
      const next = observeLearnTutorialInboxFocus(
        state,
        pending.key,
        pending.fromIndex,
        inboxFocus.currIdx,
      );
      if (next !== state) clearPendingInboxMovement();
      return next;
    });
  }, [
    clearPendingInboxMovement,
    hydrated,
    inboxFocus.currIdx,
    tutorialEligible,
    tutorialState.active,
    tutorialState.scene,
  ]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    setTutorialState((state) => {
      const next = observeLearnTutorialInboxTaskOpen(
        state,
        pathname ?? "",
        pendingInboxOpenTarget.current,
      );
      if (next !== state) pendingInboxOpenTarget.current = null;
      return next;
    });
  }, [hydrated, pathname, tutorialEligible, tutorialState.active]);

  useEffect(() => {
    if (
      !hydrated ||
      !tutorialEligible ||
      !tutorialState.active ||
      !inboxContextVerified.current ||
      !(pathname ?? "").startsWith("/inbox") ||
      (tutorialState.scene !== "goInbox" && tutorialState.scene !== "inboxZero")
    ) {
      return;
    }

    const observeInbox = () => {
      const renderedNotificationIds = getRenderedTutorialInboxNotificationIds();
      const inboxLoaded = Boolean(
        document.querySelector('[data-tutorial-inbox-loaded="true"]'),
      );
      setTutorialState((state) => {
        const navigated = observeLearnTutorialInboxNavigation(
          state,
          pathname ?? "",
          renderedNotificationIds,
        );
        return observeLearnTutorialInboxZero(
          navigated,
          pathname ?? "",
          inboxLoaded,
          renderedNotificationIds,
        );
      });
    };
    const observer = new MutationObserver(observeInbox);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    observeInbox();
    return () => observer.disconnect();
  }, [
    hydrated,
    pathname,
    tutorialEligible,
    tutorialState.active,
    tutorialState.scene,
    tutorialState.tutorialInboxTargets,
  ]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    const handleInboxArchived = (event: Event) => {
      if (!inboxContextVerified.current) return;
      const archive = (event as CustomEvent<LearnTutorialInboxArchivedDetail>)
        .detail;
      if (!archive) return;
      setTutorialState((state) => {
        const next = observeLearnTutorialInboxArchive(
          state,
          archive,
          pendingInboxArchiveTarget.current,
        );
        if (next !== state) pendingInboxArchiveTarget.current = null;
        return next;
      });
    };
    window.addEventListener(
      LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
      handleInboxArchived,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
        handleInboxArchived,
      );
  }, [hydrated, tutorialEligible, tutorialState.active]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    const handleInboxArchiveFailed = (event: Event) => {
      const failed = (event as CustomEvent<LearnTutorialInboxArchivedDetail>)
        .detail;
      const pending = pendingInboxArchiveTarget.current;
      if (
        failed &&
        pending?.notificationId === failed.notificationId &&
        pending.taskId === failed.taskId
      ) {
        pendingInboxArchiveTarget.current = null;
        setPressedKey(null);
      }
    };
    window.addEventListener(
      LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT,
      handleInboxArchiveFailed,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT,
        handleInboxArchiveFailed,
      );
  }, [hydrated, tutorialEligible, tutorialState.active]);

  useEffect(() => {
    if (tutorialState.scene !== "goInbox") {
      setInboxNavigationStarted(false);
      pendingInboxGAt.current = null;
    }
  }, [tutorialState.scene]);
};

export const useLearnTutorialSurfaceObservers = (context: LearnTutorialContext) => {
  const {
    showCommands,
    resetShowCommands,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    hydrated,
    pendingSurface,
    pendingSurfaceGeneration,
    commandHandoffGeneration,
    setCommandHandoffGeneration,
    openSurfaces,
    holdPendingSurface,
    clearPendingSurface,
  } = context;

  useEffect(() => {
    const surface =
      tutorialState.scene === "assign"
        ? ("assignees" as const)
        : tutorialState.scene === "priority"
          ? ("priority" as const)
          : null;
    if (
      !surface ||
      !openSurfaces[surface] ||
      pendingSurface.current !== surface
    ) {
      return;
    }

    const expectationGeneration = pendingSurfaceGeneration.current;
    const revealTimer = setTimeout(() => {
      const shortcutMatched =
        pendingSurface.current === surface &&
        pendingSurfaceGeneration.current === expectationGeneration;
      if (!shortcutMatched) return;
      setTutorialState((state) =>
        observeLearnTutorialSurface(state, surface, true, shortcutMatched),
      );
      clearPendingSurface();
      dismissTutorialTaskModal(surface);
    }, 700);
    return () => clearTimeout(revealTimer);
  }, [
    clearPendingSurface,
    openSurfaces.assignees,
    openSurfaces.priority,
    tutorialState.scene,
  ]);

  useEffect(() => {
    const surface =
      tutorialState.scene === "dueDate"
        ? ("due-date" as const)
        : tutorialState.scene === "comment"
          ? ("comment-editor" as const)
          : null;
    const opened =
      surface === "due-date"
        ? openSurfaces.dueDate
        : surface === "comment-editor"
          ? openSurfaces.commentEditor
          : false;
    if (!surface || !opened || pendingSurface.current !== surface) return;

    setTutorialState((state) =>
      observeLearnTutorialSurface(state, surface, true, true),
    );
    clearPendingSurface();
  }, [
    clearPendingSurface,
    openSurfaces.commentEditor,
    openSurfaces.dueDate,
    tutorialState.scene,
  ]);

  useEffect(() => {
    const handleDueDateSaved = (event: Event) => {
      const savedTaskId = (event as CustomEvent<{ taskId?: number }>).detail
        ?.taskId;
      if (
        pendingSurface.current !== "due-date-committed" ||
        savedTaskId !== tutorialState.lastTaskId
      ) {
        return;
      }
      setTutorialState((state) =>
        observeLearnTutorialSurface(state, "due-date-committed", true, true),
      );
      clearPendingSurface();
    };
    window.addEventListener(
      LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT,
      handleDueDateSaved,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT,
        handleDueDateSaved,
      );
  }, [clearPendingSurface, tutorialState.lastTaskId]);

  useEffect(() => {
    const handleCommentSaved = (event: Event) => {
      const savedTaskId = (event as CustomEvent<{ taskId?: number }>).detail
        ?.taskId;
      if (
        pendingSurface.current !== "comment-saved" ||
        savedTaskId !== tutorialState.lastTaskId
      ) {
        return;
      }
      setTutorialState((state) =>
        observeLearnTutorialSurface(state, "comment-saved", true, true),
      );
      clearPendingSurface();
    };
    window.addEventListener(
      LEARN_TUTORIAL_COMMENT_SAVED_EVENT,
      handleCommentSaved,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_COMMENT_SAVED_EVENT,
        handleCommentSaved,
      );
  }, [clearPendingSurface, tutorialState.lastTaskId]);

  useEffect(() => {
    if (
      !hydrated ||
      !tutorialEligible ||
      !tutorialState.active ||
      tutorialState.scene !== "commandCenter" ||
      !showCommands.show ||
      pendingSurface.current !== "command-center"
    ) {
      return;
    }

    const expectationGeneration = pendingSurfaceGeneration.current;
    const revealTimer = setTimeout(() => {
      const shortcutMatched =
        pendingSurface.current === "command-center" &&
        pendingSurfaceGeneration.current === expectationGeneration;
      if (!shortcutMatched) return;
      holdPendingSurface();
      resetShowCommands();
      const aiWriter = document.querySelector(
        "#popover-wrapper-description textarea#htc",
      );
      if (aiWriter) {
        dispatchTutorialEscape(aiWriter);
      }
      setCommandHandoffGeneration(expectationGeneration);
    }, 900);
    return () => clearTimeout(revealTimer);
  }, [
    clearPendingSurface,
    hydrated,
    holdPendingSurface,
    resetShowCommands,
    showCommands.show,
    tutorialEligible,
    tutorialState.active,
    tutorialState.scene,
  ]);

  useEffect(() => {
    if (commandHandoffGeneration === null) return;

    let cancelled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const focusAndVerify = () => {
      if (cancelled || focusTimer || settleTimer) return;
      const expectationStillCurrent =
        pendingSurface.current === "command-center" &&
        pendingSurfaceGeneration.current === commandHandoffGeneration;
      if (!expectationStillCurrent) {
        setCommandHandoffGeneration(null);
        return;
      }

      const anchor = document.getElementById("comment");
      anchor?.focus();
      settleTimer = setTimeout(() => {
        settleTimer = null;
        const expectationRemainsCurrent =
          pendingSurface.current === "command-center" &&
          pendingSurfaceGeneration.current === commandHandoffGeneration;
        if (
          expectationRemainsCurrent &&
          anchor &&
          document.activeElement === anchor
        ) {
          setTutorialState((state) =>
            observeLearnTutorialSurface(
              state,
              "command-center",
              true,
              pendingSurface.current === "command-center",
            ),
          );
          clearPendingSurface();
          setCommandHandoffGeneration(null);
          return;
        }

        if (!expectationRemainsCurrent) {
          setCommandHandoffGeneration(null);
          return;
        }
        focusTimer = setTimeout(() => {
          focusTimer = null;
          focusAndVerify();
        }, 100);
      }, 100);
    };

    const observer = new MutationObserver(focusAndVerify);
    observer.observe(document.body, { childList: true, subtree: true });
    focusAndVerify();
    return () => {
      cancelled = true;
      observer.disconnect();
      if (focusTimer) clearTimeout(focusTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [clearPendingSurface, commandHandoffGeneration]);
};

export const useLearnTutorialMovementObservers = (context: LearnTutorialContext) => {
  const {
    pathname,
    focusedTaskId,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    hydrated,
    pendingMovementKey,
    pendingEscapeFromDetail,
    pendingBoardMove,
    pendingBoardMoveGeneration,
    pendingBoardMoveVerificationTimer,
    clearPendingMovement,
    clearPendingBoardMove,
  } = context;

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;

    const handleTaskMoved = (event: Event) => {
      const move = (event as CustomEvent<LearnTutorialTaskPersistedDetail>)
        .detail;
      const pending = pendingBoardMove.current;
      if (
        !move ||
        !pending ||
        move.taskId !== tutorialState.lastTaskId ||
        move.direction !== pending.direction ||
        move.fromSectionId !== pending.from.sectionId
      ) {
        return;
      }

      const generation = pending.generation;
      let attempts = 0;
      const verifyRenderedDestination = () => {
        if (
          pendingBoardMove.current?.generation !== generation ||
          pendingBoardMoveGeneration.current !== generation
        ) {
          return;
        }

        const renderedPosition = getRenderedBoardPosition(move.taskId);
        const expectedVerticalIndex =
          move.direction === "down"
            ? pending.from.index + 1
            : move.direction === "up"
              ? pending.from.index - 1
              : null;
        const renderedAtExpectedDestination =
          renderedPosition?.sectionId === move.toSectionId &&
          (expectedVerticalIndex === null ||
            renderedPosition.index === expectedVerticalIndex);
        if (renderedAtExpectedDestination) {
          const verifiedMove: LearnTutorialTaskMovedDetail = {
            taskId: move.taskId,
            direction: move.direction,
            from: pending.from,
            to: renderedPosition,
          };
          setTutorialState((state) =>
            observeLearnTutorialBoardMove(
              state,
              verifiedMove,
              renderedPosition,
            ),
          );
          clearPendingBoardMove();
          document.getElementById(`task-${move.taskId}`)?.focus();
          return;
        }

        attempts += 1;
        if (attempts < 200) {
          pendingBoardMoveVerificationTimer.current = setTimeout(
            verifyRenderedDestination,
            50,
          );
        } else {
          clearPendingBoardMove();
          document.getElementById(`task-${move.taskId}`)?.focus();
        }
      };

      verifyRenderedDestination();
    };

    window.addEventListener(LEARN_TUTORIAL_TASK_MOVED_EVENT, handleTaskMoved);
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_TASK_MOVED_EVENT,
        handleTaskMoved,
      );
  }, [
    clearPendingBoardMove,
    hydrated,
    tutorialEligible,
    tutorialState.active,
    tutorialState.lastTaskId,
  ]);

  useEffect(() => {
    // Add Column navigates away while its input owns focus. Keep retrying so
    // the exact tutorial task regains focus as soon as the board remounts.
    if (
      !tutorialState.active ||
      (tutorialState.scene !== "moveAcross" &&
        tutorialState.scene !== "reorder" &&
        tutorialState.scene !== "moveTaskCommand") ||
      tutorialState.lastTaskId === null
    ) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const focusTutorialTask = () => {
      if (cancelled) return;
      const task = document.getElementById(`task-${tutorialState.lastTaskId}`);
      if (task && document.activeElement !== task) task.focus();
      timer = setTimeout(focusTutorialTask, 100);
    };

    focusTutorialTask();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tutorialState.active, tutorialState.lastTaskId, tutorialState.scene]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    setTutorialState((state) => {
      const next = observeLearnTutorialTaskFocus(
        state,
        focusedTaskId,
        pendingMovementKey.current,
      );
      if (next !== state) {
        clearPendingMovement();
      }
      return next;
    });
  }, [
    clearPendingMovement,
    focusedTaskId,
    hydrated,
    tutorialEligible,
    tutorialState.active,
  ]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;
    setTutorialState((state) => {
      const advanced = advanceLearnTutorialForPath(state, pathname ?? "");
      const escaped = observeLearnTutorialEscape(
        advanced,
        pathname ?? "",
        pendingEscapeFromDetail.current,
      );
      if (escaped !== advanced) pendingEscapeFromDetail.current = false;
      return escaped;
    });
  }, [hydrated, pathname, tutorialEligible, tutorialState.active]);
};

