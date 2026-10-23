const { withStubs } = require("./helpers/stub-map.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const noop = async () => undefined;
const client = {
  Prisma: { join: (ids) => [...ids], PrismaClientKnownRequestError: class extends Error {} },
  Status: { Normal: "Normal", Archive: "Archive", Deleted: "Deleted" },
};
const javascript = new Map();
function load(file, stubs) {
  stubs = withStubs({ "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope }, stubs);
  if (!javascript.has(file)) javascript.set(file, ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  const mod = { exports: {} };
  vm.runInNewContext(javascript.get(file), {
    module: mod, exports: mod.exports, Date,
    console: { log() {}, warn() {}, error() {} },
    require: (id) => { assert.ok(id in stubs, `Unexpected import: ${id}`); return stubs[id]; },
  }, { filename: file });
  return mod.exports;
}

function task(id, extra = {}) {
  return { id, projectId: 1, userId: 7, status: "Normal", title: `Task ${id}`, sectionId: 3, section: "Todo", uniqueIndex: id, ticketNumber: `A-${id}`, parentTaskId: null, hardDeleteProcessingAt: null, permanentlyDeleteAt: null, ...extra };
}
function page(id, taskId = 20, extra = {}) {
  return { id, projectId: 1, taskId, parentPageId: null, archived: false, createdAt: new Date("2026-01-01"), ...extra };
}
function link(pageId, taskId, extra = {}) {
  return { id: pageId * 100 + taskId, pageId, taskId, removedAt: null, createdAt: new Date("2026-01-01"), ...extra };
}

function harness({ tasks = [task(20)], pages = [page(10)], links = [link(10, 20)], failPageWriteFor, failTaskDelete = false, failPageWriteNumber, onPageLock } = {}) {
  let state = structuredClone({ tasks, pages, links });
  const calls = [];
  const locked = new Set();
  let inTx = false;
  let pageWriteNumber = 0;
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((condition) => matches(row, condition));
      if (key === "links") {
        const edges = state.links.filter((edge) => edge.pageId === row.id);
        return "none" in value ? !edges.some((edge) => matches(edge, value.none))
          : edges.some((edge) => matches(edge, value.some));
      }
      if (key === "task") return matches(state.tasks.find((item) => item.id === row.taskId), value);
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if (value.in) return value.in.includes(row[key]);
        if (value.notIn) return row[key] != null && !value.notIn.includes(row[key]);
        if ("not" in value) return row[key] !== value.not;
        if ("lte" in value) return row[key] <= value.lte;
      }
      return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
    });
  }
  const taskModel = {
    findUnique: async ({ where, include, select }) => {
      const found = state.tasks.find((row) => matches(row, where));
      if (!found) return null;
      return { ...structuredClone(found), ...((include?.subTasks || select?.subTasks) ? { subTasks: structuredClone(state.tasks.filter((row) => row.parentTaskId === found.id)) } : {}) };
    },
    findFirst: async ({ where }) => structuredClone(state.tasks.find((row) => matches(row, where)) ?? null),
    findMany: async ({ where }) => structuredClone(state.tasks.filter((row) => matches(row, where))),
    update: async ({ where, data }) => {
      assert.ok(inTx);
      calls.push(`task-update:${where.id}`);
      const row = state.tasks.find((row) => matches(row, where));
      Object.assign(row, data);
      return structuredClone(row);
    },
    updateMany: async ({ where, data }) => {
      const rows = state.tasks.filter((row) => matches(row, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where }) => {
      assert.ok(inTx);
      calls.push("task-delete");
      if (failTaskDelete === "zero") return { count: 0 };
      if (failTaskDelete) throw new Error("Injected task deletion failure");
      const ids = state.tasks.filter((row) => matches(row, where)).map((row) => row.id);
      state.tasks = state.tasks.filter((row) => !ids.includes(row.id));
      state.links = state.links.filter((edge) => !ids.includes(edge.taskId));
      for (const row of state.pages) if (ids.includes(row.taskId)) row.taskId = null;
      return { count: ids.length };
    },
  };
  const pageModel = {
    findUnique: async ({ where }) => {
      const row = state.pages.find((row) => matches(row, where));
      if (!row) return null;
      return { ...structuredClone(row), task: state.tasks.find((t) => t.id === row.taskId) ?? null,
        _count: { links: state.links.filter((edge) => edge.pageId === row.id).length },
        links: state.links.filter((edge) => edge.pageId === row.id).map((edge) => ({ task: state.tasks.find((t) => t.id === edge.taskId) })),
        subPages: structuredClone(state.pages.filter((child) => child.parentPageId === row.id && !child.archived)),
      };
    },
    findMany: async ({ where, include, select }) => state.pages.filter((row) => matches(row, where)).map((row) => {
      const copy = structuredClone(row);
      if (include?.parentPage) copy.parentPage = structuredClone(state.pages.find((parent) => parent.id === row.parentPageId) ?? null);
      if (include?.links || select?.links) {
        const options = select?.links ?? {};
        copy.links = structuredClone(state.links.filter((edge) => edge.pageId === row.id && matches(edge, options.where))
          .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).slice(0, options.take));
      }
      return copy;
    }),
    updateMany: async ({ where, data }) => {
      assert.ok(inTx, "page changes must be inside the task transaction");
      if (++pageWriteNumber === failPageWriteNumber) throw new Error("Injected page write failure");
      if (state.tasks.find((row) => row.id === failPageWriteFor)?.projectId === 2) throw new Error("Injected page write failure");
      const rows = state.pages.filter((row) => matches(row, where));
      for (const row of rows) {
        assert.ok(locked.has(row.id), `page ${row.id} must be locked before mutation`);
        Object.assign(row, data);
      }
      calls.push("page-update");
      return { count: rows.length };
    },
    update: async ({ where, data }) => {
      assert.ok(inTx);
      assert.ok(locked.has(where.id));
      calls.push("pointer-update");
      const row = state.pages.find((row) => matches(row, where));
      Object.assign(row, data);
      return structuredClone(row);
    },
  };
  const tx = {
    task: taskModel, page: pageModel,
    pageTaskLink: { upsert: async ({ where, create, update }) => {
      assert.ok(inTx && locked.has(create.pageId));
      calls.push("materialize");
      let edge = state.links.find((edge) => matches(edge, where.pageId_taskId));
      if (!edge) { edge = { id: 10000 + state.links.length, removedAt: null, ...create }; state.links.push(edge); }
      else Object.assign(edge, update);
      return structuredClone(edge);
    } },
    project: { findUnique: async () => ({ uniqueIdentifier: "B" }) },
    section: { findFirst: async () => ({ section_title: "Todo" }) },
    taskNumberAlias: { upsert: noop }, taskSectionEvent: { create: noop },
    $executeRaw: noop,
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Page"')) {
        assert.ok(inTx);
        assert.match(sql, /ORDER BY id\s+FOR UPDATE/);
        calls.push("page-lock");
        const rows = Array.isArray(values[0])
          ? state.pages.filter((row) => values[0].includes(row.id) || values[1].includes(row.parentPageId))
          : state.pages.filter((row) => row.taskId === values[0] || state.links.some((edge) => edge.pageId === row.id && edge.taskId === values[0]));
        for (const row of rows) locked.add(row.id);
        if (onPageLock) await onPageLock(state);
        return rows.map(({ id }) => ({ id }));
      }
      if (sql.includes("WITH RECURSIVE")) {
        const ids = new Set([values[0]]);
        for (let changed = true; changed;) {
          changed = false;
          for (const row of state.tasks) if (ids.has(row.parentTaskId) && !ids.has(row.id)) { ids.add(row.id); changed = true; }
        }
        return state.tasks.filter((row) => ids.has(row.id)).map(({ id }) => ({ id }));
      }
      assert.match(sql, /FROM "Task"/);
      return structuredClone(state.tasks.filter((row) => values[0].includes(row.id)));
    },
  };
  const empty = { updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }), findMany: async () => [] };
  const prisma = {
    ...tx,
    project: { findUnique: async () => ({ teamId: "team", uniqueIdentifier: "B", owner: { uid: "guest_fixture" } }), findFirst: async () => ({ id: 2 }) },
    section: { findUnique: async () => ({ id: 3, projectId: 2, section_title: "Todo" }) },
    $transaction: async (callback) => {
      assert.equal(inTx, false);
      const snapshot = structuredClone(state);
      inTx = true;
      locked.clear();
      try { const result = await callback(tx); calls.push("commit"); return result; }
      catch (error) { state = snapshot; calls.push("rollback"); throw error; }
      finally { inTx = false; }
    },
  };
  for (const name of ["reaction", "attachment", "comment", "taskLabel", "priority", "estimate", "reminder", "drafts", "assignees", "follower", "notification", "description", "taskSharing", "taskRelations", "task_Summary", "taskReadState", "savedContent", "taskMute", "customFieldValue", "readStatus"]) prisma[name] = empty;
  const fence = { assertAgentAssignmentChangeAllowed: noop, cancelAgentMutationLeaseForHumanOverride: noop, TaskTeamScopeError: class extends Error {}, AgentMutationLeaseConflictError: class extends Error {} };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma }, "@prisma/client": client,
    "@/lib/tasks/sameBoardRelations": {},
    "@/utils/controllers/tasks/parentTaskAccess": { assertParentTaskOnBoard: noop, ParentTaskNotFoundError: class extends Error {} },
    "@/lib/telemetry/analyticsIntents": { processAnalyticsIntentSoon: noop },
    "@/lib/telemetry/activationOccurrences": { enqueueAgentTaskCompletion: noop },
    "../activities/createActivity": { default: noop, __esModule: true },
    "../activities/createTaskMovedActivity": { createTaskMovedActivityInTransaction: noop },
    "../activities/sendTaskMoveNotification": {},
    "../notifications/creation-service/createAndSendNotificationTaskMove": {},
    "../description/common-description-create": {},
    "@/pages/api/queues/FAST/generateSummary": { default: noop, __esModule: true },
    "../turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: noop, upsertAllCommentsToTurbopuffer: noop, deleteTaskInTurbopuffer: noop, deleteManyCommentsInTurbopuffer: noop, upsertPageToTurbopuffer: async (id) => { assert.equal(inTx, false); calls.push(`page-index:${id}`); } },
    "../assignees/autoAssignForSection": {},
    "@/lib/ai/labelClassifier": {}, "./spawnRecurrence": {},
    "../notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail: noop },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": fence,
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/humanMutationOverride": {
      normalizeRequestedTaskMutation: (data) => data, requestedTaskStateChanges: (_old, data) => data,
      taskLifecycleTimestampChanges: () => ({}), hasRequestedTaskStateChange: () => false,
    },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { CycleAssignmentError: class extends Error {} },
    "@/utils/controllers/notifications/broadcastInboxForTask": { broadcastInboxForTask: noop },
  };
  const single = load("src/utils/controllers/tasks/single.ts", stubs);
  const mover = load("src/utils/controllers/tasks/moveToDifferentBoard.ts", {
    "@/lib/prisma": stubs["@/lib/prisma"], "@prisma/client": client,
    "../turbopuffer/turbopufferHelper": stubs["../turbopuffer/turbopufferHelper"],
    "@/utils/controllers/getMemberAndOwnerForBoard": { __esModule: true, default: async () => [7] },
    "@/utils/generateRank": { __esModule: true, default: () => "rank" },
    "./getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 100 },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: noop, scheduleDueDateJob: noop },
    "date-fns": { subMinutes: (value) => value },
    "@/utils/controllers/tasks/single": single,
    "@/lib/api/errorMessage": { toErrorMessage: (body, fallback) => body?.message ?? fallback },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/utils/controllers/projects/getAllIncludes": stubs["@/utils/controllers/projects/getAllIncludes"],
  });
  const pageService = load("src/utils/controllers/pages/pageService.ts", {
    "@/lib/prisma": stubs["@/lib/prisma"],
    "@/utils/controllers/projects/getAllIncludes": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/utils/helperFunctions/markdownToHtml": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {}, "./htmlCanvas": {},
  });
  const deletion = load("src/utils/controllers/tasks/invokeTaskDelete.ts", stubs);
  return {
    state: () => state, calls, locked, tx,
    getPage: (id) => pageService.getPage({ id }),
    update: (data, options = {}) => single.updateTaskSingle({ id: 20, ...data }, { id: 7 }, null, { skipAutoAssign: true, ...options }),
    move: () => mover.moveTaskToDifferentBoard({ taskId: 20, currentProjectId: 1, targetProjectId: 2, targetSectionId: 3, currentUser: { id: 7 } }),
    delete: () => deletion.permanentlyDeleteTask(20, 7),
  };
}

