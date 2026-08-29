import { KEYBOARD_SHORTCUT_TUTORIAL_ENABLED } from "./keyboardShortcutTutorial";

export const LEARN_TUTORIAL_STORAGE_KEY = "hypertask:learn-tutorial:v1";
export const LEARN_TUTORIAL_VERSION = 1 as const;

export const getLearnTutorialStorageKey = (userId: number | string) =>
  `${LEARN_TUTORIAL_STORAGE_KEY}:user:${userId}`;

export const isLearnTutorialEligiblePath = (pathname: string) =>
  KEYBOARD_SHORTCUT_TUTORIAL_ENABLED &&
  (pathname === "/project" ||
    pathname.startsWith("/project/") ||
    pathname.startsWith("/detail/") ||
    pathname === "/inbox" ||
    pathname.startsWith("/inbox/"));

export type LearnTutorialScene =
  | "welcome"
  | "movement"
  | "aiWriter"
  | "commandCenter"
  | "assign"
  | "priority"
  | "dueDate"
  | "dueDateTomorrow"
  | "comment"
  | "commentSave"
  | "escape"
  | "actTwoComplete"
  | "moveAcross"
  | "reorder"
  | "actThreeComplete"
  | "goInbox"
  | "inboxTriage"
  | "openInboxTask"
  | "inboxTaskArchive"
  | "inboxZero"
  | "actFourComplete"
  | "boardSwitcher"
  | "addColumnCommand"
  | "addColumnSearch"
  | "addColumnName"
  | "moveTaskCommand"
  | "moveTaskPick"
  | "shortcutsRecap"
  | "finale";
export type LearnTutorialMovementKey = "j" | "k";
export type LearnTutorialInboxKey = "j" | "k" | "e";
export type LearnTutorialBoardMoveDirection = "right" | "left" | "down" | "up";
export type LearnTutorialBoardPosition = {
  sectionId: number;
  index: number;
};
export type LearnTutorialTaskMovedDetail = {
  taskId: number;
  direction: LearnTutorialBoardMoveDirection;
  from: LearnTutorialBoardPosition;
  to: LearnTutorialBoardPosition;
};
export type LearnTutorialTaskPersistedDetail = {
  taskId: number;
  direction: LearnTutorialBoardMoveDirection;
  fromSectionId: number;
  toSectionId: number;
};
export type LearnTutorialInboxArchivedDetail = {
  notificationId: number;
  taskId: number;
  source: "inbox" | "detail";
};
export type LearnTutorialInboxTarget = {
  notificationId: number;
  taskId: number;
};
export type LearnTutorialColumnCreatedDetail = {
  columnId: number;
  projectId: number;
  title: string;
};
export type LearnTutorialColumnMoveDetail = {
  fromSectionId: number | null;
  projectId: number;
  taskId: number;
  toSectionId: number;
  title: string;
};
export type LearnTutorialSurface =
  | "ai-writer"
  | "command-center"
  | "assignees"
  | "priority"
  | "due-date"
  | "due-date-committed"
  | "comment-editor"
  | "comment-saved"
  | "board-switcher"
  | "add-column"
  | "move-to-column"
  | "keyboard-shortcuts";
export type LearnTutorialDismissibleSurface = "assignees" | "priority";

export const LEARN_TUTORIAL_COMMENT_SAVED_EVENT =
  "hypertask:learn-tutorial:comment-saved";
export const LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT =
  "hypertask:learn-tutorial:due-date-saved";
export const LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT =
  "hypertask:learn-tutorial:dismiss-task-modal";
export const LEARN_TUTORIAL_TASK_MOVED_EVENT =
  "hypertask:learn-tutorial:task-moved";
export const LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT =
  "hypertask:learn-tutorial:inbox-archived";
export const LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT =
  "hypertask:learn-tutorial:inbox-archive-failed";
export const LEARN_TUTORIAL_COLUMN_CREATED_EVENT =
  "hypertask:learn-tutorial:column-created";
export const LEARN_TUTORIAL_COLUMN_MOVE_EVENT =
  "hypertask:learn-tutorial:column-move";
