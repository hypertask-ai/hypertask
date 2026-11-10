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
