const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

const load = (file, mocks = {}) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) =>
    request in mocks ? mocks[request] : require(request),
  );
  return mod.exports;
};

const NOW = Date.parse("2026-10-10T12:00:00Z");
const minutesAgo = (n) => new Date(NOW - n * 60_000);

const loadAttach = (runs) => {
  const calls = [];
  const { attachAgentStatus } = load("src/utils/controllers/tasks/attachAgentStatus.ts", {
    "@/lib/agentStatus/chip": load("src/lib/agentStatus/chip.ts"),
    "@/lib/prisma": {
      __esModule: true,
      default: { agentRun: { findMany: async (args) => (calls.push(args), runs) } },
    },
  });
  return { attachAgentStatus, calls };
};

test("one batched run query serves any number of cards, newest run per task wins", async () => {
  const { attachAgentStatus, calls } = loadAttach([
    { taskId: 2, lastActivityAt: minutesAgo(1), agent: { displayName: "RUNNER 6" } },
    { taskId: 2, lastActivityAt: minutesAgo(30), agent: { displayName: "OLD" } },
    { taskId: 1, lastActivityAt: minutesAgo(12), agent: { displayName: "RUNNER 7" } },
  ]);
  const tasks = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
  const result = await attachAgentStatus(tasks, NOW);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where.taskId.in.length, 200);
  assert.equal(calls[0].where.status, "ACTIVE");
  assert.equal(calls[0].where.lastActivityAt.gte.getTime(), NOW - 6 * 60 * 60 * 1000);
  assert.deepEqual(calls[0].orderBy, { lastActivityAt: "desc" });
  assert.deepEqual(result[1].agentStatus, { agentName: "RUNNER 6", at: minutesAgo(1).toISOString() });
  assert.equal(result[0].agentStatus.agentName, "RUNNER 7");
  assert.equal(result[2].agentStatus, null);
});