for (const [name, pages, links, expected] of [
  ["sole link", [page(10)], [link(10, 20)], 2],
  ["two links", [page(10)], [link(10, 20), link(10, 21)], 1],
  ["foreign-board sole link", [page(10, 20, { projectId: 9 })], [link(10, 20)], 9],
  ["taskless origin sole link", [page(10, null)], [link(10, 20)], 2],
  ["archived sole link", [page(10, 20, { archived: true })], [link(10, 20)], 2],
  ["legacy insert without link", [page(10)], [], 2],
  ["existing secondary link without origin row", [page(10, 21)], [link(10, 20)], 2],
]) {
  test(`move: ${name}`, async () => {
    const h = harness({ pages, links });
    assert.equal((await h.move()).success, true);
    assert.equal(h.state().tasks[0].projectId, 2);
    assert.equal(h.state().pages[0].projectId, expected);
    assert.equal(h.calls.includes("page-index:10"), expected === 2);
    if (expected === 2) assert.ok(h.calls.indexOf("page-index:10") > h.calls.indexOf("commit"));
    assert.ok(h.calls.indexOf("task-update:20") < h.calls.indexOf("page-lock"));
    assert.ok(h.calls.indexOf("page-lock") < h.calls.indexOf("commit"));
    if (name.includes("legacy")) assert.equal(h.state().links.find((edge) => edge.taskId === pages[0].taskId).createdAt.getTime(), pages[0].createdAt.getTime());
  });
}