export const LEARN_TUTORIAL_STATE_UPDATED_EVENT =
  "hypertask:learn-tutorial:state-updated";

export type LearnTutorialState = {
  version: typeof LEARN_TUTORIAL_VERSION;
  active: boolean;
  scene: LearnTutorialScene;
  verifiedMovementKeys: LearnTutorialMovementKey[];
  verifiedBoardMoves: LearnTutorialBoardMoveDirection[];
  verifiedInboxKeys: LearnTutorialInboxKey[];
  boardMoveOrigin: LearnTutorialBoardPosition | null;
  learnBoardId: number | null;
  tutorialInboxTargets: LearnTutorialInboxTarget[];
  archivedInboxNotificationIds: number[];
  lastInboxNotificationId: number | null;
  lastInboxTaskId: number | null;
  lastTaskId: number | null;
  returnBoardId: number | null;
  tutorialColumnId: number | null;
  tutorialColumnTitle: string | null;
};

export const createLearnTutorialState = (
  active = true,
): LearnTutorialState => ({
  version: LEARN_TUTORIAL_VERSION,
  active,
  scene: "welcome",
  verifiedMovementKeys: [],
  verifiedBoardMoves: [],
  verifiedInboxKeys: [],
  boardMoveOrigin: null,
  learnBoardId: null,
  tutorialInboxTargets: [],
  archivedInboxNotificationIds: [],
  lastInboxNotificationId: null,
  lastInboxTaskId: null,
  lastTaskId: null,
  returnBoardId: null,
  tutorialColumnId: null,
  tutorialColumnTitle: null,
});

export const activateLearnTutorialForRequest = (
  state: LearnTutorialState,
  requested: boolean,
): LearnTutorialState => {
  if (!KEYBOARD_SHORTCUT_TUTORIAL_ENABLED) {
    return state.active ? createLearnTutorialState(false) : state;
  }
  if (!requested) return state;
  return state.active ? state : createLearnTutorialState();
};

export const startLearnTutorialMovement = (
  state: LearnTutorialState,
  focusedTaskId: number | null,
): LearnTutorialState => ({
  ...state,
  scene: "movement",
  verifiedMovementKeys: [],
  lastTaskId: focusedTaskId,
});

export const observeLearnTutorialTaskFocus = (
  state: LearnTutorialState,
  focusedTaskId: number | null,
  movementKey: LearnTutorialMovementKey | null,
): LearnTutorialState => {
  if (
    !state.active ||
    state.scene !== "movement" ||
    focusedTaskId === null ||
    focusedTaskId === state.lastTaskId
  ) {
    return state;
  }

  const expectedMovementKey = !state.verifiedMovementKeys.includes("j")
    ? "j"
    : !state.verifiedMovementKeys.includes("k")
      ? "k"
      : null;
  const verifiedMovementKeys =
    movementKey !== null && movementKey === expectedMovementKey
      ? [...state.verifiedMovementKeys, movementKey]
      : state.verifiedMovementKeys;

  return {
    ...state,
    lastTaskId: focusedTaskId,
    verifiedMovementKeys,
  };
};

export const canOpenLearnTutorialTask = (state: LearnTutorialState) =>
  state.scene === "movement" &&
  state.verifiedMovementKeys.includes("j") &&
  state.verifiedMovementKeys.includes("k");

export const advanceLearnTutorialForPath = (
  state: LearnTutorialState,
  pathname: string,
): LearnTutorialState => {
  if (
    state.active &&
    canOpenLearnTutorialTask(state) &&
    pathname.startsWith("/detail/")
  ) {
    return { ...state, scene: "aiWriter" };
  }
  return state;
};

