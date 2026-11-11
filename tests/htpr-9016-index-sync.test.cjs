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

function drift() {
  return load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
}

test("a title edit waits for the task index before comment copies update", async () => {
  const taskWrite = deferred();
  let commentsStarted = false;
  const pending = drift().syncTaskEditSearchIndex({
    taskId: 41,
    titleChanged: true,
    upsertTask: () => taskWrite.promise,
    upsertComments: async () => { commentsStarted = true; },
  });
  await Promise.resolve();
  assert.equal(commentsStarted, false);
  taskWrite.resolve();
  await pending;
  assert.equal(commentsStarted, true);
  assert.equal(drift().commentsFollowTaskEdit({ titleChanged: false, status: "Archive" }), true);
});

test("a stale comment title is repaired and a failed reindex stays put", async () => {
  const lib = drift();
  const at = "2026-11-10T12:00:00.000Z";
  const comments = [];
  const outcome = await lib.advanceIndexDrift({
    tasks: [
      { id: 7, title: "New title", updatedAt: at, commentCount: 2 },
      { id: 8, title: "Same", updatedAt: at, commentCount: 1 },
    ],
    indexedTasks: new Map([[7, { updatedAt: at }], [8, { updatedAt: at }]]),
    indexedComments: new Map([
      [7, { taskTitle: "Old title", taskUpdatedAt: at }],
      [8, { taskTitle: "Same", taskUpdatedAt: at }],
    ]),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => {},
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, [7]);
  assert.equal(outcome.passFound, 1);
  const failed = await lib.advanceIndexDrift({
    tasks: [{ id: 3, title: "A", updatedAt: at, commentCount: 0 }],
    indexedTasks: new Map([[3, null]]),
    indexedComments: new Map(),
    batchFull: true,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => { throw new Error("index down"); },
    reindexComments: async () => {},
  });
  assert.equal(failed.stopped, true);
  assert.equal(failed.state.afterId, 0);
});

test("a deleted task stays in the drift scan", async () => {
  const gone = { id: 9, title: "Gone", updatedAt: new Date("2026-11-10T12:00:00.000Z") };
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: { task: { findMany: async (args) => (args.where && args.where.status ? [] : [gone]) }, comment: { groupBy: async () => [] } } },
    "@/lib/turbopuffer": { default: { namespace: () => ({ query: async () => ({ rows: [] }) }) }, turbopufferNamespaces: { task: { name: "tasks" }, comment: { name: "comments" } } },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const page = await repair.loadIndexDriftPage(0, 50);
  assert.equal(page.tasks[0] && page.tasks[0].id, 9);
});

test("a finished pass records one drift count for that date", async () => {
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/turbopuffer": { default: {}, turbopufferNamespaces: {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const result = await repair.runIndexDriftRepair(
    { afterId: 0, found: 2, results: [{ date: "2026-11-09", found: 4 }] },
    {
      loadPage: async () => ({ tasks: [], indexedTasks: new Map(), indexedComments: new Map(), batchFull: false }),
      reindexTask: async () => {},
      reindexComments: async () => {},
      today: () => "2026-11-10",
    },
  );
  assert.deepEqual(result.state.results, [{ date: "2026-11-09", found: 4 }, { date: "2026-11-10", found: 2 }]);
  assert.equal(result.state.afterId, 0);
});

function totalTasks(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `T${index + 1}`,
    updatedAt: "2026-11-10T12:00:00.000Z",
    commentCount: 0,
  }));
}

test("one run scans past the old 400-row budget until the pass finishes", async () => {
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/turbopuffer": { default: {}, turbopufferNamespaces: {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const tasks = totalTasks(900);
  const result = await repair.runIndexDriftRepair(
    { afterId: 0, found: 0, results: [] },
    {
      loadPage: async (afterId, take) => {
        const next = tasks.filter((task) => task.id > afterId).slice(0, take);
        return {
          tasks: next,
          indexedTasks: new Map(next.map((task) => [task.id, { updatedAt: task.updatedAt }])),
          indexedComments: new Map(),
          batchFull: next.length === take,
        };
      },
      reindexTask: async () => {},
      reindexComments: async () => {},
      today: () => "2026-11-11",
      now: () => 0,
    },
  );
  assert.equal(result.scanned, 900);
  assert.equal(result.passComplete, true);
  assert.equal(result.passFound, 0);
  assert.deepEqual(result.state.results, [{ date: "2026-11-11", found: 0 }]);
});

test("a run that runs out of time keeps its cursor for the next run", async () => {
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/turbopuffer": { default: {}, turbopufferNamespaces: {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const tasks = totalTasks(900);
  let clock = 0;
  const result = await repair.runIndexDriftRepair(
    { afterId: 0, found: 0, results: [] },
    {
      loadPage: async (afterId, take) => {
        clock += 60_000;
        const next = tasks.filter((task) => task.id > afterId).slice(0, take);
        return {
          tasks: next,
          indexedTasks: new Map(next.map((task) => [task.id, { updatedAt: task.updatedAt }])),
          indexedComments: new Map(),
          batchFull: next.length === take,
        };
      },
      reindexTask: async () => {},
      reindexComments: async () => {},
      today: () => "2026-11-11",
      now: () => clock,
    },
  );
  assert.equal(result.passComplete, false);
  assert.ok(result.scanned > 0 && result.scanned < 900);
  assert.equal(result.state.afterId, result.scanned);
  assert.deepEqual(result.state.results, []);
});

test("a pass already recorded for today is not scanned again", async () => {
  const lib = drift();
  assert.equal(lib.driftPassRecorded([{ date: "2026-11-11", found: 0 }], "2026-11-11"), true);
  assert.equal(lib.driftPassRecorded([{ date: "2026-11-10", found: 0 }], "2026-11-11"), false);
  assert.equal(lib.driftPassRecorded([], "2026-11-11"), false);
});
