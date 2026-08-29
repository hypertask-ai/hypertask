const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/staleness-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  daysSince,
  formatKanbanStalenessLine,
  stalenessLevel,
  taskStaleness,
  STALE_WARN_DAYS,
  STALE_HOT_DAYS,
} = jiti(
  path.join(root, "src/lib/staleness.ts")
);
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);
const { defaultConditions } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts")
);
const { filterCommandLists } = jiti(
  path.join(root, "src/components/Modals/FilterModals/SelectFilters/FilterOptions.ts")
);
const { getActiveStalenessFromProject, getActiveStalenessOverrideFromProject } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts")
);

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

// A task that has not moved or been discussed is the whole point of the feature:
// the age must keep growing, so a wrong sign or unit here silently hides stale work.
test("daysSince counts whole days elapsed and never goes negative", () => {
  assert.equal(daysSince(daysAgo(0)), 0);
  assert.equal(daysSince(daysAgo(9)), 9);
  assert.equal(daysSince(daysAgo(138)), 138);
  assert.equal(daysSince(new Date(Date.now() + 86_400_000)), 0);
});

test("daysSince accepts the ISO strings the API actually returns", () => {
  assert.equal(daysSince(daysAgo(21).toISOString()), 21);
});

test("daysSince is null for a task that has never been commented on", () => {
  assert.equal(daysSince(null), null);
  assert.equal(daysSince(undefined), null);
  assert.equal(daysSince("not-a-date"), null);
});

// Thresholds decide whether a card shows anything at all. If "none" leaked past
// the warn boundary, every fresh board would grow noise it never opted into.
test("stalenessLevel stays silent below the warn threshold", () => {
  assert.equal(stalenessLevel(0), "none");
  assert.equal(stalenessLevel(STALE_WARN_DAYS - 1), "none");
  assert.equal(stalenessLevel(null), "none");
});

test("stalenessLevel warns from 7 days and escalates at 20", () => {
  assert.equal(stalenessLevel(STALE_WARN_DAYS), "warn");
  assert.equal(stalenessLevel(STALE_HOT_DAYS - 1), "warn");
  assert.equal(stalenessLevel(STALE_HOT_DAYS), "hot");
  assert.equal(stalenessLevel(138), "hot");
});

test("stalenessLevel uses per-board thresholds when supplied", () => {
  const thresholds = { warnDays: 3, hotDays: 9 };
  assert.equal(stalenessLevel(2, thresholds), "none");
  assert.equal(stalenessLevel(3, thresholds), "warn");
  assert.equal(stalenessLevel(9, thresholds), "hot");
});

// Agent surfaces (MCP/CLI/API/AI chat) attach this payload to a ticket. It must
// match the board UI, or a card and an MCP fetch would disagree about staleness.
test("taskStaleness reports all three ages and the worst level", () => {
  const s = taskStaleness({
    createdAt: daysAgo(40),
    sectionChangedAt: daysAgo(9),
    lastCommentAt: daysAgo(25),
  });
  assert.equal(s.daysOnBoard, 40);
  assert.equal(s.daysInColumn, 9);
  assert.equal(s.daysSinceLastComment, 25);
  assert.equal(s.level, "hot"); // comment age (25) crosses the hot threshold
});

test("taskStaleness stays 'none' for a fresh, active task", () => {
  const s = taskStaleness({
    createdAt: daysAgo(3),
    sectionChangedAt: daysAgo(1),
    lastCommentAt: daysAgo(2),
  });
  assert.equal(s.level, "none");
});

test("taskStaleness uses per-board thresholds", () => {
  const s = taskStaleness(
    {
      createdAt: daysAgo(10),
      sectionChangedAt: daysAgo(5),
      lastCommentAt: daysAgo(2),
    },
    { warnDays: 4, hotDays: 8 },
  );
  assert.equal(s.level, "warn");
});

test("taskStaleness ages a never-commented task from creation and omits lastCommentAt", () => {
  const s = taskStaleness({ createdAt: daysAgo(30), sectionChangedAt: daysAgo(30) });
  assert.equal(s.daysSinceLastComment, 30);
  assert.equal(s.lastCommentAt, undefined);
  assert.equal(s.level, "hot");
});

test("the Kanban age line includes time on board before column age", () => {
  const s = taskStaleness({
    createdAt: daysAgo(40),
    sectionChangedAt: daysAgo(9),
    lastCommentAt: daysAgo(25),
  });
  assert.equal(
    formatKanbanStalenessLine({
      ...s,
      commentLevel: stalenessLevel(s.daysSinceLastComment),
    }),
    "40d on board · 9d in column · no comment for 25d",
  );
});

test("the Kanban age line stays hidden for fresh tasks", () => {
  const s = taskStaleness({
    createdAt: daysAgo(3),
    sectionChangedAt: daysAgo(1),
    lastCommentAt: daysAgo(2),
  });
  assert.equal(
    formatKanbanStalenessLine({
      ...s,
      commentLevel: stalenessLevel(s.daysSinceLastComment),
    }),
    null,
  );
});

