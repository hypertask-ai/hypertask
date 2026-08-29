const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jiti = require("jiti")(__filename);

const {
  activateLearnTutorialForRequest,
  advanceLearnTutorialForPath,
  canOpenLearnTutorialTask,
  createLearnTutorialState,
  getLearnTutorialStorageKey,
  isLearnTutorialEligiblePath,
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
  shouldPreserveLearnTutorialInboxOnComment,
  startLearnTutorialMovement,
} = jiti(path.join(__dirname, "../src/lib/tutorial/learnTutorialState.ts"));

test("a tutorial query cannot activate while the tutorial is disabled", () => {
  const inactive = createLearnTutorialState(false);
  assert.equal(activateLearnTutorialForRequest(inactive, false), inactive);

  const activated = activateLearnTutorialForRequest(inactive, true);
  assert.equal(activated.active, false);
  assert.equal(activated.scene, "welcome");

  const active = startLearnTutorialMovement(activated, 10);
  assert.equal(activateLearnTutorialForRequest(active, true).active, false);
});

test("tutorial state remains scoped by user but no route is eligible", () => {
  assert.notEqual(getLearnTutorialStorageKey(6), getLearnTutorialStorageKey(7));
  assert.equal(isLearnTutorialEligiblePath("/project"), false);
  assert.equal(isLearnTutorialEligiblePath("/detail/project-15/5056"), false);
  assert.equal(isLearnTutorialEligiblePath("/inbox"), false);
  assert.equal(isLearnTutorialEligiblePath("/login"), false);
  assert.equal(isLearnTutorialEligiblePath("/verify-email"), false);
});

test("the tutorial comment keeps its later inbox exercise intact", () => {
  const state = {
    ...createLearnTutorialState(),
    lastTaskId: 10,
    scene: "commentSave",
  };
  assert.equal(shouldPreserveLearnTutorialInboxOnComment(state, 10), true);
  assert.equal(shouldPreserveLearnTutorialInboxOnComment(state, 11), false);
  assert.equal(
    shouldPreserveLearnTutorialInboxOnComment(
      { ...state, scene: "inboxTriage" },
      10,
    ),
    false,
  );
  assert.equal(
    shouldPreserveLearnTutorialInboxOnComment({ ...state, active: false }, 10),
    false,
  );
});

test("movement shortcuts count only after focus really changes", () => {
  const started = startLearnTutorialMovement(createLearnTutorialState(), 10);
  const unchanged = observeLearnTutorialTaskFocus(started, 10, "j");
  assert.equal(unchanged, started);

  const movedUpFirst = observeLearnTutorialTaskFocus(started, 9, "k");
  assert.deepEqual(movedUpFirst.verifiedMovementKeys, []);

  const movedDown = observeLearnTutorialTaskFocus(started, 11, "j");
  assert.deepEqual(movedDown.verifiedMovementKeys, ["j"]);
  assert.equal(movedDown.lastTaskId, 11);

  const movedBack = observeLearnTutorialTaskFocus(movedDown, 10, "k");
  assert.deepEqual(movedBack.verifiedMovementKeys, ["j", "k"]);
  assert.equal(canOpenLearnTutorialTask(movedBack), true);
});

test("opening a detail route completes the slice only after J and K", () => {
  const started = startLearnTutorialMovement(createLearnTutorialState(), 10);
  const onlyJ = observeLearnTutorialTaskFocus(started, 11, "j");
  assert.equal(
    advanceLearnTutorialForPath(onlyJ, "/detail/project-1/1").scene,
    "movement",
  );

  const ready = observeLearnTutorialTaskFocus(onlyJ, 10, "k");
  assert.equal(
    advanceLearnTutorialForPath(ready, "/detail/project-1/1").scene,
    "aiWriter",
  );
});

