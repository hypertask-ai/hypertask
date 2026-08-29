"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useRecoilValue, useResetRecoilState } from "@/lib/state";
import {
  activeItemAtom,
  currentUserAtom,
  globalNotificationFocusAtom,
  showBoardManagerAtom,
  showCommandsAtom,
  showShortcutsAtom,
} from "@/store";
import {
  activateLearnTutorialForRequest,
  advanceLearnTutorialForPath,
  canOpenLearnTutorialTask,
  createLearnTutorialState,
  getLearnTutorialStorageKey,
  isLearnTutorialEligiblePath,
  LEARN_TUTORIAL_COMMENT_SAVED_EVENT,
  LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
  LEARN_TUTORIAL_COLUMN_MOVE_EVENT,
  LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT,
  LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT,
  LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
  LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT,
  LEARN_TUTORIAL_STORAGE_KEY,
  LEARN_TUTORIAL_STATE_UPDATED_EVENT,
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
  parseLearnTutorialState,
  startLearnTutorialMovement,
  type LearnTutorialMovementKey,
  type LearnTutorialBoardMoveDirection,
  type LearnTutorialBoardPosition,
  type LearnTutorialColumnCreatedDetail,
  type LearnTutorialColumnMoveDetail,
  type LearnTutorialDismissibleSurface,
  type LearnTutorialInboxArchivedDetail,
  type LearnTutorialInboxTarget,
  type LearnTutorialSurface,
  type LearnTutorialTaskMovedDetail,
  type LearnTutorialTaskPersistedDetail,
} from "@/lib/tutorial/learnTutorialState";

import { learnTutorialScenes, type LearnTutorialScene } from "./useScenesV2";

const dispatchTutorialEscape = (target: EventTarget) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "Escape",
    key: "Escape",
  });
  Object.defineProperty(event, "keyCode", { value: 27 });
  target.dispatchEvent(event);
};

const dismissTutorialTaskModal = (surface: LearnTutorialDismissibleSurface) =>
  window.dispatchEvent(
    new CustomEvent(LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, {
      detail: { surface },
    }),
  );

const getRenderedBoardPosition = (
  taskId: number,
): LearnTutorialBoardPosition | null => {
  const task = document.getElementById(`task-${taskId}`);
  const section = task?.closest<HTMLElement>(
    "[id^='droppable-section-container-']",
  );
  const taskList = task?.closest<HTMLElement>("[id^='tasks-list-']");
  if (!task || !section || !taskList) return null;

  const sectionId = Number(
    section.id.slice("droppable-section-container-".length),
  );
  const index = Array.from(taskList.children).indexOf(task);
  return Number.isSafeInteger(sectionId) && sectionId > 0 && index >= 0
    ? { sectionId, index }
    : null;
};

const getRenderedTutorialInboxNotificationIds = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-tutorial-inbox-notification-id]",
    ),
  )
    .filter((element) => element.offsetParent !== null)
    .map((element) => Number(element.dataset.tutorialInboxNotificationId))
    .filter(
      (notificationId) =>
        Number.isSafeInteger(notificationId) && notificationId > 0,
    );

const parseTutorialInboxTargets = (
  serialized: string | null,
): LearnTutorialInboxTarget[] =>
  (serialized ?? "").split(",").flatMap((pair) => {
    const parts = pair.split(":");
    const notificationId = Number(parts[0]);
    const taskId = Number(parts[1]);
    return parts.length === 2 &&
      Number.isSafeInteger(notificationId) &&
      notificationId > 0 &&
      Number.isSafeInteger(taskId) &&
      taskId > 0
      ? [{ notificationId, taskId }]
      : [];
  });

