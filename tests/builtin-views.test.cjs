const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/builtin-views-jiti-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  agentsPredicate,
  blockedPredicate,
  BUILTIN_VIEWS,
  currentCyclePredicate,
  getActiveBoardViewId,
  myTasksPredicate,
  nextCyclePredicate,
  overduePredicate,
} = jiti(path.join(root, "src/lib/constants/builtinViews.ts"));

test("built-in views have stable ids in their fixed order", () => {
  assert.deepEqual(
    BUILTIN_VIEWS.map(({ id, title }) => [id, title]),
    [
      ["builtin:my-tasks", "My Tasks"],
      ["builtin:overdue", "Overdue"],
      ["builtin:blocked", "Blocked"],
      ["builtin:agents", "Agents"],
      ["builtin:current-cycle", "Current cycle"],
      ["builtin:next-cycle", "Next cycle"],
    ],
  );
});

test("My Tasks matches assignee rows for the current user", () => {
  const context = { currentUserId: 6 };
  assert.equal(
    myTasksPredicate({ assignees: [{ userId: 6, agentId: null }] }, context),
    true,
  );
  assert.equal(myTasksPredicate({ assignees: [{ userId: 7 }] }, context), false);
  assert.equal(myTasksPredicate({ assignees: [] }, {}), false);
  // An agent assignee row carries the agent's backing user id; the ticket
  // belongs to the agent, not to the person behind it (HTPR-5743).
  assert.equal(
    myTasksPredicate({ assignees: [{ userId: 6, agentId: "a1" }] }, context),
    false,
  );
  assert.equal(
    myTasksPredicate(
      { assignees: [{ userId: 6, agentId: "a1" }, { userId: 6 }] },
      context,
    ),
    true,
  );
});

test("Overdue matches Normal tasks with a due date in the past", () => {
  const context = { now: new Date("2026-08-04T12:00:00Z") };
  const past = new Date("2026-08-04T11:59:59Z");
  const future = new Date("2026-08-04T12:00:01Z");

  assert.equal(overduePredicate({ status: "Normal", dueDate: past }, context), true);
  assert.equal(overduePredicate({ status: "Normal", dueDate: future }, context), false);
  assert.equal(overduePredicate({ status: "Normal" }, context), false);
  assert.equal(overduePredicate({ status: "Archive", dueDate: past }, context), false);
  assert.equal(
    overduePredicate(
      { status: "Normal", dueDate: past, section: "Done" },
      { ...context, doneSectionTitles: new Set(["done"]) },
    ),
    false,
  );
});

test("Blocked matches waiting-on state or an open BlockedBy relation count", () => {
  assert.equal(blockedPredicate({ waitingOnUserId: 6 }, {}), true);
  assert.equal(blockedPredicate({ _count: { relatedFromTasks: 1 } }, {}), true);
  assert.equal(
    blockedPredicate({ waitingOnUserId: null, _count: { relatedFromTasks: 0 } }, {}),
    false,
  );
});

test("Agents matches any assignee row with an agent id", () => {
  assert.equal(agentsPredicate({ assignees: [{ agentId: "agent-1" }] }, {}), true);
  assert.equal(agentsPredicate({ assignees: [{ agentId: null }] }, {}), false);
  assert.equal(agentsPredicate({ assignees: [] }, {}), false);
});

test("cycle views match only their resolved cycle and hide when cycles are unavailable", () => {
  assert.equal(currentCyclePredicate({ cycleId: 11 }, { currentCycleId: 11 }), true);
  assert.equal(currentCyclePredicate({ cycleId: 12 }, { currentCycleId: 11 }), false);
  assert.equal(nextCyclePredicate({ cycleId: 12 }, { nextCycleId: 12 }), true);
  assert.equal(nextCyclePredicate({ cycleId: null }, { nextCycleId: 12 }), false);

  const current = BUILTIN_VIEWS.find(({ id }) => id === "builtin:current-cycle");
  const next = BUILTIN_VIEWS.find(({ id }) => id === "builtin:next-cycle");
  assert.equal(current.available({ cyclesEnabled: true, currentCycleId: 11 }), true);
  assert.equal(current.available({ cyclesEnabled: false, currentCycleId: 11 }), false);
  assert.equal(next.available({ cyclesEnabled: true, nextCycleId: null }), false);

  const project = {
    cycles: [
      {
        endDate: "2100-01-01",
        id: 11,
        number: 1,
        projectId: 15,
        startDate: "2000-01-01",
      },
    ],
    cyclesEnabled: true,
    id: 15,
    project_view: { default_view_id: "saved-default", user_project_views: [] },
    section: [],
  };
  assert.equal(
    getActiveBoardViewId(project, { 15: "builtin:current-cycle" }),
    "builtin:current-cycle",
  );
  project.cyclesEnabled = false;
  assert.equal(
    getActiveBoardViewId(project, { 15: "builtin:current-cycle" }),
    "saved-default",
  );
});
