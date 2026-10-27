const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7758-progressive-chat-create";
const draft = { success: true, title: "Writer title", html: "<p>Writer body.</p>", priority: 2, estimate: 3 };

function harness(options = {}) {
  const saved = [], updates = [], events = [], writerCalls = [];
  let release;
  const writing = new Promise((resolve) => { release = resolve; });
  const { createCreateTaskTool } = load("src/lib/ai/tools/createTask.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === flag && options.enabled !== false },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/prisma": { default: { agent: { findFirst: async () => ({ id: "agent" }) } } },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => options.denied ? { error: { message: "Access denied" } } : { project: { uniqueIdentifier: "QA", teamId: "team" } },
      getSectionForTask: async () => ({ section: { id: 7, section_title: "Inbox" } }),
      validateParentTask: async () => ({}),
      createTask: async (input) => {
        if (options.saveDenied) throw new Error("Save refused");
        const task = { ...input, id: saved.length + 1, uniqueIndex: saved.length + 1, ticketNumber: `QA-${saved.length + 1}` };
        saved.push(task);
        return task;
      },
    },
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [985] },
    "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn, dropEmptyPadding: (input) => input },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (input) => input, mapTaskToDetail: (input) => input },
    "@/lib/ai/chatStream/errors": { errorMessage: (error) => error.message },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async () => "preview" },
    "@/app/api/ai/chat/stream/bulkTools": { buildBulkOperationKey: () => "preview" },
    "@/app/api/ai/_lib/taskWriterDraft": { generateTaskWriterDraft: async (...args) => {
      await args[5]?.();
      writerCalls.push(args);
      await writing;
      if (options.writerError) throw new Error("Writer failed");
      return options.draft ?? draft;
    } },
    "@/app/api/ai/_lib/taskWriterRun": { taskWriterRequestSchema: { parse: (input) => input } },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => !options.badAgent },
    "./updateOneTask": { createTaskUpdater: (_context, input, expected) => async (identifier) => {
      updates.push({ input, expected, identifier });
      if (options.updateRefused) return { success: false, error: "Task edited" };
      const task = { ...saved.find((task) => task.id === identifier.task_id), ...input };
      return { success: true, task, url: `/detail/project-7049/${task.uniqueIndex}` };
    } },
  });
  const tool = createCreateTaskTool({
    user: { id: 985 }, actingAgentId: options.agent ? "agent" : null,
    body: {}, chatTaskWriterEnabled: true, inlineAgentImagesEnabled: options.inlineImages, sendStatus() {},
    confirmationSessionId: "session", bulkPreviewsIssued: new Set(),
    send: (event, data) => { events.push({ event, data }); return true; },
    abortSignal: options.signal,
  }).hypertask_create_task;
  return { saved, updates, events, writerCalls, release,
    execute: (input = { project_id: 7049, brief: "Fix export failures" }) => tool.execute(tool.inputSchema.parse(input)),
  };
}

async function started(h) {
  for (let i = 0; i < 20 && !h.writerCalls.length; i++) await new Promise(setImmediate);
  assert.equal(h.writerCalls.length, 1);
}

test("the tool saves one usable title and emits its link before the writer completes", async () => {
  const h = harness();
  const resultPromise = h.execute();
  await started(h);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].title, "Fix export failures");
  assert.equal(h.saved[0].description, "");
  assert.equal(h.updates.length, 0);
  assert.match(h.events.find((event) => event.event === "task_created").data.content, /href="http:\/\/localhost:3000\/detail\/project-7049\/1"/);
  h.release();
  const result = await resultPromise;
  assert.equal(result.success, true);
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.updates[0].expected, { expectedTitle: "Fix export failures", expectedDescription: "", expectedProjectId: 7049, expectedStatus: "Normal" });
  assert.equal(result.task.title, draft.title);
  assert.equal(result.task.description, draft.html);
  assert.equal(result.task.priority, "High");
  assert.equal(result.task.estimate, draft.estimate);
  assert.equal(h.writerCalls[0][0].PROMPT, "Fix export failures");
  assert.deepEqual(h.events.at(-1), { event: "task_updated", data: { taskId: 1 } });
});