const getRenderedTutorialInboxTargetAtIndex = (
  index: number,
): LearnTutorialInboxTarget | null => {
  const element = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-tutorial-inbox-index="${index}"]`,
    ),
  ).find((candidate) => candidate.offsetParent !== null);
  const notificationId = Number(element?.dataset.tutorialInboxNotificationId);
  const taskId = Number(element?.dataset.tutorialInboxTaskId);
  return Number.isSafeInteger(notificationId) &&
    notificationId > 0 &&
    Number.isSafeInteger(taskId) &&
    taskId > 0
    ? { notificationId, taskId }
    : null;
};

export const useLearnTutorial = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tutorialRequested = searchParams?.get("tutorial") === "1";
  const tutorialReturnParam = Number(searchParams?.get("tutorialReturn"));
  const requestedReturnBoardId =
    Number.isSafeInteger(tutorialReturnParam) && tutorialReturnParam > 0
      ? tutorialReturnParam
      : null;
  const requestedTutorialInboxTargets = parseTutorialInboxTargets(
    searchParams?.get("tutorialInbox") ?? null,
  );
  const requestedTutorialInboxIdentity = requestedTutorialInboxTargets
    .map(({ notificationId, taskId }) => `${notificationId}:${taskId}`)
    .join(",");
  const routeIdentity = `${pathname ?? ""}?${searchParams?.toString() ?? ""}`;
  const focusedTaskId = useRecoilValue(activeItemAtom);
  const inboxFocus = useRecoilValue(globalNotificationFocusAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const showCommands = useRecoilValue(showCommandsAtom);
  const resetShowBoardManager = useResetRecoilState(showBoardManagerAtom);
  const resetShowCommands = useResetRecoilState(showCommandsAtom);
  const resetShowShortcuts = useResetRecoilState(showShortcutsAtom);
  const storageKey = currentUser?.id
    ? getLearnTutorialStorageKey(currentUser.id)
    : null;
  const tutorialEligible = isLearnTutorialEligiblePath(pathname ?? "");
  const [tutorialState, setTutorialState] = useState(() =>
    createLearnTutorialState(false),
  );
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(
    null,
  );
  const hydrated = storageKey !== null && hydratedStorageKey === storageKey;
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const pendingMovementKey = useRef<LearnTutorialMovementKey | null>(null);
  const pendingMovementClearTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingSurface = useRef<LearnTutorialSurface | null>(null);
  const pendingSurfaceGeneration = useRef(0);
  const pendingSurfaceClearTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingSurfaceReveal = useRef<LearnTutorialSurface | null>(null);
  const pendingSurfaceRevealTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingColumnCreation = useRef(false);
  const pendingColumnMove = useRef(false);
  const pendingEscapeFromDetail = useRef(false);
  const pendingInboxGAt = useRef<number | null>(null);
  const pendingInboxMovement = useRef<{
    key: LearnTutorialMovementKey;
    fromIndex: number;
  } | null>(null);
  const pendingInboxMovementTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingInboxArchiveTarget = useRef<LearnTutorialInboxTarget | null>(
    null,
  );
  const pendingInboxOpenTarget = useRef<LearnTutorialInboxTarget | null>(null);
  const inboxBootstrapRequested = useRef(false);
  const inboxBootstrapGeneration = useRef(0);
  const inboxBootstrapIgnoreCandidates = useRef(false);
  const inboxBootstrapRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const inboxBootstrapMounted = useRef(true);
  const inboxContextVerified = useRef(false);
  const pendingBoardMove = useRef<{
    direction: LearnTutorialBoardMoveDirection;
    from: LearnTutorialBoardPosition;
    generation: number;
  } | null>(null);
  const pendingBoardMoveGeneration = useRef(0);
  const pendingBoardMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingBoardMoveVerificationTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [commandHandoffGeneration, setCommandHandoffGeneration] = useState<
    number | null
  >(null);
  const [dueDateKeyword, setDueDateKeyword] = useState("");
  const [inboxNavigationStarted, setInboxNavigationStarted] = useState(false);
  const [inboxBootstrapAttempt, setInboxBootstrapAttempt] = useState(0);
  const [openSurfaces, setOpenSurfaces] = useState({
    aiWriter: false,
    assignees: false,
    priority: false,
    dueDate: false,
    commentEditor: false,
  });
  useEffect(() => {
    inboxBootstrapMounted.current = true;
    return () => {
      inboxBootstrapMounted.current = false;
      if (inboxBootstrapRetryTimer.current) {
        clearTimeout(inboxBootstrapRetryTimer.current);
      }
    };
  }, []);
  const clearPendingMovement = useCallback(() => {
    if (pendingMovementClearTimer.current) {
      clearTimeout(pendingMovementClearTimer.current);
      pendingMovementClearTimer.current = null;
    }
    pendingMovementKey.current = null;
  }, []);
  const clearPendingInboxMovement = useCallback(() => {
    if (pendingInboxMovementTimer.current) {
      clearTimeout(pendingInboxMovementTimer.current);
      pendingInboxMovementTimer.current = null;
    }
    pendingInboxMovement.current = null;
  }, []);
  const holdPendingSurface = useCallback(() => {
    if (pendingSurfaceClearTimer.current) {
      clearTimeout(pendingSurfaceClearTimer.current);
      pendingSurfaceClearTimer.current = null;
    }
  }, []);
  const clearPendingSurface = useCallback(() => {
    pendingSurfaceGeneration.current += 1;
    holdPendingSurface();
    if (pendingSurfaceRevealTimer.current) {
      clearTimeout(pendingSurfaceRevealTimer.current);
      pendingSurfaceRevealTimer.current = null;
    }
    pendingSurfaceReveal.current = null;
    pendingSurface.current = null;
  }, [holdPendingSurface]);
  const expectSurface = useCallback(
    (surface: LearnTutorialSurface, timeout = 1_600) => {
      clearPendingSurface();
      pendingSurface.current = surface;
      pendingSurfaceClearTimer.current = setTimeout(
        clearPendingSurface,
        timeout,
      );
    },
    [clearPendingSurface],
  );
  const revealSurfaceAfterShortcut = useCallback(
    (
      surface: LearnTutorialSurface,
      opened: () => boolean,
      afterReveal?: () => void,
    ) => {
      const expectationGeneration = pendingSurfaceGeneration.current;
      pendingSurfaceReveal.current = surface;
      const waitForOpen = () => {
        const expectationCurrent =
          pendingSurface.current === surface &&
          pendingSurfaceGeneration.current === expectationGeneration;
        if (!expectationCurrent) return;
        if (!opened()) {
          pendingSurfaceRevealTimer.current = setTimeout(waitForOpen, 50);
          return;
        }
        pendingSurfaceRevealTimer.current = setTimeout(() => {
          pendingSurfaceReveal.current = null;
          pendingSurfaceRevealTimer.current = null;
          const shortcutMatched =
            pendingSurface.current === surface &&
            pendingSurfaceGeneration.current === expectationGeneration &&
            opened();
          if (!shortcutMatched) return;
          setTutorialState((state) =>
            observeLearnTutorialSurface(state, surface, true, true),
          );
          clearPendingSurface();
          afterReveal?.();
        }, 700);
      };
      waitForOpen();
    },
    [clearPendingSurface],
  );
  const clearPendingBoardMove = useCallback(() => {
    pendingBoardMoveGeneration.current += 1;
    if (pendingBoardMoveTimer.current) {
      clearTimeout(pendingBoardMoveTimer.current);
      pendingBoardMoveTimer.current = null;
    }
    if (pendingBoardMoveVerificationTimer.current) {
      clearTimeout(pendingBoardMoveVerificationTimer.current);
      pendingBoardMoveVerificationTimer.current = null;
    }
    pendingBoardMove.current = null;
  }, []);
  const resetInboxBootstrap = useCallback(() => {
    inboxBootstrapGeneration.current += 1;
    inboxContextVerified.current = false;
    inboxBootstrapRequested.current = false;
    inboxBootstrapIgnoreCandidates.current = false;
    if (inboxBootstrapRetryTimer.current) {
      clearTimeout(inboxBootstrapRetryTimer.current);
      inboxBootstrapRetryTimer.current = null;
    }
    setInboxBootstrapAttempt(0);
  }, []);
  const expectBoardMove = useCallback(
    (direction: LearnTutorialBoardMoveDirection, taskId: number | null) => {
      clearPendingBoardMove();
      if (taskId === null) return false;
      const from = getRenderedBoardPosition(taskId);
      if (from === null) return false;
      pendingBoardMove.current = {
        direction,
        from,
        generation: pendingBoardMoveGeneration.current,
      };
      pendingBoardMoveTimer.current = setTimeout(clearPendingBoardMove, 20_000);
      return true;
    },
    [clearPendingBoardMove],
  );

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

  useEffect(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const commandPressed = event.ctrlKey || event.metaKey;

      if (commandPressed && event.code === "Period") {
        event.preventDefault();
        event.stopImmediatePropagation();
        exitTutorial();
        return;
      }

      if (
        (tutorialState.scene === "actTwoComplete" ||
          tutorialState.scene === "actThreeComplete" ||
          tutorialState.scene === "actFourComplete") &&
        event.key === "Escape"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exitTutorial();
        return;
      }

      if (
        tutorialState.scene === "boardSwitcher" &&
        commandPressed &&
        key === "b" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        expectSurface("board-switcher", 5_000);
        revealSurfaceAfterShortcut(
          "board-switcher",
          () => Boolean(document.getElementById("boardManager")),
          resetShowBoardManager,
        );
        setPressedKey("b");
        return;
      }

      if (
        tutorialState.scene === "addColumnCommand" &&
        commandPressed &&
        key === "k" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        expectSurface("command-center", 5_000);
        revealSurfaceAfterShortcut("command-center", () =>
          Boolean(document.querySelector("input#htc")),
        );
        setPressedKey("k");
        return;
      }

      const activeInput = document.activeElement as HTMLInputElement | null;
      if (tutorialState.scene === "addColumnSearch") {
        const commandInput =
          activeInput?.id === "htc" &&
          Boolean(activeInput.closest("#command-center"))
            ? activeInput
            : activeInput?.id === "htc"
              ? activeInput
              : null;
        if (
          event.key === "Enter" &&
          commandInput?.value.trim().toLowerCase() === "add board column"
        ) {
          expectSurface("add-column", 5_000);
          revealSurfaceAfterShortcut("add-column", () =>
            Boolean(document.getElementById("addColumnModal")),
          );
          setPressedKey("enter");
          return;
        }
        if (commandInput && event.key !== "Enter") return;
      }

      if (tutorialState.scene === "addColumnName") {
        const columnInput = document.querySelector<HTMLInputElement>(
          "#addColumnModal input",
        );
        if (
          event.key === "Enter" &&
          columnInput !== null &&
          document.activeElement === columnInput &&
          tutorialState.tutorialColumnTitle !== null &&
          columnInput.value.trim() === tutorialState.tutorialColumnTitle
        ) {
          pendingColumnCreation.current = true;
          setPressedKey("enter");
          return;
        }
        if (document.activeElement === columnInput && event.key !== "Enter") {
          return;
        }
      }

      if (
        tutorialState.scene === "moveTaskCommand" &&
        key === "m" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey &&
        tutorialState.lastTaskId !== null &&
        document.activeElement?.id === `task-${tutorialState.lastTaskId}`
      ) {
        expectSurface("move-to-column", 5_000);
        revealSurfaceAfterShortcut("move-to-column", () =>
          Boolean(document.getElementById("MoveModal")),
        );
        setPressedKey("m");
        return;
      }

      if (tutorialState.scene === "moveTaskPick") {
        const moveInput = document.querySelector<HTMLInputElement>(
          "#MoveModal input#linksModal",
        );
        if (
          event.key === "Enter" &&
          moveInput !== null &&
          document.activeElement === moveInput &&
          tutorialState.tutorialColumnTitle !== null &&
          moveInput.value.trim() === tutorialState.tutorialColumnTitle
        ) {
          pendingColumnMove.current = true;
          setPressedKey("enter");
          return;
        }
        if (document.activeElement === moveInput && event.key !== "Enter") {
          return;
        }
      }

      if (
        tutorialState.scene === "shortcutsRecap" &&
        event.code === "Slash" &&
        event.shiftKey &&
        !commandPressed &&
        !event.altKey
      ) {
        expectSurface("keyboard-shortcuts", 5_000);
        revealSurfaceAfterShortcut(
          "keyboard-shortcuts",
          () => Boolean(document.getElementById("keyboard-shortcut-container")),
          resetShowShortcuts,
        );
        setPressedKey("?");
        return;
      }

      if (
        tutorialState.scene === "finale" &&
        event.key === "Enter" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPressedKey("enter");
        exitTutorial();
        return;
      }

      if (
        tutorialState.scene === "boardSwitcher" ||
        tutorialState.scene === "addColumnCommand" ||
        tutorialState.scene === "addColumnSearch" ||
        tutorialState.scene === "addColumnName" ||
        tutorialState.scene === "moveTaskCommand" ||
        tutorialState.scene === "moveTaskPick" ||
        tutorialState.scene === "shortcutsRecap" ||
        tutorialState.scene === "finale"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (
        tutorialState.scene === "goInbox" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (key === "g") {
          const startedAt = Date.now();
          pendingInboxGAt.current = startedAt;
          setInboxNavigationStarted(true);
          setPressedKey("g");
          setTimeout(() => {
            if (pendingInboxGAt.current !== startedAt) return;
            pendingInboxGAt.current = null;
            setInboxNavigationStarted(false);
          }, 1_500);
          return;
        }
        if (
          key === "i" &&
          pendingInboxGAt.current !== null &&
          Date.now() - pendingInboxGAt.current < 1_500
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (
            !inboxContextVerified.current ||
            tutorialState.learnBoardId === null ||
            tutorialState.tutorialInboxTargets.length !== 2
          ) {
            return;
          }
          pendingInboxGAt.current = null;
          setPressedKey("i");
          router.push(
            `/inbox?projectId=${tutorialState.learnBoardId}&tutorial=1`,
          );
          return;
        }
      }

      if (
        tutorialState.scene === "inboxTriage" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey &&
        (key === "j" || key === "k" || key === "e" || key === "enter")
      ) {
        if (!inboxContextVerified.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const expected = !tutorialState.verifiedInboxKeys.includes("j")
          ? "j"
          : !tutorialState.verifiedInboxKeys.includes("k")
            ? "k"
            : "e";
        if (key !== expected) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (key === "j" || key === "k") {
          clearPendingInboxMovement();
          pendingInboxMovement.current = {
            key,
            fromIndex: inboxFocus.currIdx,
          };
          pendingInboxMovementTimer.current = setTimeout(
            clearPendingInboxMovement,
            2_000,
          );
          setPressedKey(key);
          return;
        }

        const target = getRenderedTutorialInboxTargetAtIndex(
          inboxFocus.currIdx,
        );
        if (target === null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        pendingInboxArchiveTarget.current = target;
        setPressedKey("e");
        return;
      }

      if (
        tutorialState.scene === "openInboxTask" &&
        event.key === "Enter" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (!inboxContextVerified.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const target = getRenderedTutorialInboxTargetAtIndex(
          inboxFocus.currIdx,
        );
        if (target === null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        pendingInboxOpenTarget.current = target;
        setPressedKey("enter");
        return;
      }

      if (
        tutorialState.scene === "inboxTaskArchive" &&
        key === "e" &&
        !commandPressed &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (
          event.repeat ||
          pendingInboxArchiveTarget.current !== null ||
          !inboxContextVerified.current
        ) {
          return;
        }
        const target =
          tutorialState.lastInboxNotificationId !== null &&
          tutorialState.lastInboxTaskId !== null
            ? {
                notificationId: tutorialState.lastInboxNotificationId,
                taskId: tutorialState.lastInboxTaskId,
              }
            : null;
        if (target === null || tutorialState.learnBoardId === null) return;
        pendingInboxArchiveTarget.current = target;
        setPressedKey("e");
        void archiveTutorialInboxTarget(target, tutorialState.learnBoardId);
        return;
      }

      if (
        tutorialState.scene === "goInbox" ||
        tutorialState.scene === "inboxTriage" ||
        tutorialState.scene === "openInboxTask" ||
        tutorialState.scene === "inboxTaskArchive" ||
        tutorialState.scene === "inboxZero"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (tutorialState.scene === "welcome" && event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPressedKey("enter");
        continueTutorial();
        return;
      }

      if (
        tutorialState.scene === "aiWriter" &&
        commandPressed &&
        key === "j" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        expectSurface("ai-writer");
        setPressedKey("j");
        return;
      }

      if (
        tutorialState.scene === "commandCenter" &&
        commandPressed &&
        key === "k" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        expectSurface("command-center");
        setPressedKey("k");
        return;
      }

      if (
        tutorialState.scene === "assign" &&
        key === "a" &&
        !event.altKey &&
        !commandPressed &&
        !event.shiftKey
      ) {
        expectSurface("assignees");
        setPressedKey("a");
        return;
      }

      if (
        tutorialState.scene === "priority" &&
        key === "p" &&
        !event.altKey &&
        !commandPressed &&
        !event.shiftKey
      ) {
        expectSurface("priority");
        setPressedKey("p");
        return;
      }

      if (
        tutorialState.scene === "dueDate" &&
        key === "d" &&
        !event.altKey &&
        !commandPressed &&
        !event.shiftKey
      ) {
        expectSurface("due-date");
        setPressedKey("d");
        return;
      }

      if (
        tutorialState.scene === "dueDateTomorrow" &&
        event.key === "Enter" &&
        document.activeElement?.id === "filter-input" &&
        (document.activeElement as HTMLInputElement).value
          .trim()
          .toLowerCase() === "tomorrow"
      ) {
        expectSurface("due-date-committed", 20_000);
        setPressedKey("enter");
        return;
      }

      if (
        tutorialState.scene === "comment" &&
        commandPressed &&
        key === "m" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        expectSurface("comment-editor");
        setPressedKey("m");
        return;
      }

      if (
        tutorialState.scene === "commentSave" &&
        commandPressed &&
        event.key === "Enter" &&
        !event.altKey &&
        !event.shiftKey &&
        Boolean(document.activeElement?.closest("#comment-input")) &&
        Boolean(document.activeElement?.textContent?.trim())
      ) {
        expectSurface("comment-saved", 20_000);
        setPressedKey("enter");
        return;
      }

      if (tutorialState.scene === "escape" && event.key === "Escape") {
        pendingEscapeFromDetail.current = (pathname ?? "").startsWith(
          "/detail/",
        );
        setPressedKey("escape");
        event.preventDefault();
        event.stopImmediatePropagation();
        (document.activeElement as HTMLElement | null)?.blur();
        document.getElementById("task-detail-page-back-button")?.click();
        return;
      }

      const expectedBoardMove =
        tutorialState.scene === "moveAcross"
          ? tutorialState.verifiedBoardMoves.includes("right")
            ? {
                direction: "left" as const,
                keys: ["h", "arrowleft"],
                pressed: "h",
              }
            : {
                direction: "right" as const,
                keys: ["l", "arrowright"],
                pressed: "l",
              }
          : tutorialState.scene === "reorder"
            ? tutorialState.verifiedBoardMoves.includes("down")
              ? {
                  direction: "up" as const,
                  keys: ["k", "arrowup"],
                  pressed: "k",
                }
              : {
                  direction: "down" as const,
                  keys: ["j", "arrowdown"],
                  pressed: "j",
                }
            : null;
      const tutorialTaskFocused =
        tutorialState.lastTaskId !== null &&
        document.activeElement?.id === `task-${tutorialState.lastTaskId}`;
      if (
        expectedBoardMove &&
        tutorialTaskFocused &&
        event.shiftKey &&
        !event.altKey &&
        !commandPressed &&
        [
          "h",
          "j",
          "k",
          "l",
          "arrowleft",
          "arrowdown",
          "arrowup",
          "arrowright",
        ].includes(key)
      ) {
        if (
          !expectedBoardMove.keys.includes(key) ||
          event.repeat ||
          pendingBoardMove.current !== null
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (
          !expectBoardMove(
            expectedBoardMove.direction,
            tutorialState.lastTaskId,
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        setPressedKey(expectedBoardMove.pressed);
        return;
      }

      if (tutorialState.scene !== "movement") return;

      if (
        (key === "j" || key === "k") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        clearPendingMovement();
        pendingMovementKey.current = key;
        setPressedKey(key);
        return;
      }

      if (event.key === "Enter") {
        if (!canOpenLearnTutorialTask(tutorialState)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        setPressedKey("enter");
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const released = event.key.toLowerCase();
      if (pendingMovementKey.current === released) {
        pendingMovementClearTimer.current = setTimeout(() => {
          if (pendingMovementKey.current === released) {
            clearPendingMovement();
          } else {
            pendingMovementClearTimer.current = null;
          }
        }, 300);
      }
      const releasedHint =
        (
          {
            arrowleft: "h",
            arrowdown: "j",
            arrowup: "k",
            arrowright: "l",
          } as Record<string, string>
        )[released] ?? released;
      setPressedKey((current) => (current === releasedHint ? null : current));
    };

    const handlePointerDown = () => {
      clearPendingBoardMove();
      clearPendingMovement();
      clearPendingSurface();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      clearPendingMovement();
      clearPendingSurface();
      clearPendingBoardMove();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [
    archiveTutorialInboxTarget,
    clearPendingMovement,
    clearPendingInboxMovement,
    clearPendingSurface,
    clearPendingBoardMove,
    continueTutorial,
    expectBoardMove,
    expectSurface,
    exitTutorial,
    hydrated,
    tutorialEligible,
    tutorialState,
    pathname,
    resetShowBoardManager,
    resetShowShortcuts,
    revealSurfaceAfterShortcut,
    router,
    inboxFocus.currIdx,
  ]);

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
        `/project?id=${next.learnBoardId}&tutorial=1${
          next.returnBoardId !== null
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

  const sceneName = tutorialState.scene as LearnTutorialScene;
  const movementKeys = tutorialState.verifiedMovementKeys;
  const activeHintCount =
    sceneName === "movement"
      ? Number(movementKeys.includes("j")) + Number(movementKeys.includes("k"))
      : sceneName === "moveAcross" || sceneName === "reorder"
        ? tutorialState.verifiedBoardMoves.length * 2
        : sceneName === "goInbox"
          ? Number(inboxNavigationStarted)
          : sceneName === "inboxTriage"
            ? tutorialState.verifiedInboxKeys.length
            : sceneName === "dueDateTomorrow" &&
                dueDateKeyword.toLowerCase() === "tomorrow"
              ? 1
              : 0;

  return {
    activeHintCount,
    continueTutorial,
    exitTutorial,
    hydrated,
    isActive: hydrated && tutorialEligible && tutorialState.active,
    pressedKey,
    scene: learnTutorialScenes[sceneName],
    sceneName,
    tutorialState,
  };
};