test("Act 1 advances only after the real UI opens from its shortcut", () => {
  const aiWriter = {
    ...createLearnTutorialState(),
    scene: "aiWriter",
  };
  assert.equal(
    observeLearnTutorialSurface(aiWriter, "ai-writer", true, false),
    aiWriter,
  );
  assert.equal(
    observeLearnTutorialSurface(aiWriter, "ai-writer", false, true),
    aiWriter,
  );

  const commandCenter = observeLearnTutorialSurface(
    aiWriter,
    "ai-writer",
    true,
    true,
  );
  assert.equal(commandCenter.scene, "commandCenter");

  const actTwo = observeLearnTutorialSurface(
    commandCenter,
    "command-center",
    true,
    true,
  );
  assert.equal(actTwo.scene, "assign");
});

test("Act 2 requires each real surface and a saved comment in order", () => {
  let state = { ...createLearnTutorialState(), scene: "assign" };

  assert.equal(
    observeLearnTutorialSurface(state, "assignees", true, false),
    state,
  );
  state = observeLearnTutorialSurface(state, "assignees", true, true);
  assert.equal(state.scene, "priority");

  state = observeLearnTutorialSurface(state, "priority", true, true);
  assert.equal(state.scene, "dueDate");
  state = observeLearnTutorialSurface(state, "due-date", true, true);
  assert.equal(state.scene, "dueDateTomorrow");
  state = observeLearnTutorialSurface(state, "due-date-committed", true, true);
  assert.equal(state.scene, "comment");
  state = observeLearnTutorialSurface(state, "comment-editor", true, true);
  assert.equal(state.scene, "commentSave");
  state = observeLearnTutorialSurface(state, "comment-saved", true, true);
  assert.equal(state.scene, "escape");

  assert.equal(
    observeLearnTutorialEscape(state, "/detail/project-1/1", true),
    state,
  );
  assert.equal(
    observeLearnTutorialEscape(state, "/project?id=1", false),
    state,
  );
  assert.equal(
    observeLearnTutorialEscape(state, "/project", true).scene,
    "moveAcross",
  );
  assert.equal(
    observeLearnTutorialEscape(state, "/inbox", true).scene,
    "moveAcross",
  );
});

test("Act 3 verifies real destinations and restores the task position", () => {
  let state = {
    ...createLearnTutorialState(),
    scene: "moveAcross",
    lastTaskId: 10,
  };
  const right = {
    taskId: 10,
    direction: "right",
    from: { sectionId: 100, index: 0 },
    to: { sectionId: 200, index: 0 },
  };
  assert.equal(
    observeLearnTutorialBoardMove(state, right, { sectionId: 100, index: 0 }),
    state,
  );
  state = observeLearnTutorialBoardMove(state, right, right.to);
  assert.deepEqual(state.verifiedBoardMoves, ["right"]);
  assert.deepEqual(state.boardMoveOrigin, right.from);

  const left = {
    taskId: 10,
    direction: "left",
    from: right.to,
    to: right.from,
  };
  state = observeLearnTutorialBoardMove(state, left, left.to);
  assert.equal(state.scene, "reorder");
  assert.deepEqual(state.verifiedBoardMoves, []);

  const down = {
    taskId: 10,
    direction: "down",
    from: { sectionId: 100, index: 0 },
    to: { sectionId: 100, index: 1 },
  };
  state = observeLearnTutorialBoardMove(state, down, down.to);
  assert.deepEqual(state.verifiedBoardMoves, ["down"]);

  const up = {
    taskId: 10,
    direction: "up",
    from: down.to,
    to: down.from,
  };
  state = observeLearnTutorialBoardMove(state, up, up.to);
  assert.equal(state.scene, "goInbox");
  assert.equal(state.boardMoveOrigin, null);
});