test("move leaves unrelated pages and all links intact", async () => {
  const links = [link(10, 20), link(11, 21)];
  const h = harness({ pages: [page(10), page(11, 21)], links });
  assert.equal((await h.move()).success, true);
  assert.deepEqual(h.state().pages.map((row) => row.projectId), [2, 1]);
  assert.deepEqual(h.state().links, links);
});

test("move detaches a moving child from a stationary parent", async () => {
  const h = harness({ pages: [page(10), page(11, 20, { parentPageId: 10 })], links: [link(10, 20), link(10, 21), link(11, 20)] });
  assert.equal((await h.move()).success, true);
  assert.deepEqual(h.state().pages.map((row) => [row.projectId, row.parentPageId]), [[1, null], [2, null]]);
  assert.ok(h.locked.has(10) && h.locked.has(11));
});

test("move detaches stationary children and keeps a moving subtree together", async () => {
  const h = harness({ pages: [page(10), page(11, 21, { parentPageId: 10 }), page(12, 20, { parentPageId: 10 })], links: [link(10, 20), link(11, 21), link(12, 20)] });
  assert.equal((await h.move()).success, true);
  assert.deepEqual(h.state().pages.map((row) => [row.projectId, row.parentPageId]), [[2, null], [1, null], [2, 10]]);
  assert.ok(h.locked.has(11), "stationary child is locked too");
});