export const observeLearnTutorialSurface = (
  state: LearnTutorialState,
  surface: LearnTutorialSurface,
  opened: boolean,
  shortcutMatched: boolean,
): LearnTutorialState => {
  if (!state.active || !opened || !shortcutMatched) return state;

  if (state.scene === "aiWriter" && surface === "ai-writer") {
    return { ...state, scene: "commandCenter" };
  }

  if (state.scene === "commandCenter" && surface === "command-center") {
    return { ...state, scene: "assign" };
  }

  if (state.scene === "assign" && surface === "assignees") {
    return { ...state, scene: "priority" };
  }

  if (state.scene === "priority" && surface === "priority") {
    return { ...state, scene: "dueDate" };
  }

  if (state.scene === "dueDate" && surface === "due-date") {
    return { ...state, scene: "dueDateTomorrow" };
  }

  if (state.scene === "dueDateTomorrow" && surface === "due-date-committed") {
    return { ...state, scene: "comment" };
  }

  if (state.scene === "comment" && surface === "comment-editor") {
    return { ...state, scene: "commentSave" };
  }

  if (state.scene === "commentSave" && surface === "comment-saved") {
    return { ...state, scene: "escape" };
  }

  if (state.scene === "boardSwitcher" && surface === "board-switcher") {
    return { ...state, scene: "addColumnCommand" };
  }

  if (state.scene === "addColumnCommand" && surface === "command-center") {
    return { ...state, scene: "addColumnSearch" };
  }

  if (state.scene === "addColumnSearch" && surface === "add-column") {
    return { ...state, scene: "addColumnName" };
  }

  if (state.scene === "moveTaskCommand" && surface === "move-to-column") {
    return { ...state, scene: "moveTaskPick" };
  }

  if (state.scene === "shortcutsRecap" && surface === "keyboard-shortcuts") {
    return { ...state, scene: "finale" };
  }

  return state;
};

export const observeLearnTutorialEscape = (
  state: LearnTutorialState,
  pathname: string,
  escapedFromDetail: boolean,
): LearnTutorialState =>
  state.active &&
  state.scene === "escape" &&
  escapedFromDetail &&
  (pathname.startsWith("/project") || pathname.startsWith("/inbox"))
    ? {
        ...state,
        scene: "moveAcross",
        verifiedBoardMoves: [],
        boardMoveOrigin: null,
      }
    : state;

export const shouldPreserveLearnTutorialInboxOnComment = (
  state: LearnTutorialState | null,
  taskId: number | null | undefined,
) =>
  state?.active === true &&
  (state.scene === "comment" || state.scene === "commentSave") &&
  state.lastTaskId === taskId;

const sameBoardPosition = (
  left: LearnTutorialBoardPosition,
  right: LearnTutorialBoardPosition,
) => left.sectionId === right.sectionId && left.index === right.index;

export const observeLearnTutorialBoardMove = (
  state: LearnTutorialState,
  move: LearnTutorialTaskMovedDetail,
  renderedPosition: LearnTutorialBoardPosition | null,
): LearnTutorialState => {
  if (
    !state.active ||
    move.taskId !== state.lastTaskId ||
    renderedPosition === null ||
    !sameBoardPosition(renderedPosition, move.to)
  ) {
    return state;
  }

  if (
    state.scene === "moveAcross" &&
    state.verifiedBoardMoves.length === 0 &&
    move.direction === "right" &&
    move.from.sectionId !== move.to.sectionId
  ) {
    return {
      ...state,
      verifiedBoardMoves: ["right"],
      boardMoveOrigin: move.from,
    };
  }

  if (
    state.scene === "moveAcross" &&
    state.verifiedBoardMoves.length === 1 &&
    state.verifiedBoardMoves[0] === "right" &&
    move.direction === "left" &&
    move.from.sectionId !== move.to.sectionId &&
    state.boardMoveOrigin !== null &&
    sameBoardPosition(move.to, state.boardMoveOrigin)
  ) {
    return {
      ...state,
      scene: "reorder",
      verifiedBoardMoves: [],
      boardMoveOrigin: null,
    };
  }

  if (
    state.scene === "reorder" &&
    state.verifiedBoardMoves.length === 0 &&
    move.direction === "down" &&
    move.from.sectionId === move.to.sectionId &&
    move.to.index === move.from.index + 1
  ) {
    return {
      ...state,
      verifiedBoardMoves: ["down"],
      boardMoveOrigin: move.from,
    };
  }

  if (
    state.scene === "reorder" &&
    state.verifiedBoardMoves.length === 1 &&
    state.verifiedBoardMoves[0] === "down" &&
    move.direction === "up" &&
    move.from.sectionId === move.to.sectionId &&
    state.boardMoveOrigin !== null &&
    sameBoardPosition(move.to, state.boardMoveOrigin)
  ) {
    return {
      ...state,
      scene: "goInbox",
      verifiedBoardMoves: [],
      boardMoveOrigin: null,
    };
  }

  return state;
};

