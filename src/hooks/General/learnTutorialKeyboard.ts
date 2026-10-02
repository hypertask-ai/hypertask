"use client";

import { learnTutorialReleasedHints } from "./learnTutorialSteps";
import type { LearnTutorialContext } from "./learnTutorialActions";
import { useTutorialEngine } from "./useTutorialEngine";
import {
  createLearnTutorialBoardKeyHandler,
  createLearnTutorialInboxKeyHandler,
  createLearnTutorialTaskKeyHandler,
} from "./learnTutorialKeyboardHandlers";

export const useLearnTutorialKeyboard = (context: LearnTutorialContext) => {
  const {
    router,
    pathname,
    inboxFocus,
    resetShowBoardManager,
    resetShowShortcuts,
    tutorialEligible,
    tutorialState,
    hydrated,
    setPressedKey,
    pendingMovementKey,
    pendingMovementClearTimer,
    clearPendingMovement,
    clearPendingInboxMovement,
    clearPendingSurface,
    expectSurface,
    revealSurfaceAfterShortcut,
    clearPendingBoardMove,
    expectBoardMove,
    exitTutorial,
    continueTutorial,
    archiveTutorialInboxTarget,
  } = context;

  useTutorialEngine(() => {
    if (!hydrated || !tutorialEligible || !tutorialState.active) return;

    const handleKeyDown = createLearnTutorialBoardKeyHandler(
      context,
      createLearnTutorialInboxKeyHandler(
        context,
        createLearnTutorialTaskKeyHandler(context),
      ),
    );

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
      const releasedHint = learnTutorialReleasedHints[released] ?? released;
      setPressedKey((current) => (current === releasedHint ? null : current));
    };

    const handlePointerDown = () => {
      clearPendingBoardMove();
      clearPendingMovement();
      clearPendingSurface();
    };

    return {
      target: window,
      capture: true,
      handleKeyDown,
      handleKeyUp,
      handlePointerDown,
      onCleanup: () => {
        clearPendingMovement();
        clearPendingSurface();
        clearPendingBoardMove();
      },
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
};