test("root and nested subtasks use the transactional sync, including legacy links", async () => {
  const h = harness({ tasks: [task(20), task(21, { parentTaskId: 20 }), task(22, { parentTaskId: 21 })], pages: [page(10), page(11, 21), page(12, 22)], links: [] });
  assert.equal((await h.move()).success, true);
  assert.deepEqual(h.state().pages.map((row) => row.projectId), [2, 2, 2]);
  assert.equal(h.state().links.length, 3);
});

test("subtree move keeps root-ticket parent and subtask child hierarchy until both reach the destination", async () => {
  let observedSubtaskMove = false;
  const h = harness({
    tasks: [task(20), task(21, { parentTaskId: 20 })],
    pages: [page(10), page(11, 21, { parentPageId: 10 })],
    links: [link(10, 20), link(11, 21)],
    onPageLock: async (state) => {
      if (state.tasks[1].projectId === 2) {
        observedSubtaskMove = true;
        assert.equal(state.pages[1].parentPageId, 10, 'no eager per-ticket detachment');
      }
    },
  });
  assert.equal((await h.move()).success, true);
  assert.equal(observedSubtaskMove, true);
  assert.deepEqual(h.state().pages.map((row) => [row.projectId, row.parentPageId]), [[2, null], [2, 10]]);
  assert.deepEqual((await h.getPage(10)).subPages.map((child) => child.id), [11]);
  assert.equal(h.calls.filter((call) => call === "commit").length, 3, 'root, subtask, then one hierarchy cleanup');
});