export const observeLearnTutorialInboxNavigation = (
  state: LearnTutorialState,
  pathname: string,
  renderedNotificationIds: number[],
): LearnTutorialState =>
  state.active &&
  state.scene === "goInbox" &&
  pathname.startsWith("/inbox") &&
  state.tutorialInboxTargets.length === 2 &&
  state.tutorialInboxTargets.every(({ notificationId }) =>
    renderedNotificationIds.includes(notificationId),
  )
    ? { ...state, scene: "inboxTriage", verifiedInboxKeys: [] }
    : state;

export const observeLearnTutorialInboxFocus = (
  state: LearnTutorialState,
  key: LearnTutorialMovementKey,
  previousIndex: number,
  nextIndex: number,
): LearnTutorialState => {
  if (!state.active || state.scene !== "inboxTriage") return state;

  const expected = !state.verifiedInboxKeys.includes("j")
    ? "j"
    : !state.verifiedInboxKeys.includes("k")
      ? "k"
      : null;
  const movedAsExpected =
    (key === "j" && nextIndex === previousIndex + 1) ||
    (key === "k" && nextIndex === previousIndex - 1);
  return key === expected && movedAsExpected
    ? { ...state, verifiedInboxKeys: [...state.verifiedInboxKeys, key] }
    : state;
};

export const observeLearnTutorialInboxArchive = (
  state: LearnTutorialState,
  archive: LearnTutorialInboxArchivedDetail,
  expectedTarget: LearnTutorialInboxTarget | null,
): LearnTutorialState => {
  if (
    !state.active ||
    expectedTarget === null ||
    archive.notificationId !== expectedTarget.notificationId ||
    archive.taskId !== expectedTarget.taskId ||
    !state.tutorialInboxTargets.some(
      (target) =>
        target.notificationId === archive.notificationId &&
        target.taskId === archive.taskId,
    )
  ) {
    return state;
  }

  if (
    state.scene === "inboxTriage" &&
    archive.source === "inbox" &&
    state.verifiedInboxKeys.includes("j") &&
    state.verifiedInboxKeys.includes("k")
  ) {
    return {
      ...state,
      scene: "openInboxTask",
      verifiedInboxKeys: [...state.verifiedInboxKeys, "e"],
      archivedInboxNotificationIds: [archive.notificationId],
    };
  }

  if (
    state.scene === "inboxTaskArchive" &&
    archive.source === "detail" &&
    state.lastInboxNotificationId === archive.notificationId &&
    state.lastInboxTaskId === archive.taskId
  ) {
    return {
      ...state,
      scene: "inboxZero",
      archivedInboxNotificationIds: Array.from(
        new Set([
          ...state.archivedInboxNotificationIds,
          archive.notificationId,
        ]),
      ),
    };
  }

  return state;
};

export const observeLearnTutorialInboxTaskOpen = (
  state: LearnTutorialState,
  pathname: string,
  expectedTarget: LearnTutorialInboxTarget | null,
): LearnTutorialState =>
  state.active &&
  state.scene === "openInboxTask" &&
  pathname.startsWith("/detail/") &&
  expectedTarget !== null &&
  state.tutorialInboxTargets.some(
    (target) =>
      target.notificationId === expectedTarget.notificationId &&
      target.taskId === expectedTarget.taskId,
  )
    ? {
        ...state,
        scene: "inboxTaskArchive",
        lastInboxNotificationId: expectedTarget.notificationId,
        lastInboxTaskId: expectedTarget.taskId,
      }
    : state;

export const observeLearnTutorialInboxZero = (
  state: LearnTutorialState,
  pathname: string,
  inboxLoaded: boolean,
  renderedNotificationIds: number[],
): LearnTutorialState =>
  state.active &&
  state.scene === "inboxZero" &&
  pathname.startsWith("/inbox") &&
  inboxLoaded &&
  state.tutorialInboxTargets.every(
    ({ notificationId }) => !renderedNotificationIds.includes(notificationId),
  )
    ? { ...state, scene: "boardSwitcher" }
    : state;