test("Act 4 touches only seeded tutorial inbox tasks in the signed-off order", () => {
  let state = {
    ...createLearnTutorialState(),
    scene: "goInbox",
    learnBoardId: 2185,
    tutorialInboxTargets: [
      { notificationId: 101, taskId: 10 },
      { notificationId: 102, taskId: 11 },
    ],
  };

  assert.equal(
    observeLearnTutorialInboxNavigation(state, "/inbox", [101]),
    state,
  );
  state = observeLearnTutorialInboxNavigation(state, "/inbox", [101, 102]);
  assert.equal(state.scene, "inboxTriage");

  assert.equal(observeLearnTutorialInboxFocus(state, "k", 0, 0), state);
  state = observeLearnTutorialInboxFocus(state, "j", 0, 1);
  assert.deepEqual(state.verifiedInboxKeys, ["j"]);
  state = observeLearnTutorialInboxFocus(state, "k", 1, 0);
  assert.deepEqual(state.verifiedInboxKeys, ["j", "k"]);

  assert.equal(
    observeLearnTutorialInboxArchive(
      state,
      { notificationId: 999, taskId: 99, source: "inbox" },
      { notificationId: 999, taskId: 99 },
    ),
    state,
  );
  state = observeLearnTutorialInboxArchive(
    state,
    { notificationId: 101, taskId: 10, source: "inbox" },
    { notificationId: 101, taskId: 10 },
  );
  assert.equal(state.scene, "openInboxTask");
  assert.deepEqual(state.verifiedInboxKeys, ["j", "k", "e"]);
  assert.deepEqual(state.archivedInboxNotificationIds, [101]);

  state = observeLearnTutorialInboxTaskOpen(state, "/detail/project-2185/2", {
    notificationId: 102,
    taskId: 11,
  });
  assert.equal(state.scene, "inboxTaskArchive");
  assert.equal(state.lastInboxNotificationId, 102);
  assert.equal(state.lastInboxTaskId, 11);

  assert.equal(
    observeLearnTutorialInboxArchive(
      state,
      { notificationId: 102, taskId: 11, source: "inbox" },
      { notificationId: 102, taskId: 11 },
    ),
    state,
  );
  state = observeLearnTutorialInboxArchive(
    state,
    { notificationId: 102, taskId: 11, source: "detail" },
    { notificationId: 102, taskId: 11 },
  );
  assert.equal(state.scene, "inboxZero");
  assert.deepEqual(state.archivedInboxNotificationIds, [101, 102]);
  assert.equal(
    observeLearnTutorialInboxZero(state, "/inbox", false, []),
    state,
  );
  assert.equal(
    observeLearnTutorialInboxZero(state, "/inbox", true, []).scene,
    "boardSwitcher",
  );
});

test("Act 5 requires real surfaces and exact persisted column mutations", () => {
  let state = {
    ...createLearnTutorialState(),
    scene: "boardSwitcher",
    learnBoardId: 2185,
    lastTaskId: 10,
    returnBoardId: 15,
    tutorialColumnTitle: "Ready to ship 3",
  };

  assert.equal(
    observeLearnTutorialSurface(state, "board-switcher", true, false),
    state,
  );
  state = observeLearnTutorialSurface(
    state,
    "board-switcher",
    true,
    true,
  );
  assert.equal(state.scene, "addColumnCommand");
  state = observeLearnTutorialSurface(state, "command-center", true, true);
  assert.equal(state.scene, "addColumnSearch");
  state = observeLearnTutorialSurface(state, "add-column", true, true);
  assert.equal(state.scene, "addColumnName");

  assert.equal(
    observeLearnTutorialColumnCreated(state, {
      columnId: 300,
      projectId: 2185,
      title: "Wrong title",
    }),
    state,
  );
  state = observeLearnTutorialColumnCreated(state, {
    columnId: 300,
    projectId: 2185,
    title: "Ready to ship 3",
  });
  assert.equal(state.scene, "moveTaskCommand");
  assert.equal(state.tutorialColumnId, 300);

  state = observeLearnTutorialSurface(state, "move-to-column", true, true);
  assert.equal(state.scene, "moveTaskPick");
  assert.equal(
    observeLearnTutorialColumnMove(state, {
      fromSectionId: 100,
      projectId: 2185,
      taskId: 11,
      toSectionId: 300,
      title: "Ready to ship 3",
    }),
    state,
  );
  state = observeLearnTutorialColumnMove(state, {
    fromSectionId: 100,
    projectId: 2185,
    taskId: 10,
    toSectionId: 300,
    title: "Ready to ship 3",
  });
  assert.equal(state.scene, "shortcutsRecap");
  state = observeLearnTutorialSurface(
    state,
    "keyboard-shortcuts",
    true,
    true,
  );
  assert.equal(state.scene, "finale");
});

