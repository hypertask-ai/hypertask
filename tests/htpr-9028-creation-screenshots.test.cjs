const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const shot = "https://files.hypertask.app/tasks/attachments/screenshot.png";
const other = "https://files.hypertask.app/tasks/attachments/other.jpg";
const count = (value) => (value.match(/<img\b/g) ?? []).length;
const png = { url: shot, fileName: "Screenshot.png", mimeType: "image/png" };

test("a prose screenshot URL and a different upload stay inline when the writer omits both", async () => {
  const dom = new JSDOM("");
  const previous = { fetch: global.fetch, DOMParser: global.DOMParser };
  const saved = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers(),
    text: async () => `<h1 id="ai-generated-task-title">Compare</h1><p>Compare the layout.</p>`,
  });
  try {
    const { createComposedTask } = load("src/lib/ai/composeTask.ts", {
      axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
      "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
      "@/lib/createTaskAttachmentUploads": {
        startCreateTaskUpload: () => ({ id: "upload", promise: Promise.resolve({ url: other }) }),
        createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
      },
      "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
        saved.push(body);
        return { resposne: { newTask: { id: 91, projectId: 15, uniqueIndex: 91 } } };
      } },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
      "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
    });
    await createComposedTask({
      text: `Compare this screenshot ${shot}`,
      files: [{ name: "other.jpg", type: "image/jpeg" }],
      project: { id: 15, uniqueIdentifier: "HTPR" },
      userId: 985,
      guaranteeScreenshots: true,
    });
    assert.equal(saved.length, 1);
    assert.equal(count(saved[0].description), 2);
    assert.ok(saved[0].description.includes("screenshot.png"));
    assert.ok(saved[0].description.includes("other.jpg"));
  } finally {
    global.fetch = previous.fetch;
    global.DOMParser = previous.DOMParser;
    dom.window.close();
  }
});

test("link only still does not add a screenshot the writer left out", async () => {
  const dom = new JSDOM("");
  const previous = { fetch: global.fetch, DOMParser: global.DOMParser };
  const saved = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers(),
    text: async () => `<h1 id="ai-generated-task-title">Compare</h1><p>Compare the layout.</p>`,
  });
  try {
    const { createComposedTask } = load("src/lib/ai/composeTask.ts", {
      axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
      "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
      "@/lib/createTaskAttachmentUploads": {
        startCreateTaskUpload: () => ({ id: "upload", promise: Promise.resolve({ url: shot }) }),
        createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
      },
      "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
        saved.push(body);
        return { resposne: { newTask: { id: 91, projectId: 15, uniqueIndex: 91 } } };
      } },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
      "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
    });
    await createComposedTask({
      text: `Compare this screenshot ${shot}. Link only.`,
      files: [{ name: "Screenshot.png", type: "image/png" }],
      project: { id: 15, uniqueIdentifier: "HTPR" },
      userId: 985,
      inlineAgentImages: true,
      guaranteeScreenshots: true,
    });
    assert.equal(count(saved[0].description), 0);
  } finally {
    global.fetch = previous.fetch;
    global.DOMParser = previous.DOMParser;
    dom.window.close();
  }
});

test("without the guarantee, a writer that omits a prose URL leaves no img", async () => {
  const dom = new JSDOM("");
  const previous = { fetch: global.fetch, DOMParser: global.DOMParser };
  const saved = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers(),
    text: async () => `<h1 id="ai-generated-task-title">Compare</h1><p>Compare the layout.</p>`,
  });
  try {
    const { createComposedTask } = load("src/lib/ai/composeTask.ts", {
      axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
      "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
      "@/lib/createTaskAttachmentUploads": {
        startCreateTaskUpload: () => ({ id: "upload", promise: Promise.resolve({ url: shot }) }),
        createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
      },
      "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
        saved.push(body);
        return { resposne: { newTask: { id: 91, projectId: 15, uniqueIndex: 91 } } };
      } },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
      "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
    });
    await createComposedTask({
      text: `Compare this screenshot ${shot}`,
      files: [],
      project: { id: 15, uniqueIdentifier: "HTPR" },
      userId: 985,
    });
    assert.equal(count(saved[0].description), 0);
  } finally {
    global.fetch = previous.fetch;
    global.DOMParser = previous.DOMParser;
    dom.window.close();
  }
});

