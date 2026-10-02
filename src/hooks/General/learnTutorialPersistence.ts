"use client";

import { useEffect, useRef } from "react";
import {
  activateLearnTutorialForRequest,
  createLearnTutorialState,
  LEARN_TUTORIAL_STORAGE_KEY,
  LEARN_TUTORIAL_STATE_UPDATED_EVENT,
  parseLearnTutorialState,
  type LearnTutorialInboxTarget,
} from "@/lib/tutorial/learnTutorialState";
import type { LearnTutorialRuntime } from "./learnTutorialRuntime";

export const useLearnTutorialPersistence = (context: LearnTutorialRuntime) => {
  const {
    tutorialRequested,
    requestedReturnBoardId,
    requestedTutorialInboxTargets,
    requestedTutorialInboxIdentity,
    routeIdentity,
    storageKey,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    setHydratedStorageKey,
    hydrated,
    setPressedKey,
    inboxBootstrapRequested,
    inboxBootstrapGeneration,
    inboxBootstrapIgnoreCandidates,
    inboxBootstrapRetryTimer,
    inboxBootstrapMounted,
    inboxContextVerified,
    setDueDateKeyword,
    inboxBootstrapAttempt,
    setInboxBootstrapAttempt,
    setOpenSurfaces,
    clearPendingMovement,
    clearPendingInboxMovement,
    clearPendingSurface,
    clearPendingBoardMove,
    resetInboxBootstrap,
  } = context;

  useEffect(() => {
    resetInboxBootstrap();
    if (!storageKey) {
      setTutorialState(createLearnTutorialState(false));
      setHydratedStorageKey(null);
      return;
    }

    const stored = parseLearnTutorialState(
      window.sessionStorage.getItem(storageKey),
    );
    setTutorialState(stored ?? createLearnTutorialState(false));
    setHydratedStorageKey(storageKey);
    window.sessionStorage.removeItem(LEARN_TUTORIAL_STORAGE_KEY);
  }, [resetInboxBootstrap, storageKey]);

  const previousTutorialActive = useRef(tutorialState.active);
  useEffect(() => {
    if (previousTutorialActive.current !== tutorialState.active) {
      previousTutorialActive.current = tutorialState.active;
      resetInboxBootstrap();
    }
  }, [resetInboxBootstrap, tutorialState.active]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible) return;
    setTutorialState((state) => {
      const activated = activateLearnTutorialForRequest(
        state,
        tutorialRequested,
      );
      return activated.active &&
        activated.returnBoardId === null &&
        requestedReturnBoardId !== null
        ? { ...activated, returnBoardId: requestedReturnBoardId }
        : activated;
    });
  }, [hydrated, requestedReturnBoardId, tutorialEligible, tutorialRequested]);

  useEffect(() => {
    if (!hydrated || !storageKey) return;
    if (tutorialEligible && tutorialState.active) {
      window.sessionStorage.setItem(storageKey, JSON.stringify(tutorialState));
      window.dispatchEvent(new Event(LEARN_TUTORIAL_STATE_UPDATED_EVENT));
      document.documentElement.dataset.learnTutorial = "active";
    } else {
      window.sessionStorage.removeItem(storageKey);
      delete document.documentElement.dataset.learnTutorial;
    }
  }, [hydrated, storageKey, tutorialEligible, tutorialState]);

  useEffect(() => {
    if (
      !hydrated ||
      !tutorialEligible ||
      !tutorialState.active ||
      inboxContextVerified.current ||
      inboxBootstrapRequested.current
    ) {
      return;
    }

    inboxBootstrapRequested.current = true;
    const bootstrapGeneration = inboxBootstrapGeneration.current;
    const candidateTargets =
      !inboxBootstrapIgnoreCandidates.current &&
        tutorialState.tutorialInboxTargets.length === 2
        ? tutorialState.tutorialInboxTargets
        : !inboxBootstrapIgnoreCandidates.current
          ? requestedTutorialInboxTargets
          : [];
    const returnBoardId = tutorialState.returnBoardId ?? requestedReturnBoardId;
    void fetch("/api/learn/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(candidateTargets.length === 2
          ? {
            tutorialInboxArchivedNotificationIds:
              tutorialState.archivedInboxNotificationIds,
            tutorialInboxTargets: candidateTargets,
          }
          : {}),
        ...(returnBoardId !== null ? { returnBoardId } : {}),
      }),
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          projectId?: number;
          returnBoardId?: number | null;
          tutorialColumnTitle?: string;
          tutorialInboxTargets?: LearnTutorialInboxTarget[];
        };
        const learnBoardId = data.projectId;
        const validatedReturnBoardId = data.returnBoardId;
        const tutorialColumnTitle = data.tutorialColumnTitle;
        const tutorialInboxTargets = data.tutorialInboxTargets;
        if (bootstrapGeneration !== inboxBootstrapGeneration.current) return;
        if (
          !response.ok ||
          !Number.isSafeInteger(learnBoardId) ||
          learnBoardId! <= 0 ||
          !(
            validatedReturnBoardId === null ||
            (Number.isSafeInteger(validatedReturnBoardId) &&
              validatedReturnBoardId! > 0 &&
              validatedReturnBoardId !== learnBoardId)
          ) ||
          typeof tutorialColumnTitle !== "string" ||
          tutorialColumnTitle.trim().length === 0 ||
          tutorialColumnTitle.length > 120 ||
          !Array.isArray(tutorialInboxTargets) ||
          tutorialInboxTargets.length !== 2 ||
          tutorialInboxTargets.some(
            (target) =>
              !Number.isSafeInteger(target.notificationId) ||
              target.notificationId <= 0 ||
              !Number.isSafeInteger(target.taskId) ||
              target.taskId <= 0,
          )
        ) {
          if (response.status === 422 && candidateTargets.length === 2) {
            inboxBootstrapIgnoreCandidates.current = true;
            setTutorialState((state) => ({
              ...state,
              archivedInboxNotificationIds: [],
              lastInboxNotificationId: null,
              lastInboxTaskId: null,
              scene:
                state.scene === "goInbox" ||
                  state.scene === "inboxTriage" ||
                  state.scene === "openInboxTask" ||
                  state.scene === "inboxTaskArchive" ||
                  state.scene === "inboxZero" ||
                  state.scene === "actFourComplete" ||
                  state.scene === "boardSwitcher" ||
                  state.scene === "addColumnCommand" ||
                  state.scene === "addColumnSearch" ||
                  state.scene === "addColumnName" ||
                  state.scene === "moveTaskCommand" ||
                  state.scene === "moveTaskPick" ||
                  state.scene === "shortcutsRecap" ||
                  state.scene === "finale"
                  ? "goInbox"
                  : state.scene,
              tutorialInboxTargets: [],
              verifiedInboxKeys: [],
            }));
          }
          throw new Error("Could not verify tutorial inbox context");
        }
        if (!inboxBootstrapMounted.current) return;
        inboxContextVerified.current = true;
        setTutorialState((state) => ({
          ...state,
          learnBoardId: learnBoardId!,
          returnBoardId: validatedReturnBoardId ?? null,
          tutorialColumnTitle:
            state.tutorialColumnId !== null &&
              state.tutorialColumnTitle !== null
              ? state.tutorialColumnTitle
              : tutorialColumnTitle,
          tutorialInboxTargets,
        }));
      })
      .catch(() => {
        if (
          bootstrapGeneration !== inboxBootstrapGeneration.current ||
          !inboxBootstrapMounted.current ||
          inboxBootstrapAttempt >= 2
        )
          return;
        inboxBootstrapRetryTimer.current = setTimeout(
          () => {
            inboxBootstrapRetryTimer.current = null;
            setInboxBootstrapAttempt((attempt) => attempt + 1);
          },
          500 * 2 ** inboxBootstrapAttempt,
        );
      })
      .finally(() => {
        if (bootstrapGeneration === inboxBootstrapGeneration.current) {
          inboxBootstrapRequested.current = false;
        }
      });
  }, [
    hydrated,
    inboxBootstrapAttempt,
    tutorialEligible,
    tutorialState.active,
    tutorialState.archivedInboxNotificationIds,
    tutorialState.learnBoardId,
    tutorialState.returnBoardId,
    tutorialState.tutorialInboxTargets.length,
    requestedReturnBoardId,
    requestedTutorialInboxIdentity,
  ]);

  useEffect(() => {
    if (tutorialEligible) return;
    resetInboxBootstrap();
    clearPendingMovement();
    clearPendingInboxMovement();
    clearPendingSurface();
    clearPendingBoardMove();
    setPressedKey(null);
    setTutorialState(createLearnTutorialState(false));
    delete document.documentElement.dataset.learnTutorial;
  }, [
    clearPendingBoardMove,
    clearPendingInboxMovement,
    clearPendingMovement,
    clearPendingSurface,
    resetInboxBootstrap,
    tutorialEligible,
  ]);

  useEffect(() => {
    clearPendingMovement();
    clearPendingInboxMovement();
    clearPendingSurface();
    clearPendingBoardMove();
    setPressedKey(null);
  }, [
    clearPendingBoardMove,
    clearPendingInboxMovement,
    clearPendingMovement,
    clearPendingSurface,
    routeIdentity,
  ]);

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) {
      setOpenSurfaces({
        aiWriter: false,
        assignees: false,
        priority: false,
        dueDate: false,
        commentEditor: false,
      });
      return;
    }

    const updateOpenSurfaces = () => {
      const next = {
        aiWriter: Boolean(
          document.querySelector("#popover-wrapper-description textarea#htc"),
        ),
        assignees: Boolean(document.querySelector("#assignees-modal")),
        priority: Boolean(document.querySelector("#priority-modal")),
        dueDate: Boolean(document.querySelector("#calendar-picker")),
        commentEditor: Boolean(
          document.querySelector('#comment-input [contenteditable="true"]') &&
          document.activeElement?.closest("#comment-input"),
        ),
      };
      setOpenSurfaces((current) =>
        Object.keys(next).every(
          (key) =>
            next[key as keyof typeof next] ===
            current[key as keyof typeof current],
        )
          ? current
          : next,
      );
    };
    const observer = new MutationObserver(updateOpenSurfaces);
    updateOpenSurfaces();
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", updateOpenSurfaces);
    document.addEventListener("focusout", updateOpenSurfaces);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", updateOpenSurfaces);
      document.removeEventListener("focusout", updateOpenSurfaces);
    };
  }, [hydrated, tutorialEligible, tutorialState.active]);

  useEffect(() => {
    if (!tutorialState.active || tutorialState.scene !== "dueDateTomorrow") {
      setDueDateKeyword("");
      return;
    }
    const updateKeyword = (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (input?.id === "filter-input") setDueDateKeyword(input.value.trim());
    };
    window.addEventListener("input", updateKeyword, true);
    return () => window.removeEventListener("input", updateKeyword, true);
  }, [tutorialState.active, tutorialState.scene]);
};