test("the Kanban age line omits a fresh comment age when the column is stale", () => {
  const s = taskStaleness({
    createdAt: daysAgo(40),
    sectionChangedAt: daysAgo(9),
    lastCommentAt: daysAgo(1),
  });
  assert.equal(
    formatKanbanStalenessLine({
      ...s,
      commentLevel: stalenessLevel(s.daysSinceLastComment),
    }),
    "40d on board · 9d in column",
  );
});

const commandKeys = (options) =>
  getAllCommands(options)
    .flatMap((group) => group.commandLists)
    .map((command) => command.key);

const commandNamed = (options, key) =>
  getAllCommands(options)
    .flatMap((group) => group.commandLists)
    .find((command) => command.key === key);

// The board opt-in has no UI chrome: Ctrl+K is the only way to reach it, so a
// context-gating mistake would make the feature unreachable rather than broken.
test("staleness commands are offered on the board and on a task", () => {
  for (const context of ["Kanban", "Task"]) {
    const keys = commandKeys({ context });
    assert.ok(keys.includes("toggleStaleness"), `toggleStaleness missing in ${context}`);
    assert.ok(keys.includes("sortByTimeInColumn"), `sortByTimeInColumn missing in ${context}`);
    assert.ok(keys.includes("sortByLastComment"), `sortByLastComment missing in ${context}`);
  }
});

test("staleness commands stay out of unrelated contexts", () => {
  for (const context of ["Inbox", "Others"]) {
    const keys = commandKeys({ context });
    assert.ok(!keys.includes("toggleStaleness"), `toggleStaleness leaked into ${context}`);
  }
});

// The point of the filter is building a view of only stale work: a task that
// slips through leaves stale work invisible in exactly the view meant to find it.
test("the no-comment filter matches tasks whose last comment is old", () => {
  const match = defaultConditions.NoRecentComment;
  assert.equal(match({ lastCommentAt: daysAgo(21), createdAt: daysAgo(90) }), true);
  assert.equal(match({ lastCommentAt: daysAgo(7), createdAt: daysAgo(90) }), true);
  assert.equal(match({ lastCommentAt: daysAgo(2), createdAt: daysAgo(90) }), false);
});

// A task nobody ever commented on is the most neglected case there is, so it
// must match rather than fall through a null check.
test("the no-comment filter treats a never-commented task as aging from creation", () => {
  const match = defaultConditions.NoRecentComment;
  assert.equal(match({ lastCommentAt: null, createdAt: daysAgo(30) }), true);
  assert.equal(match({ lastCommentAt: null, createdAt: daysAgo(1) }), false);
});

test("the stuck-in-column filter matches on time in column, not comments", () => {
  const match = defaultConditions.StuckInColumn;
  assert.equal(match({ sectionChangedAt: daysAgo(34), lastCommentAt: daysAgo(0) }), true);
  assert.equal(match({ sectionChangedAt: daysAgo(1), lastCommentAt: daysAgo(60) }), false);
});

test("the stale-on-board filter matches on time since creation, not activity", () => {
  const match = defaultConditions.StaleOnBoard;
  assert.equal(match({ createdAt: daysAgo(34), sectionChangedAt: daysAgo(0), lastCommentAt: daysAgo(0) }), true);
  assert.equal(match({ createdAt: daysAgo(1), sectionChangedAt: daysAgo(60), lastCommentAt: daysAgo(60) }), false);
});

// All three filters share the card line's threshold. If they drifted apart, a board
// could show an amber card the "stale" view hides, or vice versa.
test("all staleness filters fire at exactly the threshold that shows a card age line", () => {
  assert.equal(defaultConditions.NoRecentComment({ lastCommentAt: daysAgo(STALE_WARN_DAYS) }), true);
  assert.equal(defaultConditions.NoRecentComment({ lastCommentAt: daysAgo(STALE_WARN_DAYS - 1) }), false);
  assert.equal(defaultConditions.StuckInColumn({ sectionChangedAt: daysAgo(STALE_WARN_DAYS) }), true);
  assert.equal(defaultConditions.StuckInColumn({ sectionChangedAt: daysAgo(STALE_WARN_DAYS - 1) }), false);
  assert.equal(defaultConditions.StaleOnBoard({ createdAt: daysAgo(STALE_WARN_DAYS) }), true);
  assert.equal(defaultConditions.StaleOnBoard({ createdAt: daysAgo(STALE_WARN_DAYS - 1) }), false);
});

test("staleness filters use the current board thresholds", () => {
  const project = { staleWarnDays: 12, staleHotDays: 30 };
  assert.equal(defaultConditions.NoRecentComment({ lastCommentAt: daysAgo(11) }, [], project), false);
  assert.equal(defaultConditions.NoRecentComment({ lastCommentAt: daysAgo(12) }, [], project), true);
  assert.equal(defaultConditions.StuckInColumn({ sectionChangedAt: daysAgo(11) }, [], project), false);
  assert.equal(defaultConditions.StuckInColumn({ sectionChangedAt: daysAgo(12) }, [], project), true);
  assert.equal(defaultConditions.StaleOnBoard({ createdAt: daysAgo(11) }, [], project), false);
  assert.equal(defaultConditions.StaleOnBoard({ createdAt: daysAgo(12) }, [], project), true);
});

