const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

for (const scenario of [
  { enabled: false, initializeWriterDefaults: true, priority: undefined, writes: 0, priorityIndex: undefined, estimateIndex: undefined },
  { enabled: true, initializeWriterDefaults: true, priority: undefined, writes: 2, priorityIndex: 0, estimateIndex: 0 },
  { enabled: false, initializeWriterDefaults: false, priority: { priority_index: 1, Priority_Value: "Urgent" }, writes: 1, priorityIndex: 1, estimateIndex: undefined },
  { enabled: true, initializeWriterDefaults: false, priority: { priority_index: 1, Priority_Value: "Urgent" }, writes: 1, priorityIndex: 1, estimateIndex: undefined },
]) {
  const { enabled, initializeWriterDefaults, priority } = scenario;
  test(`creation preserves supplied priority outside provisional writing: ${JSON.stringify(scenario)}`, async () => {
    const writes = [];
    let committed = false;
    const db = {
      user: { findUnique: async () => ({ id: 985 }) },
      project: { findFirst: async () => ({ id: 7049 }) },
    };
    const tx = {
      $executeRaw: async () => {},
      section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) },
      project: { findUnique: async () => ({ uniqueIdentifier: "QA" }) },
      task: { create: async ({ data }) => ({ ...data, id: 1, description_: { content: "" } }) },
      priority: { create: async ({ data }) => { assert.equal(committed, false); writes.push(["priority", data]); return data; } },
      estimate: { create: async ({ data }) => { assert.equal(committed, false); writes.push(["estimate", data]); return data; } },
      taskLabel: { findMany: async () => [] },
    };
    const { POST } = load("src/lib/api/task-writes/create-global.ts", {
      "@/lib/prisma": { default: db },
      "@/lib/flags": { isFeatureEnabled: async (key) => enabled && key === "htpr-7758-progressive-chat-create" },
      "@/lib/auth/agentScope": { recordAgentBoardScopeMiss() {} },
      "@/lib/auth/session": { verifySession: () => ({}) },
      "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
      "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
      "@/lib/ai/taskWriterDueDate": {},
      "@/lib/media/inlineAgentImages.server": {},
      "@/utils/controllers/tasks/parentTaskAccess": {},
      "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
      "@/utils/generateRank": {},
      "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, _actor, create) => {
        const value = await create(tx);
        assert.equal(writes.length, scenario.writes);
        committed = true;
        return { result: value.result, boardWebhookDeliveryIds: [] };
      } },
      "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => {} },
      "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: async () => {} },
      "@/lib/telemetry/savedWork": { creationChannelFromHeader: () => "agent" },
      "./create-global-effects": { schedulePostCreateWork() {}, createPriorityActivity: async () => {} },
      "./route": { taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session, request) },
    });
    const response = await POST({ headers: new Headers(), json: async () => ({
      projectId: 7049, title: "Initial brief", description: "", ranking: "a", initializeWriterDefaults, priority,
    }) }, { userId: 985 });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.newTask.id, 1);
    assert.equal(committed, true);
    assert.equal(result.newTask.priority?.priority_index, scenario.priorityIndex);
    assert.equal(result.newTask.estimate?.estimate_index, scenario.estimateIndex);
    assert.deepEqual(writes.map(([kind, data]) => [kind, data.taskId]),
      scenario.writes === 2 ? [["priority", 1], ["estimate", 1]] : scenario.writes === 1 ? [["priority", 1]] : []);
  });
}