test("subtree move detaches split multi-linked parent / sole-linked child and hides the child before cleanup", async () => {
  let observedBeforeCleanup = false;
  const h = harness({
    tasks: [task(20), task(21, { parentTaskId: 20 }), task(22)],
    pages: [page(10), page(11, 21, { parentPageId: 10 }), page(12, 22), page(13, 22, { parentPageId: 12, projectId: 9 })],
    links: [link(10, 20), link(10, 22), link(11, 21), link(12, 22), link(13, 22)],
    onPageLock: async (state) => {
      if (state.pages[1].projectId === 2 && state.pages[1].parentPageId === 10) {
        observedBeforeCleanup = true;
        assert.deepEqual((await h.getPage(10)).subPages, [], 'old-board reader never sees a child that moved');
      }
    },
  });
  assert.equal((await h.move()).success, true);
  assert.equal(observedBeforeCleanup, true);
  assert.deepEqual(h.state().pages.map((row) => [row.projectId, row.parentPageId]), [[1, null], [2, null], [1, null], [9, 12]]);
  assert.deepEqual((await h.getPage(10)).subPages, []);
  assert.equal(h.calls.filter((call) => call === "commit").length, 3);
});

for (const failingTaskId of [20, 21]) {
  test(`page-sync throw rolls back task ${failingTaskId} and its page`, async () => {
    const h = harness({ tasks: [task(20), task(21, { parentTaskId: 20 })], pages: [page(10), page(11, 21)], links: [], failPageWriteFor: failingTaskId });
    if (failingTaskId === 20) assert.equal((await h.move()).success, false);
    else await assert.rejects(h.move(), /Failed to update task/);
    const id = failingTaskId === 20 ? 10 : 11;
    assert.equal(h.state().tasks.find((row) => row.id === failingTaskId).projectId, 1);
    assert.equal(h.state().pages.find((row) => row.id === id).projectId, 1);
    assert.equal(h.state().links.some((edge) => edge.pageId === id), false);
    assert.ok(h.calls.includes("rollback"));
  });
}

test("page-sync write failure preserves hierarchy and rolls back board changes", async () => {
  const pages = [page(10), page(11, 21, { parentPageId: 10 })];
  const h = harness({ pages, links: [link(10, 20), link(11, 21)], failPageWriteNumber: 1 });
  assert.equal((await h.move()).success, false);
  assert.deepEqual(h.state().pages, pages);
  assert.equal(h.state().tasks[0].projectId, 1);
  assert.ok(h.calls.includes("rollback"));
});