test("not-stale requires both activity dimensions to be fresh", () => {
  const match = defaultConditions.NotStale;
  const project = { staleWarnDays: 10, staleHotDays: 30 };
  assert.equal(match({ sectionChangedAt: daysAgo(2), lastCommentAt: daysAgo(3) }, [], project), true);
  assert.equal(match({ sectionChangedAt: daysAgo(12), lastCommentAt: daysAgo(3) }, [], project), false);
  assert.equal(match({ sectionChangedAt: daysAgo(2), lastCommentAt: daysAgo(12) }, [], project), false);
});

// A filter absent from this list is unreachable: the modal renders only what is here.
test("all staleness filters are offered in the filter modal", () => {
  const byKey = Object.fromEntries(filterCommandLists.map((f) => [f.key, f]));
  assert.equal(byKey.NoRecentComment?.name, "Stale without comment");
  assert.equal(byKey.NoRecentComment?.type, "NoRecentComment");
  assert.equal(byKey.StuckInColumn?.name, "Stale in column");
  assert.equal(byKey.StuckInColumn?.type, "StuckInColumn");
  assert.equal(byKey.StaleOnBoard?.name, "Stale on board");
  assert.equal(byKey.StaleOnBoard?.type, "StaleOnBoard");
  assert.equal(byKey.NotStale?.name, "Not stale");
  assert.equal(byKey.NotStale?.type, "NotStale");
});

// Per-view staleness resolves unsaved > applied > default view > board setting.
// The chain must treat an explicit false as an answer, not fall through it:
// "this private view hides ages" is the whole feature.
const projectWith = (views, stalenessEnabled = true) => ({
  stalenessEnabled,
  project_view: {
    default_view: views.defaultView,
    user_project_views: [
      { unsavedView: views.unsaved, appliedView: views.applied },
    ],
  },
});

test("a view's explicit false wins over a board that has staleness on", () => {
  const project = projectWith({ applied: { board_staleness: false } }, true);
  assert.equal(getActiveStalenessFromProject(project), false);
});

test("a view's explicit true wins over a board that has staleness off", () => {
  const project = projectWith({ applied: { board_staleness: true } }, false);
  assert.equal(getActiveStalenessFromProject(project), true);
});

test("a view that never touched staleness inherits the board setting", () => {
  const inherit = { board_staleness: null };
  assert.equal(getActiveStalenessFromProject(projectWith({ applied: inherit }, true)), true);
  assert.equal(getActiveStalenessFromProject(projectWith({ applied: inherit }, false)), false);
  assert.equal(getActiveStalenessFromProject(projectWith({}, true)), true);
});

test("an unsaved tweak beats the applied view, which beats the default view", () => {
  const project = projectWith({
    unsaved: { board_staleness: false },
    applied: { board_staleness: true },
    defaultView: { board_staleness: true },
  }, true);
  assert.equal(getActiveStalenessFromProject(project), false);
});

// Save bodies persist the override; resolving the board default into it would
// permanently detach the view from later board-level changes.
test("the override stays null while every view inherits, even when the board is on", () => {
  assert.equal(getActiveStalenessOverrideFromProject(projectWith({}, true)), null);
  assert.equal(getActiveStalenessOverrideFromProject(projectWith({ applied: { board_staleness: false } }, true)), false);
});

test("the view toggle is offered alongside the board toggle", () => {
  for (const context of ["Kanban", "Task"]) {
    assert.ok(commandKeys({ context }).includes("toggleStalenessView"), `missing in ${context}`);
  }
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: true, stalenessViewEnabled: true } }, "toggleStalenessView").name,
    "Turn off staleness for this view"
  );
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: true, stalenessViewEnabled: false } }, "toggleStalenessView").name,
    "Turn on staleness for this view"
  );
});

// Auto-archive is reachable only through Ctrl+K; a gating mistake makes the
// feature unreachable rather than broken.
test("the auto-archive toggle is offered and names the action it will take", () => {
  for (const context of ["Kanban", "Task"]) {
    assert.ok(commandKeys({ context }).includes("toggleAutoArchive"), `missing in ${context}`);
  }
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: false, autoArchiveEnabled: false } }, "toggleAutoArchive").name,
    "Turn on auto-archive for this board (6 months idle)"
  );
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: false, autoArchiveEnabled: true } }, "toggleAutoArchive").name,
    "Turn off auto-archive for this board"
  );
});

test("the toggle names the action it will take, not the current state", () => {
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: false } }, "toggleStaleness").name,
    "Turn on staleness for this board"
  );
  assert.equal(
    commandNamed({ context: "Kanban", projectOptions: { stalenessEnabled: true } }, "toggleStaleness").name,
    "Turn off staleness for this board"
  );
});