for (const options of [
  { writerError: true }, { draft: { success: false, error: "No draft" } },
  { draft: { ...draft, title: "" } }, { updateRefused: true },
]) {
  test(`failed body completion retains the ticket and explicitly prevents duplicate creation: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    const pending = h.execute();
    await started(h);
    h.release();
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.task.id, 1);
    assert.equal(h.saved.length, 1);
    assert.match(result.warning, /description unfinished/);
    assert.match(result.warning, /Do not create another/);
    assert.match(h.events.at(-1).data.content, /description unfinished/);
    assert.equal(h.events.some((event) => event.event === "task_updated"), false);
  });
}

test("flag off waits for the original draft and saves its complete output unchanged", async () => {
  const h = harness({ enabled: false });
  const pending = h.execute();
  await started(h);
  assert.equal(h.saved.length, 0);
  assert.deepEqual(h.events, []);
  h.release();
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(h.saved[0].title, draft.title);
  assert.equal(h.saved[0].description, draft.html);
  assert.equal(h.saved[0].priorityIndex, draft.priority);
  assert.equal(h.saved[0].estimateIndex, draft.estimate);
  assert.equal(h.updates.length, 0);
});

for (const options of [{ denied: true }, { saveDenied: true }, { agent: true, badAgent: true }]) {
  test(`rejected creation does not emit a ticket link or spend on writing: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    const result = await h.execute();
    assert.equal(result.success, false);
    assert.equal(h.saved.length, 0);
    assert.equal(h.writerCalls.length, 0);
    assert.equal(h.events.length, 0);
  });
}

test("an unconfirmed bulk preview creates nothing", async () => {
  const h = harness();
  const result = await h.execute({ tasks: Array.from({ length: 4 }, (_, i) => ({ project_id: 7049, brief: `Task ${i}` })) });
  assert.equal(result.confirmation_required, true);
  assert.equal(h.saved.length, 0);
  assert.equal(h.writerCalls.length, 0);
  assert.equal(h.events.length, 0);
});

function updaterHarness({ conflict = false, editedProperties = false } = {}) {
  const changes = [], priorities = [], estimates = [];
  const task = { id: 1, projectId: 7049, uniqueIndex: 1, title: "Initial title", ...(editedProperties ? { priority: { priority_index: 4 }, estimate: { estimate_index: 6 } } : {}) };
  const { createTaskUpdater } = load("src/lib/ai/tools/updateOneTask.ts", {
    "@/lib/prisma": { default: {
      user: { findUnique: async () => ({ id: 985, email: "qa@example.test" }) },
      task: { findUnique: async () => task },
    } },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (patch, actor, agent, expected) => {
      changes.push({ patch, actor, agent, expected });
      return conflict ? { status: 409, json: { message: "Description was edited" } } : { status: 200 };
    } },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: async () => {} },
    "@/utils/controllers/activities/createArchiveActivity": { default: async () => {} },
    "@/pages/api/queues/duedateQueue": {},
    "@/utils/controllers/activities/createTaskDueDateActivity": { default: async () => {} },
    "@/lib/mcp/tasks/services": {},
    "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}) },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {}, broadcastTaskChange: async () => {} },
    "@/lib/ai/tools/execution": { resolveTaskForTool: async () => ({ task }) },
    "@/lib/ai/tools/helpers": {
      buildActivityUser: (user) => user, sanitizeForJson: (value) => value, mapTaskToDetail: (value) => value,
      applyPriorityUpdate: async (...args) => { priorities.push(args); return {}; },
      applyEstimateUpdate: async (...args) => { estimates.push(args); return {}; },
    },
  });
  const expected = { expectedTitle: "Initial title", expectedDescription: "", expectedProjectId: 7049, expectedStatus: "Normal" };
  return { changes, priorities, estimates, expected,
    execute: () => createTaskUpdater({ user: { id: 985 }, actingAgentId: null, body: {} }, { title: draft.title, description: draft.html, priority: "High", estimate: 3 }, expected)({ task_id: 1, project_id: 7049 }),
  };
}

