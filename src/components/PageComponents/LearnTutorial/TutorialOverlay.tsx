"use client";

import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useLearnTutorial } from "@/hooks/General/useLearnTutorial";
import { cn } from "@/utils/undoActions/helperFuncs";
import styles from "./TutorialOverlay.module.scss";

const TutorialKey = ({
  active = false,
  nudge = false,
  children,
}: {
  active?: boolean;
  nudge?: boolean;
  children: string;
}) => (
  <kbd
    className={cn(
      styles.key,
      active &&
        `${styles.keyPressed} !bg-hypertasks-green !text-white-black-inverted`,
      nudge && styles.nudge,
    )}
  >
    {children.toUpperCase()}
  </kbd>
);

const TutorialOverlay = () => {
  const isApple = useDeviceContext();
  const {
    activeHintCount,
    continueTutorial,
    exitTutorial,
    isActive,
    pressedKey,
    scene,
    sceneName,
    tutorialState,
  } = useLearnTutorial();

  if (!isActive) return null;

  const nextExpectedKey =
    sceneName === "welcome"
      ? "enter"
      : sceneName === "actTwoComplete" ||
          sceneName === "actThreeComplete" ||
          sceneName === "actFourComplete" ||
          sceneName === "escape"
        ? "escape"
        : sceneName === "finale"
          ? "enter"
          : sceneName === "boardSwitcher"
            ? "b"
            : sceneName === "addColumnCommand"
              ? "k"
              : sceneName === "addColumnSearch"
                ? "add board column"
                : sceneName === "addColumnName" || sceneName === "moveTaskPick"
                  ? (tutorialState.tutorialColumnTitle?.toLowerCase() ?? "")
                  : sceneName === "moveTaskCommand"
                    ? "m"
                    : sceneName === "shortcutsRecap"
                      ? "?"
                      : sceneName === "aiWriter"
                        ? "j"
                        : sceneName === "commandCenter"
                          ? "k"
                          : sceneName === "assign"
                            ? "a"
                            : sceneName === "priority"
                              ? "p"
                              : sceneName === "dueDate"
                                ? "d"
                                : sceneName === "dueDateTomorrow"
                                  ? activeHintCount > 0
                                    ? "enter"
                                    : "tomorrow"
                                  : sceneName === "comment"
                                    ? "m"
                                    : sceneName === "commentSave"
                                      ? "enter"
                                      : sceneName === "moveAcross"
                                        ? tutorialState.verifiedBoardMoves.includes(
                                            "right",
                                          )
                                          ? "h"
                                          : "l"
                                        : sceneName === "reorder"
                                          ? tutorialState.verifiedBoardMoves.includes(
                                              "down",
                                            )
                                            ? "k"
                                            : "j"
                                          : sceneName === "goInbox"
                                            ? activeHintCount > 0
                                              ? "i"
                                              : "g"
                                            : sceneName === "inboxTriage"
                                              ? !tutorialState.verifiedInboxKeys.includes(
                                                  "j",
                                                )
                                                ? "j"
                                                : !tutorialState.verifiedInboxKeys.includes(
                                                      "k",
                                                    )
                                                  ? "k"
                                                  : "e"
                                              : sceneName === "openInboxTask"
                                                ? "enter"
                                                : sceneName ===
                                                    "inboxTaskArchive"
                                                  ? "e"
                                                  : sceneName === "inboxZero"
                                                    ? ""
                                                    : !tutorialState.verifiedMovementKeys.includes(
                                                          "j",
                                                        )
                                                      ? "j"
                                                      : !tutorialState.verifiedMovementKeys.includes(
                                                            "k",
                                                          )
                                                        ? "k"
                                                        : "enter";
  const showHints = !scene.readOnly;
  const locksInboxPointerInput =
    sceneName === "goInbox" ||
    sceneName === "inboxTriage" ||
    sceneName === "openInboxTask" ||
    sceneName === "inboxTaskArchive" ||
    sceneName === "inboxZero";
  const locksActFivePointerInput =
    sceneName === "boardSwitcher" ||
    sceneName === "addColumnCommand" ||
    sceneName === "addColumnSearch" ||
    sceneName === "addColumnName" ||
    sceneName === "moveTaskCommand" ||
    sceneName === "moveTaskPick" ||
    sceneName === "shortcutsRecap";
  const sceneHints = scene.hints.map((hint) =>
    hint === "COLUMN NAME" && tutorialState.tutorialColumnTitle
      ? tutorialState.tutorialColumnTitle
      : hint,
  );

  const sentenceAction =
    sceneName === "welcome" ? (
      <button
        type="button"
        onClick={continueTutorial}
        className={cn(styles.sentenceAction, styles.nudge)}
      >
        <span>Hit</span>
        <TutorialKey active={pressedKey === "enter"}>Enter</TutorialKey>
        <span>to begin</span>
      </button>
    ) : sceneName === "actTwoComplete" ||
      sceneName === "actThreeComplete" ||
      sceneName === "actFourComplete" ||
      sceneName === "finale" ? (
      <button
        type="button"
        onClick={exitTutorial}
        className={cn(styles.sentenceAction, styles.nudge)}
      >
        <span>Press</span>
        <TutorialKey
          active={pressedKey === (sceneName === "finale" ? "enter" : "escape")}
        >
          {sceneName === "finale" ? "Enter" : "Esc"}
        </TutorialKey>
        <span>to return to your board</span>
      </button>
    ) : null;

  return (
    <>
      {(scene.readOnly ||
        locksInboxPointerInput ||
        locksActFivePointerInput) && (
        <div aria-hidden="true" className={styles.backdrop} />
      )}
      <aside aria-live="polite" className={styles.coach}>
        <div className={styles.shell}>
          <div className={styles.progress}>
            <strong>Learn Hypertask</strong>
            <span>Step {scene.step} of 17</span>
          </div>

          <div className={styles.message}>
            <h2 className={styles.title}>{scene.title}</h2>
            <p className={styles.subtitle}>{scene.subtitle}</p>
            {sentenceAction}
            {showHints && (
              <div className={styles.hintRow}>
                {sceneHints.map((hint, index) => {
                  const normalizedHint = hint.toLowerCase();
                  const completed =
                    (sceneName === "movement" ||
                      sceneName === "dueDateTomorrow" ||
                      sceneName === "moveAcross" ||
                      sceneName === "reorder" ||
                      sceneName === "goInbox" ||
                      sceneName === "inboxTriage") &&
                    index < activeHintCount;
                  const displayHint =
                    hint === "MOD" ? (isApple ? "CMD" : "CTRL") : hint;
                  return (
                    <span key={`${hint}-${index}`} className={styles.hintGroup}>
                      {sceneName === "movement" && index === 2 && (
                        <span>then</span>
                      )}
                      {sceneName !== "movement" &&
                        sceneName !== "dueDateTomorrow" &&
                        sceneName !== "moveAcross" &&
                        sceneName !== "reorder" &&
                        sceneName !== "goInbox" &&
                        sceneName !== "inboxTriage" &&
                        sceneName !== "addColumnSearch" &&
                        sceneName !== "addColumnName" &&
                        sceneName !== "moveTaskPick" &&
                        index > 0 && <span aria-hidden="true">+</span>}
                      {sceneName === "dueDateTomorrow" && index === 1 && (
                        <span>then</span>
                      )}
                      {(sceneName === "moveAcross" ||
                        sceneName === "reorder") &&
                        index > 0 &&
                        (index === 2 ? (
                          <span>then</span>
                        ) : (
                          <span aria-hidden="true">+</span>
                        ))}
                      {(sceneName === "goInbox" ||
                        sceneName === "inboxTriage" ||
                        sceneName === "addColumnSearch" ||
                        sceneName === "addColumnName" ||
                        sceneName === "moveTaskPick") &&
                        index > 0 && <span>then</span>}
                      <TutorialKey
                        active={completed || pressedKey === normalizedHint}
                        nudge={nextExpectedKey === normalizedHint}
                      >
                        {displayHint}
                      </TutorialKey>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={exitTutorial}
            className={styles.exitAction}
            aria-label="Exit tutorial"
          >
            <span className={styles.exitLabel}>Exit tutorial</span>
            <span className={styles.exitKeys}>
              <TutorialKey>{isApple ? "CMD" : "CTRL"}</TutorialKey>
              <TutorialKey>.</TutorialKey>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default TutorialOverlay;