test("no active run gives a null field and an empty board runs no query", async () => {
  const { attachAgentStatus, calls } = loadAttach([]);
  assert.deepEqual(await attachAgentStatus([{ id: 5 }], NOW), [{ id: 5, agentStatus: null }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(await attachAgentStatus([], NOW), []);
  assert.equal(calls.length, 1);
});

test("getBoardTasks only attaches agent status when the flag is on for the viewer", () => {
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/projects/getBoardTasks.ts"), "utf8");
  assert.match(source, /isFeatureEnabled\(HTPR_7071_AGENT_STATUS_CHIP_FLAG, userId\)/);
  assert.match(source, /\(await agentStatusPromise\)\s*\?\s*await attachAgentStatus\(tasksWithWaitingOnUsers\)\s*:\s*tasksWithWaitingOnUsers/);
});

test("step comes from the column, blocked wins, otherwise working", () => {
  const { agentStepFor, agentStatusText } = load("src/lib/agentStatus/chip.ts");
  assert.equal(agentStepFor("In Progress"), "working");
  assert.equal(agentStepFor("AI Review"), "in review");
  assert.equal(agentStepFor("QA"), "in QA");
  assert.equal(agentStepFor("Valentin Review"), "waiting for you");
  assert.equal(agentStepFor("Blocked"), "blocked");
  assert.equal(agentStepFor("QA", ["Blocked"]), "blocked");
  assert.equal(agentStepFor("Backlog"), "working");
  assert.equal(agentStepFor(undefined), "working");
  assert.equal(
    agentStatusText("RUNNER 6", "in QA", minutesAgo(12).toISOString(), NOW),
    "RUNNER 6: in QA, 12 min ago",
  );
});

test("relative time reads just now, minutes, then hours", () => {
  const { agentStatusAgo } = load("src/lib/agentStatus/chip.ts");
  assert.equal(agentStatusAgo(minutesAgo(0).toISOString(), NOW), "just now");
  assert.equal(agentStatusAgo(minutesAgo(59).toISOString(), NOW), "59 min ago");
  assert.equal(agentStatusAgo(minutesAgo(125).toISOString(), NOW), "2 h ago");
});

const loadRefresh = () => {
  const { refreshBoardForAgentRun, shouldBroadcastBoardActivity } = load("src/lib/agentStatus/boardRefresh.ts", {
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null },
    "@/lib/flags/keys": { HTPR_7071_AGENT_STATUS_CHIP_FLAG: "HTPR-7071" },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
  });
  return { refreshBoardForAgentRun, shouldBroadcastBoardActivity };
};

const makeDeps = (candidates, throttle = () => true) => {
  const sent = [];
  return {
    sent,
    deps: {
      candidateUserIds: async () => candidates,
      broadcast: async (projectId, options) => void sent.push([projectId, options.originUserId]),
      shouldBroadcast: throttle,
    },
  };
};

test("board activity broadcast is throttled once per card per window", () => {
  const { shouldBroadcastBoardActivity: fn } = loadRefresh();
  const seen = new Map();
  assert.equal(fn(1, 10, 1000, seen), true);
  assert.equal(fn(1, 10, 5000, seen), false);
  assert.equal(fn(2, 10, 5000, seen), true);
  assert.equal(fn(1, 10, 16_001, seen), true);
});

test("card B reporting inside card A's window still broadcasts", () => {
  const { shouldBroadcastBoardActivity: fn } = loadRefresh();
  const seen = new Map();
  assert.equal(fn(1, 10, 1000, seen), true);
  assert.equal(fn(1, 11, 2000, seen), true);
  assert.equal(fn(1, 10, 3000, seen), false);
  assert.equal(fn(1, 11, 3000, seen), false);
});

test("the throttle map prunes expired cards when it grows past 500", () => {
  const { shouldBroadcastBoardActivity: fn } = loadRefresh();
  const seen = new Map();
  for (let id = 0; id < 500; id++) fn(1, id, 1000, seen);
  assert.equal(seen.size, 500);
  assert.equal(fn(1, 9999, 1000 + 15_000, seen), true);
  assert.equal(seen.size, 1);
});

test("chip hides once the last report is six hours old", () => {
  const { agentStatusIsFresh } = load("src/lib/agentStatus/chip.ts");
  const minute = Math.floor(NOW / 60_000);
  assert.equal(agentStatusIsFresh(minutesAgo(359).toISOString(), minute), true);
  assert.equal(agentStatusIsFresh(minutesAgo(360).toISOString(), minute), false);
  assert.equal(agentStatusIsFresh(minutesAgo(420).toISOString(), minute), false);
});

test("board refresh fires for OWNER_AND_QA candidates regardless of the task creator", async () => {
  const { refreshBoardForAgentRun } = loadRefresh();
  const { sent, deps } = makeDeps([6, 985]);
  assert.equal(await refreshBoardForAgentRun(9, 42, { lifecycle: false }, deps), true);
  assert.deepEqual(sent, [[9, 42]]);
  const everyone = makeDeps(null);
  assert.equal(await refreshBoardForAgentRun(9, 42, { lifecycle: false }, everyone.deps), true);
});

test("no board refresh when the flag is OFF", async () => {
  const { refreshBoardForAgentRun } = loadRefresh();
  const { sent, deps } = makeDeps([]);
  assert.equal(await refreshBoardForAgentRun(9, 42, { lifecycle: true }, deps), false);
  assert.deepEqual(sent, []);
});

test("run start and stop bypass the throttle, activity inside the window does not", async () => {
  const { refreshBoardForAgentRun } = loadRefresh();
  const { sent, deps } = makeDeps(null, () => false);
  assert.equal(await refreshBoardForAgentRun(9, 1, { lifecycle: false }, deps), false);
  assert.equal(await refreshBoardForAgentRun(9, 1, { lifecycle: true }, deps), true);
  assert.equal(await refreshBoardForAgentRun(9, 1, { lifecycle: true }, deps), true);
  assert.equal(sent.length, 2);
  const source = fs.readFileSync(path.join(root, "src/lib/agentRuns/service.ts"), "utf8");
  assert.equal((source.match(/lifecycle: true/g) ?? []).length, 2);
  assert.match(source, /refreshBoardForAgentRun\(run\.task\.projectId, originUserId, \{ lifecycle: false, taskId: run\.taskId \}\)/);
  assert.doesNotMatch(source, /setTimeout/);
});

test("the minute clock uses one interval for many subscribers and clears it at zero", () => {
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  let started = 0;
  let cleared = 0;
  global.setInterval = () => (started++, { id: started });
  global.clearInterval = () => void cleared++;
  try {
    const { subscribeMinuteClock } = load("src/lib/agentStatus/minuteClock.ts", { react: { useSyncExternalStore: () => 0 } });
    const unsubscribe = Array.from({ length: 50 }, () => subscribeMinuteClock(() => {}));
    assert.equal(started, 1);
    unsubscribe.slice(0, 49).forEach((off) => off());
    assert.equal(cleared, 0);
    unsubscribe[49]();
    assert.equal(cleared, 1);
    subscribeMinuteClock(() => {})();
    assert.equal(started, 2);
  } finally {
    global.setInterval = realSet;
    global.clearInterval = realClear;
  }
});

test("the chip only subscribes to the clock when the flag is on and the card has a status", () => {
  const source = fs.readFileSync(path.join(root, "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"), "utf8");
  assert.match(source, /useMinuteClock\(Boolean\(agentStatusEnabled && task\.agentStatus\)\)/);
});

test("the status chip shrinks and truncates long agent names inside the card", () => {
  const source = fs.readFileSync(path.join(root, "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"), "utf8");
  assert.match(source, /<LabelWrapper title=\{agentStatusLine\} className="[^"]*min-w-0[^"]*max-w-full[^"]*overflow-hidden/);
  assert.match(source, /<span className="min-w-0 truncate">\{agentStatusLine\}<\/span>/);
});
