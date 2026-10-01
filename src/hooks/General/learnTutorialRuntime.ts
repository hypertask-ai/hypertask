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
  createLearnTutorialState,
  getLearnTutorialStorageKey,
  isLearnTutorialEligiblePath,
  observeLearnTutorialSurface,
  type LearnTutorialMovementKey,
  type LearnTutorialBoardMoveDirection,
  type LearnTutorialBoardPosition,
  type LearnTutorialInboxTarget,
  type LearnTutorialSurface,
} from "@/lib/tutorial/learnTutorialState";

import { getRenderedBoardPosition, parseTutorialInboxTargets } from "./learnTutorialDom";
export const useLearnTutorialRuntime = () => {
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
  return {
    router,
    pathname,
    searchParams,
    tutorialRequested,
    tutorialReturnParam,
    requestedReturnBoardId,
    requestedTutorialInboxTargets,
    requestedTutorialInboxIdentity,
    routeIdentity,
    focusedTaskId,
    inboxFocus,
    currentUser,
    showCommands,
    resetShowBoardManager,
    resetShowCommands,
    resetShowShortcuts,
    storageKey,
    tutorialEligible,
    tutorialState,
    setTutorialState,
    hydratedStorageKey,
    setHydratedStorageKey,
    hydrated,
    pressedKey,
    setPressedKey,
    pendingMovementKey,
    pendingMovementClearTimer,
    pendingSurface,
    pendingSurfaceGeneration,
    pendingSurfaceClearTimer,
    pendingSurfaceReveal,
    pendingSurfaceRevealTimer,
    pendingColumnCreation,
    pendingColumnMove,
    pendingEscapeFromDetail,
    pendingInboxGAt,
    pendingInboxMovement,
    pendingInboxMovementTimer,
    pendingInboxArchiveTarget,
    pendingInboxOpenTarget,
    inboxBootstrapRequested,
    inboxBootstrapGeneration,
    inboxBootstrapIgnoreCandidates,
    inboxBootstrapRetryTimer,
    inboxBootstrapMounted,
    inboxContextVerified,
    pendingBoardMove,
    pendingBoardMoveGeneration,
    pendingBoardMoveTimer,
    pendingBoardMoveVerificationTimer,
    commandHandoffGeneration,
    setCommandHandoffGeneration,
    dueDateKeyword,
    setDueDateKeyword,
    inboxNavigationStarted,
    setInboxNavigationStarted,
    inboxBootstrapAttempt,
    setInboxBootstrapAttempt,
    openSurfaces,
    setOpenSurfaces,
    clearPendingMovement,
    clearPendingInboxMovement,
    holdPendingSurface,
    clearPendingSurface,
    expectSurface,
    revealSurfaceAfterShortcut,
    clearPendingBoardMove,
    resetInboxBootstrap,
    expectBoardMove,
  };
};

export type LearnTutorialRuntime = ReturnType<typeof useLearnTutorialRuntime>;
