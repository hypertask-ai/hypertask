const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

function fixture() {
  const calls = [];
  const auth = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/utils/controllers/reports/reportService": { REPORT_CAPABILITIES: "Report capabilities" },
    "@/lib/mcp/inProcessClient": {
      createInProcessMcpClient: async (token) => {
        assert.equal(token, "agent-token");
        return {
          auth,
          client: { makeRequest: async (endpoint, options) => {
            calls.push({ endpoint, method: options.method, body: JSON.parse(options.body) });
            const { taskId, userId } = JSON.parse(options.body);
            return { success: true, task: { id: taskId, waitingOnUserId: userId, waitingOnSetById: userId === null ? null : 7, waitingOnSetAt: userId === null ? null : "2026-10-24T12:00:00.000Z" } };
          } },
        };
      },
    },
    "@/lib/mcp/operationContext": {
      withMcpExecutionContext: (token, context, run) => {
        assert.equal(token, "agent-token");
        assert.equal(context, auth);
        return run();
      },
    },
  };
  const { setTaskWaitingOnTool: tool } = load("src/lib/mcp-server/tools/set-task-waiting-on.tool.ts", mocks);
  const { selectMcpTools } = load("src/lib/mcp-server/consolidated-tools.ts", mocks);
  return { calls, tool, selectMcpTools };
}

test("waiting-on tool calls the registered endpoint with the exact body and keeps all waiting-on fields", async () => {
  const f = fixture();
  assert.equal(f.tool.name, "hypertask_set_task_waiting_on");
  for (const userId of [9, null]) {
    const receipt = JSON.parse(await f.tool.execute({ taskId: 42, userId }, "agent-token"));
    assert.deepEqual(receipt, { success: true, task: { id: 42, waitingOnUserId: userId, waitingOnSetById: userId === null ? null : 7, waitingOnSetAt: userId === null ? null : "2026-10-24T12:00:00.000Z" } });
  }
  assert.deepEqual(f.calls, [9, null].map((userId) => ({ endpoint: "/mcp/tasks/waiting-on", method: "POST", body: { taskId: 42, userId } })));
  const registry = fs.readFileSync(path.join(__dirname, "../src/lib/mcp-server/tools/index.ts"), "utf8");
  assert.match(registry, /import \{ setTaskWaitingOnTool \} from '\.\/set-task-waiting-on\.tool'/);
  assert.match(registry, /^  setTaskWaitingOnTool,$/m);
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
  const readTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "read" }, true);
  assert.equal(readTools.find((tool) => tool.name === "hypertask_tasks"), undefined);
  assert.equal(readTools.find((tool) => tool.name === f.tool.name), undefined);
  const writeTools = f.selectMcpTools([f.tool], true, { agent: true, agentRole: "write" }, true);
  const tasks = writeTools.find((tool) => tool.name === "hypertask_tasks");
  assert.ok(tasks);
  assert.equal(tasks.annotations.readOnlyHint, false);
  const result = await tasks.execute({ action: "waiting_on", input: { taskId: 42, userId: 9 } }, "agent-token");
  assert.deepEqual(JSON.parse(result).data, { success: true, task: { id: 42, waitingOnUserId: 9, waitingOnSetById: 7, waitingOnSetAt: "2026-10-24T12:00:00.000Z" } });
  assert.deepEqual(f.calls, [{ endpoint: "/mcp/tasks/waiting-on", method: "POST", body: { taskId: 42, userId: 9 } }]);
});