test("post-move hierarchy cleanup failure is reported and preserves the split edge without leaking children", async () => {
  const h = harness({
    pages: [page(10), page(11, 21, { parentPageId: 10 })],
    links: [link(10, 20), link(11, 21)], failPageWriteNumber: 2,
  });
  await assert.rejects(h.move(), /Injected page write failure/);
  assert.equal(h.state().tasks[0].projectId, 2, 'the completed task/page move remains atomic');
  assert.deepEqual(h.state().pages.map((row) => [row.projectId, row.parentPageId]), [[2, null], [1, 10]]);
  assert.deepEqual((await h.getPage(10)).subPages, []);
  assert.ok(h.calls.includes("rollback"), 'cleanup failure rolls back its own transaction');
});

test("move without pages still succeeds", async () => {
  const h = harness({ pages: [], links: [] });
  assert.equal((await h.move()).success, true);
  assert.equal(h.calls.includes("page-lock"), false);
});

test("callback runs immediately after task update and a throw aborts the transaction", async () => {
  const h = harness();
  const result = await h.update({ projectId: 2 }, { allowProjectChange: true, onProjectChangedInTx: async (tx, before, after) => {
    assert.equal(tx, h.tx);
    assert.equal(h.calls.at(-1), "task-update:20");
    assert.equal(before.projectId, 1);
    assert.equal(after.projectId, 2);
    throw new Error("Injected callback failure");
  } });
  assert.equal(result.status, 500);
  assert.equal(h.state().tasks[0].projectId, 1);
});

test("same-board updates do not invoke project-change callback", async () => {
  const h = harness();
  let called = false;
  assert.equal((await h.update({ projectId: 1 }, { onProjectChangedInTx: async () => { called = true; } })).status, 200);
  assert.equal(called, false);
});

test("move rechecks links after acquiring the page lock", async () => {
  const h = harness({ onPageLock: async (state) => { if (!state.links.some((edge) => edge.pageId === 10 && edge.taskId === 21)) state.links.push(link(10, 21)); } });
  assert.equal((await h.move()).success, true);
  assert.equal(h.state().pages[0].projectId, 1);
  assert.equal(h.state().links.length, 2);
});

test("permanent delete preserves sole-linked page and its board", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" })] });
  assert.equal(await h.delete(), "success");
  assert.equal(h.state().tasks.length, 0);
  assert.equal(h.state().pages.length, 1);
  assert.equal(h.state().pages[0].taskId, null);
  assert.equal(h.state().pages[0].projectId, 1);
  assert.equal(h.state().links.length, 0);
  assert.ok(h.calls.indexOf("pointer-update") < h.calls.indexOf("task-delete"));
});

test("permanent delete promotes oldest surviving nondeleted link with deterministic tie break", async () => {
  const h = harness({
    tasks: [task(20, { status: "Deleted" }), task(21), task(22), task(23, { status: "Deleted" })],
    links: [link(10, 20), link(10, 22, { id: 102 }), link(10, 21, { id: 101 }), link(10, 23, { createdAt: new Date("2020-01-01") })],
  });
  assert.equal(await h.delete(), "success");
  assert.equal(h.state().pages[0].taskId, 21);
  assert.deepEqual(h.state().links.map((edge) => edge.taskId), [22, 21, 23]);
});

test("permanent delete prioritizes link timestamp over id and allows an archived survivor", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21), task(22, { status: "Archive" })], links: [link(10, 20), link(10, 21, { id: 1 }), link(10, 22, { id: 999, createdAt: new Date("2020-01-01") })] });
  assert.equal(await h.delete(), "success");
  assert.equal(h.state().pages[0].taskId, 22);
});

test("permanent subtree deletion never promotes another task in the deletion batch", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21, { parentTaskId: 20 }), task(22)], pages: [page(10, 21)], links: [link(10, 21), link(10, 20), link(10, 22)] });
  assert.equal(await h.delete(), "success");
  assert.deepEqual(h.state().tasks.map((row) => row.id), [22]);
  assert.equal(h.state().pages[0].taskId, 22);
});

test("deleting a secondary link leaves the legacy pointer unchanged", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21)], pages: [page(10, 21)], links: [link(10, 20), link(10, 21)] });
  assert.equal(await h.delete(), "success");
  assert.equal(h.state().pages[0].taskId, 21);
  assert.ok(h.locked.has(10));
  assert.deepEqual(h.state().links.map((edge) => edge.taskId), [21]);
});