export const observeLearnTutorialColumnCreated = (
  state: LearnTutorialState,
  detail: LearnTutorialColumnCreatedDetail,
): LearnTutorialState =>
  state.active &&
  state.scene === "addColumnName" &&
  state.learnBoardId === detail.projectId &&
  state.tutorialColumnTitle === detail.title &&
  Number.isSafeInteger(detail.columnId) &&
  detail.columnId > 0
    ? {
        ...state,
        scene: "moveTaskCommand",
        tutorialColumnId: detail.columnId,
      }
    : state;

export const observeLearnTutorialColumnMove = (
  state: LearnTutorialState,
  detail: LearnTutorialColumnMoveDetail,
): LearnTutorialState =>
  state.active &&
  state.scene === "moveTaskPick" &&
  state.lastTaskId === detail.taskId &&
  state.learnBoardId === detail.projectId &&
  state.tutorialColumnId === detail.toSectionId &&
  state.tutorialColumnTitle === detail.title &&
  detail.fromSectionId !== detail.toSectionId
    ? { ...state, scene: "shortcutsRecap" }
    : state;

export const parseLearnTutorialState = (
  serialized: string | null,
): LearnTutorialState | null => {
  if (!serialized) return null;

  try {
    const value = JSON.parse(serialized) as Partial<LearnTutorialState>;
    const storedScene = value.scene as string | undefined;
    const validScene =
      storedScene === "welcome" ||
      storedScene === "movement" ||
      storedScene === "aiWriter" ||
      storedScene === "commandCenter" ||
      storedScene === "actOneComplete" ||
      storedScene === "assign" ||
      storedScene === "priority" ||
      storedScene === "dueDate" ||
      storedScene === "dueDateTomorrow" ||
      storedScene === "comment" ||
      storedScene === "commentSave" ||
      storedScene === "escape" ||
      storedScene === "actTwoComplete" ||
      storedScene === "moveAcross" ||
      storedScene === "reorder" ||
      storedScene === "actThreeComplete" ||
      storedScene === "goInbox" ||
      storedScene === "inboxTriage" ||
      storedScene === "openInboxTask" ||
      storedScene === "inboxTaskArchive" ||
      storedScene === "inboxZero" ||
      storedScene === "actFourComplete" ||
      storedScene === "boardSwitcher" ||
      storedScene === "addColumnCommand" ||
      storedScene === "addColumnSearch" ||
      storedScene === "addColumnName" ||
      storedScene === "moveTaskCommand" ||
      storedScene === "moveTaskPick" ||
      storedScene === "shortcutsRecap" ||
      storedScene === "finale" ||
      storedScene === "complete";
    const validKeys =
      Array.isArray(value.verifiedMovementKeys) &&
      value.verifiedMovementKeys.every((key) => key === "j" || key === "k");
    const validBoardMoves =
      value.verifiedBoardMoves === undefined ||
      (Array.isArray(value.verifiedBoardMoves) &&
        value.verifiedBoardMoves.every(
          (direction) =>
            direction === "right" ||
            direction === "left" ||
            direction === "down" ||
            direction === "up",
        ));
    const validBoardMoveOrigin =
      value.boardMoveOrigin === undefined ||
      value.boardMoveOrigin === null ||
      (Number.isSafeInteger(value.boardMoveOrigin.sectionId) &&
        Number.isSafeInteger(value.boardMoveOrigin.index) &&
        value.boardMoveOrigin.index >= 0);
    const validInboxKeys =
      value.verifiedInboxKeys === undefined ||
      (Array.isArray(value.verifiedInboxKeys) &&
        value.verifiedInboxKeys.every(
          (key) => key === "j" || key === "k" || key === "e",
        ));
    const validLearnBoardId =
      value.learnBoardId === undefined ||
      value.learnBoardId === null ||
      (Number.isSafeInteger(value.learnBoardId) && value.learnBoardId > 0);
    const validTutorialInboxTargets =
      value.tutorialInboxTargets === undefined ||
      (Array.isArray(value.tutorialInboxTargets) &&
        value.tutorialInboxTargets.every(
          (target) =>
            Number.isSafeInteger(target.notificationId) &&
            target.notificationId > 0 &&
            Number.isSafeInteger(target.taskId) &&
            target.taskId > 0,
        ));
    const validArchivedInboxNotificationIds =
      value.archivedInboxNotificationIds === undefined ||
      (Array.isArray(value.archivedInboxNotificationIds) &&
        new Set(value.archivedInboxNotificationIds).size ===
          value.archivedInboxNotificationIds.length &&
        value.archivedInboxNotificationIds.every(
          (notificationId) =>
            Number.isSafeInteger(notificationId) &&
            notificationId > 0 &&
            value.tutorialInboxTargets?.some(
              (target) => target.notificationId === notificationId,
            ),
        ));
    const validLastInboxNotificationId =
      value.lastInboxNotificationId === undefined ||
      value.lastInboxNotificationId === null ||
      (Number.isSafeInteger(value.lastInboxNotificationId) &&
        value.lastInboxNotificationId > 0);
    const validLastInboxTaskId =
      value.lastInboxTaskId === undefined ||
      value.lastInboxTaskId === null ||
      (Number.isSafeInteger(value.lastInboxTaskId) &&
        value.lastInboxTaskId > 0);
    const validReturnBoardId =
      value.returnBoardId === undefined ||
      value.returnBoardId === null ||
      (Number.isSafeInteger(value.returnBoardId) && value.returnBoardId > 0);
    const validTutorialColumnId =
      value.tutorialColumnId === undefined ||
      value.tutorialColumnId === null ||
      (Number.isSafeInteger(value.tutorialColumnId) &&
        value.tutorialColumnId > 0);
    const validTutorialColumnTitle =
      value.tutorialColumnTitle === undefined ||
      value.tutorialColumnTitle === null ||
      (typeof value.tutorialColumnTitle === "string" &&
        value.tutorialColumnTitle.trim().length > 0 &&
        value.tutorialColumnTitle.length <= 120);

    if (
      value.version !== LEARN_TUTORIAL_VERSION ||
      typeof value.active !== "boolean" ||
      !validScene ||
      !validKeys ||
      !validBoardMoves ||
      !validBoardMoveOrigin ||
      !validInboxKeys ||
      !validLearnBoardId ||
      !validTutorialInboxTargets ||
      !validArchivedInboxNotificationIds ||
      !validLastInboxNotificationId ||
      !validLastInboxTaskId ||
      !validReturnBoardId ||
      !validTutorialColumnId ||
      !validTutorialColumnTitle ||
      (value.lastTaskId !== null && typeof value.lastTaskId !== "number")
    ) {
      return null;
    }

    return {
      ...(value as LearnTutorialState),
      // The foundation release ended after scene 2. Resume those sessions at
      // the first newly available act instead of falsely marking Act 1 done.
      scene:
        storedScene === "complete"
          ? "aiWriter"
          : storedScene === "actOneComplete"
            ? "assign"
            : storedScene === "actTwoComplete"
              ? "moveAcross"
              : storedScene === "actThreeComplete"
                ? "goInbox"
                : storedScene === "actFourComplete"
                  ? "boardSwitcher"
                  : value.scene!,
      verifiedBoardMoves: value.verifiedBoardMoves ?? [],
      verifiedInboxKeys: value.verifiedInboxKeys ?? [],
      boardMoveOrigin: value.boardMoveOrigin ?? null,
      learnBoardId: value.learnBoardId ?? null,
      tutorialInboxTargets: value.tutorialInboxTargets ?? [],
      archivedInboxNotificationIds: value.archivedInboxNotificationIds ?? [],
      lastInboxNotificationId: value.lastInboxNotificationId ?? null,
      lastInboxTaskId: value.lastInboxTaskId ?? null,
      returnBoardId: value.returnBoardId ?? null,
      tutorialColumnId: value.tutorialColumnId ?? null,
      tutorialColumnTitle: value.tutorialColumnTitle ?? null,
    };
  } catch {
    return null;
  }
};
