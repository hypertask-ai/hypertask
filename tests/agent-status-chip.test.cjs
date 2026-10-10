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

test("board activity broadcast is throttled to once per board per window", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/agentRuns/service.ts"), "utf8");
  const match = source.match(/export function shouldBroadcastBoardActivity[\s\S]*?\n}\n/);
  assert.ok(match);
  const fn = new Function(
    "BOARD_ACTIVITY_BROADCAST_WINDOW_MS",
    "lastBoardActivityBroadcast",
    `${ts.transpileModule(match[0].replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}; return shouldBroadcastBoardActivity;`,
  )(15_000, new Map());
  const seen = new Map();
  assert.equal(fn(1, 1000, seen), true);
  assert.equal(fn(1, 5000, seen), false);
  assert.equal(fn(2, 5000, seen), true);
  assert.equal(fn(1, 16_001, seen), true);
});