function createTool(writes, guarantee, message = "Create a task from this screenshot.") {
  const task = { id: 91, projectId: 15, userId: 985, uniqueIndex: 91, title: "Evidence", sectionId: 7 };
  const context = {
    inlineAgentImagesEnabled: true,
    bulkPreviewsIssued: new Set(),
    user: { id: 985 },
    actingAgentId: null,
    sendStatus() {},
    body: {
      message,
      images64: [png],
      attachments: [],
    },
  };
  const { createCreateTaskTool } = load("src/lib/ai/tools/createTask.ts", {
    "@/lib/errors/reportError": { reportError: async () => {} },
    ai: { tool: (definition) => definition },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/prisma": { default: {
      task: { findUnique: async () => task },
      user: { findUnique: async () => ({ id: 985 }) },
      section: { findFirst: async () => null },
    } },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HTPR", teamId: "team" } }),
      getSectionForTask: async () => ({ section: { id: 7, section_title: "Inbox" } }),
      validateParentTask: async () => ({}),
      createTask: async (payload) => { writes.push(payload.description); return task; },
    },
    "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}) },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async () => "go" },
    "@/lib/flags": { isFeatureEnabled: async (key) => guarantee && key === "htpr-9028-inline-creation-screenshots" },
    "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn, dropEmptyPadding: (value) => value, resolveTaskForTool: async () => ({ task }) },
    "@/lib/ai/tools/helpers": {
      sanitizeForJson: (value) => value, mapTaskToDetail: (value) => value, buildActivityUser: (value) => value,
    },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async () => ({ status: 200, json: task }) },
    "@/lib/realtime/server": { broadcastTaskComment() {}, broadcastBoardChange() {}, broadcastTaskChange() {} },
    "@/app/api/ai/_lib/taskWriterDraft": {},
    "@/app/api/ai/_lib/taskWriterRun": {},
    "@/utils/controllers/agents/boardMembers": {},
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [] },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": {},
    "@/utils/controllers/activities/createArchiveActivity": {},
    "@/pages/api/queues/duedateQueue": {},
    "@/utils/controllers/activities/createTaskDueDateActivity": {},
  });
  return createCreateTaskTool(context).hypertask_create_task;
}

test("sidebar create embeds an uncited screenshot on one task and not across a bulk create", async () => {
  const writes = [];
  const tool = createTool(writes, true);
  assert.equal((await tool.execute({ project_id: 15, title: "Evidence", description: "<p>Evidence</p>" })).success, true);
  assert.equal(count(writes[0]), 1);
  assert.ok(writes[0].includes("screenshot.png"));
  assert.equal((await tool.execute({ tasks: [
    { project_id: 15, title: "First", description: "<p>First</p>" },
    { project_id: 15, title: "Second", description: "<p>Second</p>" },
  ] })).success, true);
  assert.equal(count(writes[1]), 0);
  assert.equal(count(writes[2]), 0);
});

test("sidebar create leaves the screenshot out when the flag is off, the tool opts out, or the user says link only", async () => {
  const off = [];
  assert.equal((await createTool(off, false).execute({ project_id: 15, title: "Evidence", description: "<p>Evidence</p>" })).success, true);
  assert.equal(count(off[0]), 0);
  const toolOff = [];
  assert.equal((await createTool(toolOff, true).execute({ project_id: 15, title: "Evidence", description: "<p>Evidence</p>", inline_images: false })).success, true);
  assert.equal(count(toolOff[0]), 0);
  const opted = [];
  assert.equal((await createTool(opted, true, "attachment only").execute({ project_id: 15, title: "Evidence", description: "<p>Evidence</p>" })).success, true);
  assert.equal(count(opted[0]), 0);
});
