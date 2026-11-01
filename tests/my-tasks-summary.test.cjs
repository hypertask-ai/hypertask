const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/my-tasks-summary-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getMyTasksSummary } = jiti(
  path.join(root, "src/lib/mcp/tasks/myTasksSummary.ts")
);

const NOW = new Date("2026-08-06T00:00:00.000Z");
const PAST = new Date("2026-08-01T00:00:00.000Z");
const FUTURE = new Date("2026-09-01T00:00:00.000Z");

function fakeDb({ rows = [], totals = [], overdue = [] } = {}) {
  return {
    project: {
      findMany: async () => [
        { id: 15, title: "Hypertask Product", name: "hypertask-product" },
        { id: 42, title: null, name: "vetsak-cro" },
      ],
    },
    section: {
      findMany: async () => [
        { projectId: 42, section_title: "Done", isDone: null },
        { projectId: 42, section_title: "Doing", isDone: null },
      ],
    },
    task: {
      groupBy: async ({ where }) => {
        capturedWhere.push(where);
        return where.dueDate ? overdue : totals;
      },
      findMany: async () => rows,
    },
  };
}

let capturedWhere = [];

const call = (db, options) =>
  getMyTasksSummary({ userId: 6, now: NOW, limit: 2, db, ...options });

test("totals stay exact when the returned rows are capped", async () => {
  const result = await call(
    fakeDb({
      totals: [
        { projectId: 15, _count: { _all: 160 } },
        { projectId: 42, _count: { _all: 3 } },
      ],
      overdue: [{ projectId: 42, _count: { _all: 3 } }],
      rows: [
        {
          id: 1,
          title: "Late one",
          ticketNumber: "VETS-1",
          section: "Doing",
          dueDate: PAST,
          uniqueIndex: 1,
          projectId: 42,
          priority: { Priority_Value: "High" },
        },
        {
          id: 2,
          title: "Later one",
          ticketNumber: "HTPR-2",
          section: "Doing",
          dueDate: FUTURE,
          uniqueIndex: 2,
          projectId: 15,
          priority: null,
        },
      ],
    })
  );

  assert.equal(result.success, true);
  assert.equal(result.total, 163, "reports every assigned task, not the page");
  assert.equal(result.overdue_total, 3);
  assert.equal(result.returned, 2);
  assert.equal(result.truncated, true, "a capped page must announce itself");

  assert.deepEqual(
    result.boards.map((board) => [board.board, board.total, board.overdue]),
    [
      ["vetsak-cro", 3, 3],
      ["Hypertask Product", 160, 0],
    ]
  );
  assert.equal(result.boards[0].tasks[0].overdue, true);
  assert.equal(result.boards[1].tasks[0].overdue, false);
});

test("the workload counts every task, but overdue drops Done columns", async () => {
  capturedWhere = [];
  await call(
    fakeDb({ totals: [{ projectId: 42, _count: { _all: 3 } }], overdue: [] })
  );

  const [workload, overdue] = capturedWhere;
  assert.equal(workload.NOT, undefined);
  assert.deepEqual(overdue.NOT, {
    OR: [{ projectId: 42, section: { in: ["Done"] } }],
  });
});

test("a task sitting in Done is never flagged overdue on its row", async () => {
  const result = await call(
    fakeDb({
      totals: [{ projectId: 42, _count: { _all: 1 } }],
      overdue: [],
      rows: [
        {
          id: 9,
          title: "Finished but never archived",
          ticketNumber: "VETS-9",
          section: "Done",
          dueDate: PAST,
          uniqueIndex: 9,
          projectId: 42,
          priority: null,
        },
      ],
    })
  );
  assert.equal(result.boards[0].tasks[0].overdue, false);
});

test("an unreachable board is refused rather than silently ignored", async () => {
  const result = await call(fakeDb(), { projectId: 999 });
  assert.deepEqual(result, {
    success: false,
    error: "Project not found or access denied",
  });
});

test("no assigned tasks reports zero, not a truncated empty page", async () => {
  const result = await call(fakeDb({ totals: [], overdue: [] }));
  assert.equal(result.total, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.boards, []);
});

test("the SQL page stays narrow and matches the my-tasks ordering index", async () => {
  const db = fakeDb({ totals: [{ projectId: 42, _count: { _all: 160 } }] });
  let query;
  db.task.findMany = async (args) => {
    query = args;
    return [];
  };
  await call(db, { limit: 5 });
  assert.deepEqual(query.where, {
    projectId: { in: [15, 42] },
    status: "Normal",
    deletedAt: null,
    assignees: { some: { userId: 6, agentId: null } },
  });
  assert.deepEqual(query.orderBy, [
    { dueDate: { sort: "asc", nulls: "last" } },
    { updatedAt: "desc" },
  ]);
  assert.equal(query.take, 5);
  assert.deepEqual(query.select, {
    id: true,
    title: true,
    ticketNumber: true,
    section: true,
    dueDate: true,
    uniqueIndex: true,
    projectId: true,
    priority: { select: { Priority_Value: true } },
  });
  await call(db, { limit: 1000 });
  assert.equal(query.take, 100);
  query = undefined;
  await call(db, { includeTasks: false });
  assert.equal(query, undefined);
});
