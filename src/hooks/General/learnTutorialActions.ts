"use client";

import { useCallback } from "react";
import {
  createLearnTutorialState,
  LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
  startLearnTutorialMovement,
  type LearnTutorialInboxArchivedDetail,
  type LearnTutorialInboxTarget,
} from "@/lib/tutorial/learnTutorialState";
import type { LearnTutorialRuntime } from "./learnTutorialRuntime";

export const useLearnTutorialActions = (context: LearnTutorialRuntime) => {
  const {
    router,
    resetShowBoardManager,
    resetShowCommands,
    resetShowShortcuts,
    storageKey,
    tutorialState,
    setTutorialState,
    pendingInboxArchiveTarget,
  } = context;

  const exitTutorial = useCallback(() => {
    if (storageKey) window.sessionStorage.removeItem(storageKey);
    delete document.documentElement.dataset.learnTutorial;
    resetShowBoardManager();
    resetShowCommands();
    resetShowShortcuts();
    setTutorialState(createLearnTutorialState(false));
    router.push(
      tutorialState.returnBoardId !== null &&
        tutorialState.returnBoardId !== tutorialState.learnBoardId
        ? `/project?id=${tutorialState.returnBoardId}`
        : "/project",
    );
  }, [
    resetShowBoardManager,
    resetShowCommands,
    resetShowShortcuts,
    router,
    storageKey,
    tutorialState.learnBoardId,
    tutorialState.returnBoardId,
  ]);

  const continueTutorial = useCallback(() => {
    const firstTask = document.querySelector<HTMLElement>(
      "#sectionsContainer [id^='task-']",
    );
    const firstTaskId = Number(firstTask?.id.slice("task-".length));
    if (!firstTask || !Number.isSafeInteger(firstTaskId) || firstTaskId <= 0)
      return;

    firstTask.focus();
    setTutorialState((state) =>
      state.scene === "welcome"
        ? startLearnTutorialMovement(state, firstTaskId)
        : state,
    );
  }, []);

  const archiveTutorialInboxTarget = useCallback(
    async (target: LearnTutorialInboxTarget, projectId: number) => {
      try {
        const response = await fetch(
          `/api/notifications/markAsDone?id=${target.notificationId}&taskId=${target.taskId}&tutorial=1`,
          { method: "GET" },
        );
        if (!response.ok) {
          pendingInboxArchiveTarget.current = null;
          return;
        }
        const detail: LearnTutorialInboxArchivedDetail = {
          notificationId: target.notificationId,
          taskId: target.taskId,
          source: "detail",
        };
        window.dispatchEvent(
          new CustomEvent(LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT, { detail }),
        );
        router.push(`/inbox?projectId=${projectId}&tutorial=1`);
      } catch {
        pendingInboxArchiveTarget.current = null;
      }
    },
    [router],
  );
  return {
    exitTutorial,
    continueTutorial,
    archiveTutorialInboxTarget,
  };
};

export type LearnTutorialContext = LearnTutorialRuntime & ReturnType<typeof useLearnTutorialActions>;