test("task-delete throw rolls back pointer promotion and preserves links", async () => {
  const links = [link(10, 20), link(10, 21)];
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21)], links, failTaskDelete: true });
  assert.equal(await h.delete(), "error");
  assert.equal(h.state().pages[0].taskId, 20);
  assert.deepEqual(h.state().links, links);
  assert.equal(h.state().tasks.length, 2);
  assert.ok(h.calls.includes("rollback"));
});

test("lost delete claim rolls back pointer promotion", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21)], links: [link(10, 20), link(10, 21)], failTaskDelete: "zero" });
  assert.equal(await h.delete(), "error");
  assert.equal(h.state().pages[0].taskId, 20);
  assert.equal(h.state().links.length, 2);
  assert.ok(h.calls.includes("rollback"));
});

test("no live replacement leaves the surviving page taskless", async () => {
  const h = harness({ tasks: [task(20, { status: "Deleted" }), task(21, { status: "Deleted" })], links: [link(10, 20), link(10, 21)] });
  assert.equal(await h.delete(), "success");
  assert.equal(h.state().pages[0].taskId, null);
  assert.equal(h.state().pages[0].projectId, 1);
});

test("active tasks cannot be permanently deleted", async () => {
  const h = harness();
  assert.equal(await h.delete(), "skipped");
  assert.equal(h.state().pages[0].taskId, 20);
  assert.equal(h.state().tasks.length, 1);
  assert.equal(h.calls.includes("task-delete"), false);
});

function guestHarness(uid = "guest_fixture") {
  const calls = [];
  let pages = [page(10), page(11, null), page(12, null, { projectId: 9 })];
  let links = [link(10, 20)];
  const empty = { deleteMany: async () => ({ count: 0 }), updateMany: noop, findMany: async () => [] };
  const prisma = new Proxy({
    project: {
      findUnique: async () => ({ owner: { uid } }),
      deleteMany: async ({ where }) => { assert.ok(!pages.some((row) => row.projectId === where.id), "Page -> Project FK"); calls.push("project-delete"); },
    },
    task: { findMany: async () => [{ id: 20 }], deleteMany: async () => { calls.push("task-delete"); for (const row of pages) if (row.taskId === 20) row.taskId = null; } },
    page: { findMany: async ({ where }) => pages.filter((row) => row.projectId === where.projectId).map(({ id }) => ({ id })), deleteMany: async ({ where }) => { calls.push("page-delete"); const ids = pages.filter((row) => row.projectId === where.projectId).map((row) => row.id); pages = pages.filter((row) => !ids.includes(row.id)); links = links.filter((edge) => !ids.includes(edge.pageId)); } },
  }, { get: (target, key) => target[key] ?? empty });
  const cleanup = load("src/lib/demo/cleanupGuest.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { deletePageFromTurbopuffer: async (id) => { assert.ok(!pages.some((row) => row.id === id)); calls.push(`page-index-delete:${id}`); } },
    "@/lib/googleCalendar/connection": {}, "./guest": { GUEST_UID_PREFIX: "guest_" },
  });
  return { cleanup, calls, pages: () => pages, links: () => links };
}

test("guest cleanup deletes board pages, standalone pages and cascading links before project", async () => {
  const h = guestHarness();
  await h.cleanup.deleteGuestProjectCascade(1);
  assert.deepEqual(h.calls, ["page-delete", "page-index-delete:10", "page-index-delete:11", "task-delete", "project-delete"]);
  assert.deepEqual(h.pages().map((row) => row.id), [12]);
  assert.equal(h.links().length, 0);
});

test("guest cleanup refuses a non-guest before touching pages or tasks", async () => {
  const h = guestHarness("human_fixture");
  await assert.rejects(h.cleanup.deleteGuestProjectCascade(1), /non-guest project/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.pages().length, 3);
});

module.exports = { harness, task, page, link };
