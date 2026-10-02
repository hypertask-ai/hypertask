"use client";

import { learnTutorialScenes, type LearnTutorialScene } from "./useScenesV2";
import { useLearnTutorialRuntime } from "./learnTutorialRuntime";
import { useLearnTutorialPersistence } from "./learnTutorialPersistence";
import { useLearnTutorialActions } from "./learnTutorialActions";
import { useLearnTutorialKeyboard } from "./learnTutorialKeyboard";
import {
  useLearnTutorialColumnObservers,
  useLearnTutorialInboxObservers,
  useLearnTutorialSurfaceObservers,
  useLearnTutorialMovementObservers,
} from "./learnTutorialObservers";

export const useLearnTutorial = () => {
  const runtime = useLearnTutorialRuntime();
  useLearnTutorialPersistence(runtime);
  const actions = useLearnTutorialActions(runtime);
  const context = { ...runtime, ...actions };
  useLearnTutorialKeyboard(context);
  useLearnTutorialColumnObservers(context);
  useLearnTutorialInboxObservers(context);
  useLearnTutorialSurfaceObservers(context);
  useLearnTutorialMovementObservers(context);
  const {
    tutorialEligible,
    tutorialState,
    hydrated,
    pressedKey,
    dueDateKeyword,
    inboxNavigationStarted,
    exitTutorial,
    continueTutorial,
  } = context;

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
