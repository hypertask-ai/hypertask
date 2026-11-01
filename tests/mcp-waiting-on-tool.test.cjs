const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

function fixture(options = {}) {
  const calls = [], writes = [], flags = [];
  const auth = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/utils/controllers/reports/reportService": { REPORT_CAPABILITIES: "Report capabilities" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      assert.equal(key, "htpr-7723-task-waiting-on");
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
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => auth.user },
    "@/lib/tasks/setWaitingOn": { setTaskWaitingOn: async ({ taskId, userId, blockerCommentId }) => {
      writes.push({ taskId, ...(userId !== undefined ? { userId } : {}), ...(blockerCommentId !== undefined ? { blockerCommentId } : {}) });
      return { status: 200, body: { id: taskId, ...(blockerCommentId !== undefined ? { blockerCommentId } : {}), waitingOnUserId: userId, waitingOnSetById: userId === null ? null : 7, waitingOnSetAt: userId === null ? null : "2026-10-24T12:00:00.000Z" } };
    } },
    "@/lib/mcp/operationContext": {
      getMcpExecutionContext: (token) => {
        assert.equal(token, "agent-token");
        return auth;
      },
      bindMcpOperationContext: () => {},
      withMcpExecutionContext: (token, context, run) => {
        assert.equal(token, "agent-token");
        assert.equal(context, auth);
        return run();
      },
    },
  };
  mocks["./auth"] = mocks["@/lib/mcp/auth"];
  mocks["./operationContext"] = mocks["@/lib/mcp/operationContext"];
  const { POST } = load("src/lib/mcp/operations/tasks/waiting-on/operation.ts", mocks);
  mocks["./operations"] = {
    executeMcpOperation: async (request) => {
      const endpoint = request.nextUrl.pathname;
      assert.equal(endpoint, "/mcp/tasks/waiting-on");
      calls.push({ endpoint, method: request.method, body: await request.clone().json() });
      return POST(request);
    },
  };
  const { setTaskWaitingOnTool: tool } = load("src/lib/mcp-server/tools/set-task-waiting-on.tool.ts", mocks);
  const { selectMcpTools } = load("src/lib/mcp-server/consolidated-tools.ts", mocks);
  return { calls, writes, flags, tool, selectMcpTools };
}

test("flag on: waiting-on tool reaches the gated operation and keeps all waiting-on fields", async () => {
  const f = fixture({ flagEnabled: true });
  assert.equal(f.tool.name, "hypertask_set_task_waiting_on");
  for (const userId of [9, null]) {
    const receipt = JSON.parse(await f.tool.execute({ taskId: 42, userId }, "agent-token"));
    assert.deepEqual(receipt, { success: true, task: { id: 42, waitingOnUserId: userId, waitingOnSetById: userId === null ? null : 7, waitingOnSetAt: userId === null ? null : "2026-10-24T12:00:00.000Z" } });
  }
  assert.deepEqual(f.calls, [9, null].map((userId) => ({ endpoint: "/mcp/tasks/waiting-on", method: "POST", body: { taskId: 42, userId } })));
  assert.deepEqual(f.writes, [9, null].map((userId) => ({ taskId: 42, userId })));
  assert.deepEqual(f.flags, [9, null].map(() => ({ key: "htpr-7723-task-waiting-on", userId: 7 })));
});

test("flag off: legacy and consolidated tools propagate the operation refusal without writing", async () => {
  const f = fixture({ flagEnabled: false });
  const tools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" });
  const tasks = tools.find((tool) => tool.name === "hypertask_tasks");
  assert.ok(tasks);
  for (const userId of [9, null]) {
    const refused = { name: "NotFoundError", code: -32004, message: "Task waiting-on is not enabled" };
    await assert.rejects(f.tool.execute({ taskId: 42, userId }, "agent-token"), refused);
    await assert.rejects(tasks.execute({ action: "waiting_on", input: { taskId: 42, userId } }, "agent-token"), refused);
  }
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.flags, Array.from({ length: 4 }, () => ({ key: "htpr-7723-task-waiting-on", userId: 7 })));
  assert.deepEqual(f.writes, []);
});

test("waiting-on tool rejects invalid arguments before sending a write", async () => {
  const f = fixture();
  for (const input of [{}, { taskId: 42 }, { taskId: "42", userId: 9 }, { taskId: 42, userId: "9" }, { taskId: 42, userId: 0 }, { taskId: -1, userId: null }, { taskId: 42, userId: 2 ** 40 }, { taskId: 42, userId: 9, agentId: "forged" }]) {
    assert.equal(f.tool.parameters.safeParse(input).success, false);
    await assert.rejects(f.tool.execute(input, "agent-token"));
  }
  assert.deepEqual(f.calls, []);
});

test("consolidated waiting_on is a write action, hidden from read agents and still callable by write agents", async () => {
  const f = fixture();
  const readTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "read" });
  assert.equal(readTools.find((tool) => tool.name === "hypertask_tasks"), undefined);
  assert.equal(readTools.find((tool) => tool.name === f.tool.name), undefined);
  const writeTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" });
  const tasks = writeTools.find((tool) => tool.name === "hypertask_tasks");
  assert.ok(tasks);
  assert.equal(tasks.annotations.readOnlyHint, false);
  const result = await tasks.execute({ action: "waiting_on", input: { taskId: 42, userId: 9 } }, "agent-token");
  assert.deepEqual(JSON.parse(result).data, { success: true, task: { id: 42, waitingOnUserId: 9, waitingOnSetById: 7, waitingOnSetAt: "2026-10-24T12:00:00.000Z" } });
  assert.deepEqual(f.calls, [{ endpoint: "/mcp/tasks/waiting-on", method: "POST", body: { taskId: 42, userId: 9 } }]);
});

test("legacy and consolidated waiting-on tools transport the person and blocker comment together", async () => {
  const f = fixture();
  const tasks = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" }).find((tool) => tool.name === "hypertask_tasks");
  for (const input of [{ taskId: 42, userId: 9, blockerCommentId: 101 }, { taskId: 42, userId: null, blockerCommentId: null }]) {
    const receipt = JSON.parse(await f.tool.execute(input, "agent-token"));
    assert.equal(receipt.task.blockerCommentId, input.blockerCommentId);
    const consolidated = JSON.parse(await tasks.execute({ action: "waiting_on", input }, "agent-token"));
    assert.equal(consolidated.data.task.blockerCommentId, input.blockerCommentId);
    assert.deepEqual(f.calls.at(-1).body, input);
    assert.deepEqual(f.writes.at(-1), input);
  }
});

test("waiting-on tool validates blocker-only updates and rejects malformed comment IDs", async () => {
  const f = fixture();
  assert.deepEqual(f.tool.parameters.parse({ taskId: 42, blockerCommentId: 101 }), { taskId: 42, blockerCommentId: 101 });
  for (const blockerCommentId of ["101", 0, -1, 1.5, 2 ** 40]) {
    const input = { taskId: 42, userId: 9, blockerCommentId };
    assert.equal(f.tool.parameters.safeParse(input).success, false);
    await assert.rejects(f.tool.execute(input, "agent-token"));
  }
  assert.deepEqual(f.calls, []);
});
