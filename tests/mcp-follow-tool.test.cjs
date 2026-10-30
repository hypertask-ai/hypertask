const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function fixture(options = {}) {
  const calls = [], writes = [], flags = [];
  const auth = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/utils/controllers/reports/reportService": { REPORT_CAPABILITIES: "Report capabilities" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      if (key === "my-tasks-snooze") return false;
      assert.equal(key, "htpr-8217-agent-follow-reminder");
      assert.equal(userId, auth.user.id);
      return options.flagEnabled !== false;
    } },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => auth,
      withMcpRouteMutationLease: async (_client, _actor, run) => run(),
    },
    "@/lib/prisma": { default: {} },
    "@/lib/tasks/taskTracking": { setTaskTracking: async (input) => {
      writes.push(input);
      return { status: 200, body: { taskId: input.taskId, action: input.action, following: input.action === "follow", starred: input.action === "star", remindAt: input.remindAt ?? null, reminderId: null } };
    } },
    "@/lib/mcp/operationContext": {
      getMcpExecutionContext: () => auth,
      bindMcpOperationContext: () => {},
      withMcpExecutionContext: (_token, _context, run) => run(),
    },
  };
  mocks["./auth"] = mocks["@/lib/mcp/auth"];
  mocks["./operationContext"] = mocks["@/lib/mcp/operationContext"];
  const { POST } = load("src/lib/mcp/operations/tasks/follow/operation.ts", mocks);
  mocks["./operations"] = {
    executeMcpOperation: async (request) => {
      const endpoint = request.nextUrl.pathname;
      assert.equal(endpoint, "/mcp/tasks/follow");
      calls.push({ endpoint, method: request.method, body: await request.clone().json() });
      return POST(request);
    },
  };
  const { followTaskTool: tool } = load("src/lib/mcp-server/tools/follow-task.tool.ts", mocks);
  const { selectMcpTools } = load("src/lib/mcp-server/consolidated-tools.ts", mocks);
  return { calls, writes, flags, tool, selectMcpTools };
}

test("follow tool reaches the gated operation and keeps every tracking field", async () => {
  const f = fixture({ flagEnabled: true });
  assert.equal(f.tool.name, "hypertask_follow_task");
  const receipt = JSON.parse(await f.tool.execute({ action: "remind", taskId: 42, remindAt: "2026-11-02T09:00:00Z" }, "agent-token"));
  assert.equal(receipt.success, true);
  assert.equal(receipt.action, "remind");
  assert.equal(receipt.remindAt, "2026-11-02T09:00:00Z");
  assert.equal(receipt.taskId, undefined, "the shared sanitizer drops the blacklisted taskId");
  assert.deepEqual(f.calls, [{ endpoint: "/mcp/tasks/follow", method: "POST", body: { action: "remind", taskId: 42, remindAt: "2026-11-02T09:00:00Z" } }]);
  assert.equal(f.writes.length, 1);
});

test("the parity inventory publishes the follow tool under the inbox door", () => {
  const inventory = require("../config/parity/generated-inventory.json");
  assert.ok(inventory.surfaces.mcp.includes("hypertask_follow_task"));
  assert.equal(inventory.assignments.mcp.hypertask_follow_task, "inbox.manage");
});

test("flag off: the consolidated follow action propagates the refusal without writing", async () => {
  const f = fixture({ flagEnabled: false });
  const tools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" });
  const tasks = tools.find((candidate) => candidate.name === "hypertask_tasks");
  assert.ok(tasks);
  await assert.rejects(tasks.execute({ action: "follow", input: { action: "follow", taskId: 42 } }, "agent-token"), {
    name: "NotFoundError",
    code: -32004,
    message: "Agent task tracking is not enabled",
  });
  assert.deepEqual(f.writes, []);
});

test("the follow tool refuses invalid arguments before any write", () => {
  const f = fixture();
  for (const input of [{}, { action: "follow" }, { action: "pin", taskId: 42 }, { action: "follow", taskId: "42" }, { action: "follow", taskId: 0 }, { action: "remind", taskId: 42 }, { action: "follow", taskId: 42, userId: 9 }]) {
    assert.equal(f.tool.parameters.safeParse(input).success, false, JSON.stringify(input));
  }
  assert.equal(f.tool.parameters.safeParse({ action: "follow", taskId: 42 }).success, true);
});

test("follow is a write action, hidden from read-only agents and listed with a summary", () => {
  const f = fixture();
  const readTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "read" });
  assert.equal(readTools.find((candidate) => candidate.name === "hypertask_tasks"), undefined);
  const writeTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" });
  const tasks = writeTools.find((candidate) => candidate.name === "hypertask_tasks");
  assert.ok(tasks);
  assert.equal(typeof tasks.execute, "function");
});
