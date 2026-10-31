const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const RECEIPT = (status) => ({ success: true, task: { id: 42, ticketNumber: "HTPR-42", projectId: 15, status, archivedAt: null, permanentlyDeleteAt: null } });

function fixture() {
  const calls = [];
  const auth = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/utils/controllers/reports/reportService": { REPORT_CAPABILITIES: "Report capabilities" },
    "@/lib/mcp/operationContext": {
      getMcpExecutionContext: () => auth,
      bindMcpOperationContext: () => {},
      withMcpExecutionContext: (_token, _context, run) => run(),
    },
  };
  mocks["./operationContext"] = mocks["@/lib/mcp/operationContext"];
  mocks["./auth"] = { checkMcpRateLimit: async () => null };
  mocks["./operations"] = {
    executeMcpOperation: async (request) => {
      const endpoint = request.nextUrl.pathname;
      const body = await request.clone().json();
      calls.push({ endpoint, method: request.method, body });
      return new Response(JSON.stringify(RECEIPT(endpoint.endsWith("archive") ? "Archive" : "Deleted")), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };
  const { archiveTaskTool: archive } = load("src/lib/mcp-server/tools/archive-task.tool.ts", mocks);
  const { deleteTaskTool: del } = load("src/lib/mcp-server/tools/delete-task.tool.ts", mocks);
  const { selectMcpTools } = load("src/lib/mcp-server/consolidated-tools.ts", mocks);
  return { calls, archive, delete: del, selectMcpTools };
}

test("archive and delete tools have their own names and are registered", () => {
  const f = fixture();
  assert.equal(f.archive.name, "hypertask_archive_task");
  assert.equal(f.delete.name, "hypertask_delete_task");
});

test("tools post one identifier to their own endpoint", async () => {
  const f = fixture();
  await f.archive.execute({ task_id: 42 }, "agent-token");
  await f.delete.execute({ ticket_number: "HTPR-42" }, "agent-token");
  assert.deepEqual(f.calls, [
    { endpoint: "/mcp/tasks/archive", method: "POST", body: { task_id: 42 } },
    { endpoint: "/mcp/tasks/delete", method: "POST", body: { ticket_number: "HTPR-42" } },
  ]);
});

test("tools reject missing, doubled and unknown identifiers before sending a write", async () => {
  const f = fixture();
  for (const input of [{}, { task_id: 42, ticket_number: "HTPR-42" }, { task_id: 0 }, { unique_index: 3 }, { task_id: 42, agentId: "forged" }]) {
    for (const tool of [f.archive, f.delete]) {
      assert.equal(tool.parameters.safeParse(input).success, false, JSON.stringify(input));
      await assert.rejects(tool.execute(input, "agent-token"));
    }
  }
  assert.deepEqual(f.calls, []);
});

test("consolidated archive and delete are write actions: hidden from read agents, callable by write agents", async () => {
  const f = fixture();
  const readTools = f.selectMcpTools([f.archive, f.delete], true, { agent: true, agentRole: "read" });
  assert.equal(readTools.find((tool) => tool.name === "hypertask_tasks"), undefined);
  assert.equal(readTools.find((tool) => tool.name === f.archive.name), undefined);
  assert.equal(readTools.find((tool) => tool.name === f.delete.name), undefined);
  const tasks = f.selectMcpTools([f.archive, f.delete], true, { agent: true, agentRole: "write" }).find((tool) => tool.name === "hypertask_tasks");
  assert.ok(tasks);
  assert.equal(tasks.annotations.readOnlyHint, false);
  const archived = await tasks.execute({ action: "archive", input: { task_id: 42 } }, "agent-token");
  assert.deepEqual(JSON.parse(archived).data, RECEIPT("Archive"));
  const deleted = await tasks.execute({ action: "delete", input: { task_id: 42 } }, "agent-token");
  assert.deepEqual(JSON.parse(deleted).data, RECEIPT("Deleted"));
  assert.deepEqual(f.calls.map((call) => call.endpoint), ["/mcp/tasks/archive", "/mcp/tasks/delete"]);
});

test("archive and delete are annotated as destructive writes", () => {
  const { TOOL_ANNOTATIONS } = load("src/lib/mcp-server/config/tool-annotations.ts", {});
  for (const name of ["hypertask_archive_task", "hypertask_delete_task"]) {
    assert.equal(TOOL_ANNOTATIONS[name].readOnlyHint, false, name);
    assert.equal(TOOL_ANNOTATIONS[name].destructiveHint, true, name);
  }
});
