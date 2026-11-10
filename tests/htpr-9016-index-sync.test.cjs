const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a title edit waits for the task index before comment copies update", async () => {
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const taskWrite = deferred();
  let commentsStarted = false;
  const pending = drift.syncTaskEditSearchIndex({
    taskId: 41,
    titleChanged: true,
    upsertTask: () => taskWrite.promise,
    upsertComments: async () => {
      commentsStarted = true;
    },
  });
  await Promise.resolve();
  assert.equal(commentsStarted, false);
  taskWrite.resolve();
  await pending;
  assert.equal(commentsStarted, true);
});

test("a description edit updates the task index and leaves comment copies", async () => {
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  let comments = 0;
  await drift.syncTaskEditSearchIndex({
    taskId: 41,
    titleChanged: false,
    upsertTask: async () => {},
    upsertComments: async () => {
      comments += 1;
    },
  });
  assert.equal(comments, 0);
  assert.equal(drift.commentsFollowTaskEdit({ titleChanged: false, status: "Archive" }), true);
});

test("a stale comment title is repaired and a current copy is left", async () => {
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const task = {
    id: 7,
    title: "New title",
    updatedAt: "2026-11-10T12:00:00.000Z",
    commentCount: 2,
  };
  const comments = [];
  const tasks = [];
  const outcome = await drift.advanceIndexDrift({
    tasks: [task, { ...task, id: 8, title: "Same", commentCount: 1 }],
    indexedTasks: new Map([
      [7, { updatedAt: "2026-11-10T12:00:00.000Z" }],
      [8, { updatedAt: "2026-11-10T12:00:00.000Z" }],
    ]),
    indexedComments: new Map([
      [7, { taskTitle: "Old title", taskUpdatedAt: "2026-11-10T12:00:00.000Z" }],
      [8, { taskTitle: "Same", taskUpdatedAt: "2026-11-10T12:00:00.000Z" }],
    ]),
    batchFull: false,
    maxReindex: 10,
    state: drift.emptyDriftState(),
    reindexTask: async (id) => tasks.push(id),
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, [7]);
  assert.deepEqual(tasks, []);
  assert.equal(outcome.passComplete, true);
  assert.equal(outcome.passFound, 1);
  assert.equal(outcome.state.afterId, 8);
});

test("a failed reindex stays on the same task for the next night", async () => {
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const outcome = await drift.advanceIndexDrift({
    tasks: [{ id: 3, title: "A", updatedAt: "2026-11-10T12:00:00.000Z", commentCount: 0 }],
    indexedTasks: new Map([[3, null]]),
    indexedComments: new Map(),
    batchFull: true,
    maxReindex: 10,
    state: drift.emptyDriftState(),
    reindexTask: async () => {
      throw new Error("index down");
    },
    reindexComments: async () => {},
  });
  assert.equal(outcome.stopped, true);
  assert.equal(outcome.state.afterId, 0);
  assert.equal(outcome.passComplete, false);
});

test("the drift page reads task edit times and one comment copy per task", async () => {
  const queries = [];
  const prisma = {
    task: {
      findMany: async (query) => {
        queries.push(query);
        return [{ id: 9, title: "Board", updatedAt: new Date("2026-11-10T08:00:00.000Z") }];
      },
    },
    comment: {
      groupBy: async (query) => {
        queries.push(query);
        return [{ taskId: 9, _count: { _all: 1 } }];
      },
    },
  };
  const turbopuffer = {
    namespace(name) {
      return {
        query: async (query) => {
          queries.push({ name, query });
          if (name === "tasks") return { rows: [{ id: "9", updatedAt: "2026-11-09T08:00:00.000Z" }] };
          return { rows: [{ taskTitle: "Old", taskUpdatedAt: "2026-11-09T08:00:00.000Z" }] };
        },
      };
    },
  };
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/turbopuffer": { default: turbopuffer, turbopufferNamespaces: { task: { name: "tasks" }, comment: { name: "comments" } } },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const page = await repair.loadIndexDriftPage(4, 50);
  assert.equal(page.tasks[0].commentCount, 1);
  assert.equal(page.indexedTasks.get(9).updatedAt, "2026-11-09T08:00:00.000Z");
  assert.equal(page.indexedComments.get(9).taskTitle, "Old");
  assert.deepEqual(queries[2].query.filters, ["id", "In", ["9"]]);
  assert.deepEqual(queries[3].query.filters, ["taskId", "Eq", "9"]);
  assert.equal(queries[0].where.status.not, "Deleted");
});

test("a finished pass records one drift count for that date", async () => {
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/turbopuffer": { default: {}, turbopufferNamespaces: {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const calls = [];
  const result = await repair.runIndexDriftRepair(
    { afterId: 0, found: 2, results: [{ date: "2026-11-09", found: 4 }] },
    {
      loadPage: async () => ({
        tasks: [],
        indexedTasks: new Map(),
        indexedComments: new Map(),
        batchFull: false,
      }),
      reindexTask: async (id) => calls.push(id),
      reindexComments: async (id) => calls.push(id),
      today: () => "2026-11-10",
    },
  );
  assert.equal(result.passComplete, true);
  assert.equal(result.passFound, 2);
  assert.deepEqual(result.state.results, [
    { date: "2026-11-09", found: 4 },
    { date: "2026-11-10", found: 2 },
  ]);
  assert.equal(result.state.afterId, 0);
  assert.equal(result.state.found, 0);
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const again = drift.recordDriftPass(result.state.results, "2026-11-10", 0);
  assert.deepEqual(again, [
    { date: "2026-11-09", found: 4 },
    { date: "2026-11-10", found: 0 },
  ]);
});
