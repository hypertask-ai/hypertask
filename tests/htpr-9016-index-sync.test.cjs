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

function indexCopy(overrides) {
  return {
    taskTitle: "T",
    taskStatus: "Normal",
    taskTicketNumber: "HTPR-0",
    taskUniqueIndex: "0",
    taskProjectId: "15",
    ...overrides,
  };
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

test("a stale comment title is repaired", async () => {
  const lib = drift();
  const at = "2026-11-10T12:00:00.000Z";
  const comments = [];
  const outcome = await lib.advanceIndexDrift({
    tasks: [
      { id: 7, title: "New title", updatedAt: at, commentCount: 2, status: "Normal", ticketNumber: "HTPR-7", uniqueIndex: "7", projectId: "15" },
      { id: 8, title: "Same", updatedAt: at, commentCount: 1, status: "Normal", ticketNumber: "HTPR-8", uniqueIndex: "8", projectId: "15" },
    ],
    indexedTasks: new Map([[7, { updatedAt: at }], [8, { updatedAt: at }]]),
    indexedComments: new Map([
      [7, indexCopy({ taskTitle: "Old title", taskTicketNumber: "HTPR-7", taskUniqueIndex: "7" })],
      [8, indexCopy({ taskTitle: "Same", taskTicketNumber: "HTPR-8", taskUniqueIndex: "8" })],
    ]),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => {},
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, [7]);
  assert.equal(outcome.passFound, 1);
});

test("an edit that changes no copied label does not flag the comment copies", async () => {
  const lib = drift();
  const edited = "2026-11-11T09:00:00.000Z";
  const comments = [];
  const outcome = await lib.advanceIndexDrift({
    tasks: [{ id: 21, title: "Untouched title", updatedAt: edited, commentCount: 3, status: "Normal", ticketNumber: "HTPR-21", uniqueIndex: "21", projectId: "15" }],
    indexedTasks: new Map([[21, { updatedAt: edited }]]),
    indexedComments: new Map([[21, indexCopy({ taskTitle: "Untouched title", taskTicketNumber: "HTPR-21", taskUniqueIndex: "21" })]]),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => {},
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, []);
  assert.equal(outcome.passFound, 0);
});

test("a copied label that changed on the ticket flags the comment copies", async () => {
  const lib = drift();
  const at = "2026-11-11T09:00:00.000Z";
  const comments = [];
  await lib.advanceIndexDrift({
    tasks: [{ id: 22, title: "T22", updatedAt: at, commentCount: 1, status: "Archive", ticketNumber: "HTPR-22", uniqueIndex: "22", projectId: "15" }],
    indexedTasks: new Map([[22, { updatedAt: at }]]),
    indexedComments: new Map([[22, indexCopy({ taskTitle: "T22", taskStatus: "Normal", taskTicketNumber: "HTPR-22", taskUniqueIndex: "22" })]]),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => {},
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, [22]);
});

test("comment copies missing from the index are repaired", async () => {
  const lib = drift();
  const at = "2026-11-11T09:00:00.000Z";
  const comments = [];
  await lib.advanceIndexDrift({
    tasks: [{ id: 23, title: "T23", updatedAt: at, commentCount: 4, status: "Normal", ticketNumber: "HTPR-23", uniqueIndex: "23", projectId: "15" }],
    indexedTasks: new Map([[23, { updatedAt: at }]]),
    indexedComments: new Map([[23, null]]),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async () => {},
    reindexComments: async (id) => comments.push(id),
  });
  assert.deepEqual(comments, [23]);
});

test("a failed write names the task and the scan keeps moving", async () => {
  const lib = drift();
  const at = "2026-11-10T12:00:00.000Z";
  const outcome = await lib.advanceIndexDrift({
    tasks: [
      { id: 3, title: "A", updatedAt: at, commentCount: 0 },
      { id: 4, title: "B", updatedAt: at, commentCount: 0 },
    ],
    indexedTasks: new Map([[3, null], [4, null]]),
    indexedComments: new Map(),
    batchFull: false,
    maxReindex: 10,
    state: lib.emptyDriftState(),
    reindexTask: async (id) => { if (id === 3) throw new Error("index down"); },
    reindexComments: async () => {},
  });
  assert.equal(outcome.stopped, false);
  assert.equal(outcome.state.afterId, 4);
  assert.equal(outcome.state.found, 2);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].id, 3);
  assert.equal(outcome.failed[0].stage, "task");
  assert.equal(outcome.failed[0].message, "index down");
  assert.equal(outcome.passFound, 2);
});

test("a run stops once writes keep failing", async () => {
  const lib = drift();
  const at = "2026-11-10T12:00:00.000Z";
  const outcome = await lib.advanceIndexDrift({
    tasks: [3, 4, 5].map((id) => ({ id, title: `T${id}`, updatedAt: at, commentCount: 0 })),
    indexedTasks: new Map([[3, null], [4, null], [5, null]]),
    indexedComments: new Map(),
    batchFull: false,
    maxReindex: 10,
    maxFailures: 2,
    state: lib.emptyDriftState(),
    reindexTask: async () => { throw new Error("index down"); },
    reindexComments: async () => {},
  });
  assert.equal(outcome.stopped, true);
  assert.equal(outcome.failed.length, 2);
  assert.equal(outcome.state.afterId, 4);
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

test("the failure cap counts across pages, not per page", async () => {
  const repair = load("src/lib/search/runIndexDriftRepair.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/turbopuffer": { default: {}, turbopufferNamespaces: {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const tasks = totalTasks(400);
  let writes = 0;
  const result = await repair.runIndexDriftRepair(
    { afterId: 0, found: 0, results: [] },
    {
      loadPage: async (afterId, take) => {
        const next = tasks.filter((task) => task.id > afterId).slice(0, take);
        return {
          tasks: next,
          indexedTasks: new Map(next.map((task) => [task.id, null])),
          indexedComments: new Map(),
          batchFull: next.length === take,
        };
      },
      reindexTask: async () => { writes += 1; throw new Error("index down"); },
      reindexComments: async () => {},
      today: () => "2026-11-11",
      now: () => 0,
    },
  );
  assert.equal(result.failed.length, repair.DRIFT_MAX_FAILURES);
  assert.equal(writes, repair.DRIFT_MAX_FAILURES);
  assert.equal(result.passComplete, false);
});

function commentRow(id, projectId) {
  return {
    id: String(id),
    taskId: "1",
    commentText: "hello",
    creatorName: "Runner",
    projectId,
    createdAt: "2026-11-10T00:00:00.000Z",
    searchText: "hello",
    taskProjectId: projectId,
    taskProjectTitle: "Board",
    taskTicketNumber: "HTPR-1",
    taskTitle: "Ticket",
    taskStatus: "Normal",
    taskUpdatedAt: "2026-11-10T00:00:00.000Z",
    taskUniqueIndex: 1,
  };
}

function turbopufferHelper({ route, fetchImpl }) {
  const writes = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  process.once("beforeExit", () => { globalThis.fetch = realFetch; });
  const helper = load("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/app/api/ai/_lib/boardMemoryContract": { buildCustomInstructionSearchFilters: () => [] },
    "@/utils/controllers/search/rankHits": {
      buildSearchStatusFilter: () => null,
      parseTicketSearchQuery: () => null,
      TRASHED_STATUSES: [],
    },
    "@/lib/ai/spend/embeddingRoute": {
      embeddingSpendMode: async () => route,
      withSpendCharge: async (_route, _teamId, _texts, run) => run(),
    },
    "@/lib/turbopuffer": {
      default: {
        namespace: () => ({
          write: async (body) => { writes.push(body); return {}; },
          query: async () => ({ rows: [] }),
        }),
      },
      turbopufferNamespaces: {
        task: { name: "tasks" },
        comment: { name: "comments" },
        page: { name: "pages-v2" },
        customInstructionFile: { name: "custom-instruction-files" },
      },
    },
  });
  return { helper, writes };
}

function assertKeywordVectors(writes, dimension) {
  assert.equal(writes.length, 1, "one comment write reaches the index");
  const rows = writes[0].upsert_rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.vector.length, dimension);
    assert.equal(row.vector[0], 1);
    assert.equal(row.vector[1], 0);
    assert.equal(row.commentText, "hello");
  }
}

test("a keyword-only board writes comment rows that the index accepts", async () => {
  const { helper, writes } = turbopufferHelper({
    route: { mode: "keyword" },
    fetchImpl: async () => { throw new Error("keyword teams must not embed"); },
  });
  await helper.upsertCommentRowsToTurbopuffer([commentRow(1, 15), commentRow(2, 15)]);
  assertKeywordVectors(writes, helper.EMBEDDING_DIM);
});

test("a failed embedding still writes a row the index accepts", async () => {
  const { helper, writes } = turbopufferHelper({
    route: { mode: "customer-key", httpKey: "not-a-real-key" },
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => "bad request" }),
  });
  await helper.upsertCommentRowsToTurbopuffer([commentRow(1, 15), commentRow(2, 15)]);
  assertKeywordVectors(writes, helper.EMBEDDING_DIM);
});
