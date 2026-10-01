import { getLearnTutorialBoardMove } from "./learnTutorialSteps";
import { canOpenLearnTutorialTask } from "@/lib/tutorial/learnTutorialState";
import type { LearnTutorialContext } from "./learnTutorialActions";
import { getRenderedTutorialInboxTargetAtIndex } from "./learnTutorialDom";

export const createLearnTutorialBoardKeyHandler = (
  context: LearnTutorialContext,
  next: (event: KeyboardEvent, key: string, commandPressed: boolean) => void,
) => {
  const {
    resetShowBoardManager,
    resetShowShortcuts,
    tutorialState,
    setPressedKey,
    pendingColumnCreation,
    pendingColumnMove,
    expectSurface,
    revealSurfaceAfterShortcut,
    exitTutorial,
  } = context;
  return (event: KeyboardEvent) => {
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
    return next(event, key, commandPressed);
  };
};

export const createLearnTutorialInboxKeyHandler = (
  context: LearnTutorialContext,
  next: (event: KeyboardEvent, key: string, commandPressed: boolean) => void,
) => {
  const {
    router,
    inboxFocus,
    tutorialState,
    setPressedKey,
    pendingInboxGAt,
    pendingInboxMovement,
    pendingInboxMovementTimer,
    pendingInboxArchiveTarget,
    pendingInboxOpenTarget,
    inboxContextVerified,
    setInboxNavigationStarted,
    clearPendingInboxMovement,
    archiveTutorialInboxTarget,
  } = context;
  return (event: KeyboardEvent, key: string, commandPressed: boolean) => {
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
    return next(event, key, commandPressed);
  };
};

export const createLearnTutorialTaskKeyHandler = (context: LearnTutorialContext) => {
  const {
    pathname,
    tutorialState,
    setPressedKey,
    pendingMovementKey,
    pendingEscapeFromDetail,
    pendingBoardMove,
    clearPendingMovement,
    expectSurface,
    expectBoardMove,
    continueTutorial,
  } = context;
  return (event: KeyboardEvent, key: string, commandPressed: boolean) => {
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

    const expectedBoardMove = getLearnTutorialBoardMove(tutorialState);
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
};

