const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const ticket = { title: "Fix export failures", description: "", projectId: 7049 };

function harness(options = {}) {
  const writes = [], priority = [], estimate = [], labels = [], mutated = [], broadcasts = [];
  const stored = { title: ticket.title, description: "", projectId: ticket.projectId };
  const { createTaskUpdater } = load("src/lib/ai/tools/updateOneTask.ts", {
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/prisma": { default: {
      task: {
        findUnique: async () => options.edited
          ? { ...stored, title: "Human title", description_: { content: "" } }
          : { ...stored, description_: { content: stored.description } },
        findFirst: async () => ({ ranking: "a0" }),
      },
      user: { findUnique: async () => ({ id: 985, email: "qa@example.com", displayName: "QA 985", photoURL: null }) },
      section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) },
    } },
    "@/utils/helperFunctions/toStoredHtml": { toStoredHtml: (html) => html },
    "@/utils/generateRank": { default: () => "a1" },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (patch, _user, _agent, writeOptions) => {
      writes.push({ patch, options: writeOptions });
      if (options.edited) return { status: 409, json: { message: "This task is no longer empty. Your note is still here." } };
      if (patch.title !== undefined) stored.title = patch.title;
      if (patch.description !== undefined) stored.description = patch.description;
      return { status: 200, json: {} };
    } },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: async () => {} },
    "@/utils/controllers/activities/createArchiveActivity": { default: async () => {} },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    "@/utils/controllers/activities/createTaskDueDateActivity": { default: async () => {} },
    "@/lib/mcp/tasks/services": {
      setTaskLabels: async (...args) => labels.push(args),
      mutateTaskLabels: async (...args) => mutated.push(args),
    },
    "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}) },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(args),
      broadcastTaskChange: (...args) => broadcasts.push(args),
    },
    "@/lib/mcp/boards/links": { buildMcpTaskUrl: (projectId, uniqueIndex) => `http://localhost:3000/detail/project-${projectId}/${uniqueIndex}` },
    "@/lib/ai/tools/helpers": {
      buildActivityUser: (user) => user,
      applyPriorityUpdate: async (...args) => { priority.push(args); return {}; },
      applyEstimateUpdate: async (...args) => { estimate.push(args); return {}; },
      sanitizeForJson: (value) => value,
      mapTaskToDetail: (task) => task,
    },
  });
  const provisionalTickets = new Map([[42, { ...ticket }]]);
  const context = { user: { id: 985 }, actingAgentId: null, body: {}, provisionalTickets };
  const identifier = { task_id: 42, project_id: 7049 };
  return {
    writes, priority, estimate, labels, mutated, broadcasts, provisionalTickets,
    update: (input, expected) => createTaskUpdater(context, input, expected)(identifier, { task: { id: 42, projectId: 7049 } }),
  };
}

test("a later chat write to the ticket this reply created carries the creation guards", async () => {
  const h = harness();
  const result = await h.update({ title: "Model rewrite" });
  assert.equal(result.success, true);
  assert.deepEqual(h.writes[0].options.expectedTitle, "Fix export failures");
  assert.equal(h.writes[0].options.expectedDescription, "");
  assert.equal(h.writes[0].options.expectedProjectId, 7049);
  assert.equal(h.writes[0].options.expectedStatus, "Normal");
});

test("the human edit wins: a later chat write changes nothing and says so", async () => {
  const h = harness({ edited: true });
  const result = await h.update({ title: "Model rewrite", priority: "High", estimate: 3, add_labels: ["AI CHAT 💬"] });
  assert.equal(result.success, false);
  assert.match(result.error, /keeps their edit|edit stays/);
  assert.match(result.error, /Do not retry/);
  assert.equal(h.priority.length, 0);
  assert.equal(h.estimate.length, 0);
  assert.equal(h.mutated.length, 0);
});

test("guarded property and label writes stay conditional for a ticket this reply created", async () => {
  const h = harness();
  await h.update({ priority: "High", estimate: 3, add_labels: ["AI CHAT 💬"] });
  assert.deepEqual(h.priority[0][4], { onlyIfUnchangedDefault: true });
  assert.deepEqual(h.estimate[0][4], { onlyIfUnchangedDefault: true });
  assert.equal(h.mutated[0][2].onlyIfUnedited, true);
});

test("the guard follows the chat's own writes so the reply keeps working", async () => {
  const h = harness();
  await h.update({ title: "Writer title" });
  assert.deepEqual(h.provisionalTickets.get(42), { title: "Writer title", description: "", projectId: 7049 });
  await h.update({ title: "Writer title, part two" });
  assert.equal(h.writes[1].options.expectedTitle, "Writer title");
  assert.equal(h.writes[1].options.expectedStatus, "Normal");
});

test("an explicit guard from the caller still wins over the provisional snapshot", async () => {
  const h = harness();
  const explicit = { expectedTitle: "Caller title", expectedDescription: "", expectedProjectId: 7049, expectedStatus: "Normal" };
  await h.update({ title: "Caller title" }, explicit);
  assert.deepEqual(h.writes[0].options.expectedTitle, "Caller title");
});

test("ordinary updates to other tickets keep today's unguarded write path", async () => {
  const writes = [];
  const { createTaskUpdater } = load("src/lib/ai/tools/updateOneTask.ts", {
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/prisma": { default: {
      task: { findUnique: async () => ({ title: "Old", description_: { content: "Old body" }, projectId: 1 }), findFirst: async () => ({ ranking: "a0" }) },
      user: { findUnique: async () => ({ id: 985, email: "qa@example.com", displayName: "QA 985", photoURL: null }) },
      section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) },
    } },
    "@/utils/helperFunctions/toStoredHtml": { toStoredHtml: (html) => html },
    "@/utils/generateRank": { default: () => "a1" },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (patch, _user, _agent, writeOptions) => { writes.push(writeOptions); return { status: 200, json: {} }; } },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: async () => {} },
    "@/utils/controllers/activities/createArchiveActivity": { default: async () => {} },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    "@/utils/controllers/activities/createTaskDueDateActivity": { default: async () => {} },
    "@/lib/mcp/tasks/services": { setTaskLabels: async () => {}, mutateTaskLabels: async () => {} },
    "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}) },
    "@/lib/realtime/server": { broadcastBoardChange: () => {}, broadcastTaskChange: () => {} },
    "@/lib/mcp/boards/links": { buildMcpTaskUrl: () => "/detail/project-1/1" },
    "@/lib/ai/tools/helpers": {
      buildActivityUser: (user) => user,
      applyPriorityUpdate: async () => ({}),
      applyEstimateUpdate: async () => ({}),
      sanitizeForJson: (value) => value,
      mapTaskToDetail: (task) => task,
    },
  });
  const context = { user: { id: 985 }, actingAgentId: null, body: {}, provisionalTickets: new Map() };
  const result = await createTaskUpdater(context, { title: "New" })({ task_id: 9 }, { task: { id: 9, projectId: 1 } });
  assert.equal(result.success, true);
  assert.equal(writes[0].expectedTitle, undefined);
  assert.equal(writes[0].expectedDescription, undefined);
  assert.equal(writes[0].expectedStatus, undefined);
});