test("background completion forwards all edit and target guards to the shared mutation boundary", async () => {
  const h = updaterHarness();
  assert.equal((await h.execute()).success, true);
  assert.deepEqual(h.changes[0].expected, h.expected);
  assert.equal(h.changes[0].patch.description, draft.html);
  assert.equal(h.changes[0].patch.title, draft.title);
  assert.equal(h.priorities.length, 1);
  assert.equal(h.estimates.length, 1);
});

test("a rejected body update leaves properties untouched", async () => {
  const h = updaterHarness({ conflict: true });
  assert.equal((await h.execute()).success, false);
  assert.equal(h.priorities.length, 0);
  assert.equal(h.estimates.length, 0);
});

test("background properties use atomic insert-only writes, not stale snapshots", async () => {
  const h = updaterHarness({ editedProperties: true });
  assert.equal((await h.execute()).success, true);
  assert.deepEqual(h.priorities[0][4], { onlyIfMissing: true });
  assert.deepEqual(h.estimates[0][4], { onlyIfMissing: true });
});


test("the writer retains long descriptions and explicit image settings", async () => {
  const html = `<p>${"Long output. ".repeat(2000)}</p>`;
  const h = harness({ inlineImages: true, draft: { ...draft, html } });
  const pending = h.execute({ project_id: 7049, brief: "Preserve images", image_urls: ["https://example.test/image.png"], inline_images: false });
  await started(h);
  h.release();
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(h.updates[0].input.description, html);
  assert.deepEqual(h.updates[0].input.image_urls, ["https://example.test/image.png"]);
  assert.equal(h.updates[0].input.inline_images, false);
});

for (const existing of [false, true]) {
  test(`insert-only properties preserve choices even after stale reads: existing=${existing}`, async () => {
    const rows = existing ? { priority: { priority_index: 4 }, estimate: { estimate_index: 6 } } : {};
    const upsert = (name) => async ({ create, update }) => {
      assert.deepEqual(update, {});
      rows[name] ??= create;
      return rows[name];
    };
    const empty = {};
    const { applyPriorityUpdate, applyEstimateUpdate } = load("src/lib/ai/tools/helpers.ts", {
      "@/lib/prisma": { default: {
        task: { findUnique: async () => ({ id: 1, projectId: 7049, sectionId: 7, priority: null, estimate: null }) },
        priority: { upsert: upsert("priority") }, estimate: { upsert: upsert("estimate") },
      } },
      "@/lib/mcp/agents": empty, "@/lib/auth/agentTeamScope": empty,
      "@/utils/controllers/projects/getAllIncludes": empty,
      "@/utils/controllers/activities/CreatePriorityActivity": empty,
      "@/utils/controllers/activities/createEstimateActivity": empty,
      "@/lib/mcp/tasks/mappers": empty, "@/lib/agents/publicAgent": empty,
      "@/utils/controllers/getMemberAndOwnerForBoard": empty,
      "@/lib/mcp/attachments/constants": empty,
      "@/utils/controllers/projects/views/viewsHelperAPIfunctions": empty,
      "@/utils/helperFunctions/Views/BoardFilterSanitizer": empty,
    });
    assert.deepEqual(await applyPriorityUpdate(1, "High", 985, { id: 985 }, { onlyIfMissing: true }), { error: null });
    assert.deepEqual(await applyEstimateUpdate(1, 3, 985, { id: 985 }, { onlyIfMissing: true }), { error: null });
    assert.equal(rows.priority.priority_index, existing ? 4 : 2);
    assert.equal(rows.estimate.estimate_index, existing ? 6 : 3);
  });
}