test("stored progress rejects stale and malformed payloads", () => {
  const state = createLearnTutorialState();
  assert.deepEqual(parseLearnTutorialState(JSON.stringify(state)), state);
  assert.equal(parseLearnTutorialState('{"version":0}'), null);
  assert.equal(parseLearnTutorialState("not json"), null);
});

test("foundation completion resumes at the first Act 1 scene", () => {
  const foundationState = {
    ...createLearnTutorialState(),
    scene: "complete",
    verifiedMovementKeys: ["j", "k"],
    lastTaskId: 10,
  };
  assert.equal(
    parseLearnTutorialState(JSON.stringify(foundationState)).scene,
    "aiWriter",
  );
});

test("Act 1 completion resumes at assignment", () => {
  const actOneState = {
    ...createLearnTutorialState(),
    scene: "actOneComplete",
    verifiedMovementKeys: ["j", "k"],
    lastTaskId: 10,
  };
  assert.equal(
    parseLearnTutorialState(JSON.stringify(actOneState)).scene,
    "assign",
  );
});

test("Act 2 completion resumes at the first Act 3 move", () => {
  const actTwoState = {
    version: 1,
    active: true,
    scene: "actTwoComplete",
    verifiedMovementKeys: ["j", "k"],
    lastTaskId: 10,
  };
  const parsed = parseLearnTutorialState(JSON.stringify(actTwoState));
  assert.equal(parsed.scene, "moveAcross");
  assert.deepEqual(parsed.verifiedBoardMoves, []);
  assert.equal(parsed.boardMoveOrigin, null);
});

test("Act 3 completion resumes at inbox navigation with backward-compatible defaults", () => {
  const actThreeState = {
    version: 1,
    active: true,
    scene: "actThreeComplete",
    verifiedMovementKeys: ["j", "k"],
    verifiedBoardMoves: [],
    boardMoveOrigin: null,
    lastTaskId: 10,
  };
  const parsed = parseLearnTutorialState(JSON.stringify(actThreeState));
  assert.equal(parsed.scene, "goInbox");
  assert.deepEqual(parsed.verifiedInboxKeys, []);
  assert.deepEqual(parsed.tutorialInboxTargets, []);
  assert.equal(parsed.learnBoardId, null);
});

test("Act 4 completion resumes at the board switcher with Act 5 defaults", () => {
  const actFourState = {
    version: 1,
    active: true,
    scene: "actFourComplete",
    verifiedMovementKeys: ["j", "k"],
    verifiedBoardMoves: [],
    verifiedInboxKeys: ["j", "k", "e"],
    boardMoveOrigin: null,
    learnBoardId: 2185,
    tutorialInboxTargets: [
      { notificationId: 101, taskId: 10 },
      { notificationId: 102, taskId: 11 },
    ],
    archivedInboxNotificationIds: [101, 102],
    lastInboxNotificationId: 102,
    lastInboxTaskId: 11,
    lastTaskId: 10,
  };
  const parsed = parseLearnTutorialState(JSON.stringify(actFourState));
  assert.equal(parsed.scene, "boardSwitcher");
  assert.equal(parsed.returnBoardId, null);
  assert.equal(parsed.tutorialColumnId, null);
  assert.equal(parsed.tutorialColumnTitle, null);
});
