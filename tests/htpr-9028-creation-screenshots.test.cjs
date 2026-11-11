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

const base64Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function createTool(writes, guarantee, message = "Create a task from this screenshot.", images = [png]) {
  const task = { id: 91, projectId: 15, userId: 985, uniqueIndex: 91, title: "Evidence", sectionId: 7 };
  const context = {
    inlineAgentImagesEnabled: true,
    bulkPreviewsIssued: new Set(),
    creationScreenshotsUsed: new Set(),
    user: { id: 985 },
    actingAgentId: null,
    sendStatus() {},
    body: {
      message,
      images64: images,
      attachments: [],
    },
  };
  const { createCreateTaskTool } = load("src/lib/ai/tools/createTask.ts", {
    "@/lib/errors/reportError": { reportError: async () => {} },
    ai: { tool: (definition) => definition },
    "@/lib/media/inlineAgentImages.server": {
      inlineAgentImagesForUser: async (html) => html,
      hostInlineScreenshots: async (files) => files.map((file) => (file.url.startsWith("data:") ? { ...file, url: shot, fileName: "screenshot.png", mimeType: "image/png" } : file)),
    },
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
  assert.equal((await tool.execute({ project_id: 15, title: "Second call", description: "<p>Second</p>" })).success, true);
  assert.equal(count(writes[1]), 0);
  assert.equal((await tool.execute({ tasks: [
    { project_id: 15, title: "First", description: "<p>First</p>" },
    { project_id: 15, title: "Second", description: "<p>Second</p>" },
  ] })).success, true);
  assert.equal(count(writes[2]), 0);
  assert.equal(count(writes[3]), 0);
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

function loadComposer(saved) {
  return load("src/lib/ai/composeTask.ts", {
    axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/lib/createTaskAttachmentUploads": {
      startCreateTaskUpload: () => ({ id: "upload", promise: Promise.resolve({ url: shot }) }),
      createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
    },
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (payload) => {
      saved.push(payload);
      return { resposne: { newTask: { id: 90 + saved.length, projectId: 15, uniqueIndex: 90 + saved.length } } };
    } },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
  });
}
test("a split note does not stamp one screenshot onto every task", async () => {
  const dom = new JSDOM(""); const swaps = { fetch: global.fetch, DOMParser: global.DOMParser }; const saved = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify({ tasks: [{ title: "First", description: "<p>First</p>" }, { title: "Second", description: "<p>Second</p>" }] }) });
  try {
    const result = await loadComposer(saved).createComposedTask({ text: `Split this. Screenshot ${shot}`, files: [{ name: "Screenshot.png", type: "image/png" }], project: { id: 15, uniqueIdentifier: "HTPR" }, userId: 985, guaranteeScreenshots: true });
    assert.equal(result.tasks.length, 2);
    assert.deepEqual(saved.map((payload) => count(payload.description)), [0, 0]);
  } finally {
    global.fetch = swaps.fetch; global.DOMParser = swaps.DOMParser; dom.window.close();
  }
});
test("the uploaded image URL is the candidate, not its base64 copy", () => {
  const rule = load("src/lib/media/inlineAgentImages.ts", {});
  const uploaded = "https://files.hypertask.app/tasks/attachments/pasted.png?a=1&b=2";
  const candidates = rule.creationScreenshotCandidates([{ url: "data:image/png;base64,iVBORw0KGgo=", fileName: "pasted.png", mimeType: "image/png" }], "Make a ticket", [`<img src="${uploaded.replaceAll("&", "&amp;")}" alt="pasted">`]);
  assert.equal(candidates[0].url, uploaded);
  const guaranteed = rule.guaranteeCreationScreenshots("<p>Make a ticket</p>", { instructions: "Make a ticket", attachments: candidates });
  assert.equal(count(guaranteed), 1); assert.ok(guaranteed.includes(uploaded.replaceAll("&", "&amp;")));
  assert.equal(count(rule.guaranteeCreationScreenshots("<p>Make a ticket</p>", { instructions: "Make a ticket", attachments: [{ url: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" }] })), 0);
});

test("a screenshot the sidebar chat sends as base64 still lands inline", async () => {
  const writes = [];
  const base64Images = [{ url: base64Png, fileName: "screenshot.png", mimeType: "image/png" }];
  const tool = createTool(writes, true, "Create a task from the screenshot.", base64Images);
  assert.equal((await tool.execute({ project_id: 15, title: "Evidence", description: "<p>Evidence</p>" })).success, true);
  assert.equal(count(writes[0]), 1);
  assert.ok(writes[0].includes("screenshot.png"));
  const off = [];
  const flagOff = createTool(off, false, "Create a task from the screenshot.", base64Images);
  assert.equal((await flagOff.execute({ project_id: 15, title: "Off", description: "<p>Off</p>" })).success, true);
  assert.equal(count(off[0]), 0);
});

test("task attachments keep their uploaded URL and non-images are ignored on save", () => {
  const rule = load("src/lib/media/inlineAgentImages.ts", {});
  const attachments = rule.creationScreenshotAttachments([
    { name: "shot.png", type: "image/png", source: shot },
    { name: "notes.pdf", type: "application/pdf", source: "https://files.hypertask.app/tasks/attachments/notes.pdf" },
    { name: "pending.png", type: "image/png" },
  ]);
  assert.deepEqual(attachments, [{ url: shot, fileName: "shot.png", mimeType: "image/png" }]);
  const saved = rule.guaranteeCreationScreenshots("<p>Fix the login error</p>", { instructions: "Fix the login error", attachments });
  assert.equal(count(saved), 1);
  assert.equal(count(rule.guaranteeCreationScreenshots("<p>Link only please</p>", { instructions: "Link only please", attachments })), 0);
});

test("base64 screenshots are hosted before embedding", async () => {
  const hosted = "https://files.hypertask.app/tasks/attachments/hosted.png";
  const uploads = [];
  const { hostInlineScreenshots } = load("src/lib/media/hostInlineScreenshots.server.ts", {
    "@/lib/storage/uploadTaskAttachmentToS3": { uploadTaskAttachmentToS3: async (buffer, fileName, contentType) => { uploads.push({ bytes: buffer.length, fileName, contentType }); return hosted; } },
  });
  const result = await hostInlineScreenshots([{ url: base64Png, fileName: "screenshot.png", mimeType: "image/png" }, { url: shot, fileName: "already.png", mimeType: "image/png" }, { url: "https://example.com/page", fileName: "page.html", mimeType: "text/html" }]);
  assert.deepEqual(result.map((file) => file.url), [hosted, shot, "https://example.com/page"]);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].contentType, "image/png");
  assert.ok(uploads[0].bytes > 0);
});

test("a base64 writer preview is hosted before the modal description is guaranteed", async () => {
  const uploads = [];
  const { hostedScreenshotFiles } = load("src/lib/media/hostedScreenshotFiles.ts", {
    "@/lib/createTaskAttachmentUploads": { startCreateTaskUpload: (file) => { uploads.push(file.name); return { id: "one", promise: Promise.resolve({ url: shot }) }; } },
  });
  const attachable = new File([new Uint8Array([137, 80, 78, 71])], "attached.png", { type: "image/png" });
  const result = await hostedScreenshotFiles([
    attachable,
    { name: "ready.png", type: "image/png", source: shot },
    { name: "notes.pdf", type: "application/pdf", source: "https://files.hypertask.app/tasks/attachments/notes.pdf" },
  ]);
  assert.deepEqual(result.map((file) => file.url), [shot, shot, "https://files.hypertask.app/tasks/attachments/notes.pdf"]);
  assert.deepEqual(uploads, ["attached.png"]);
});

test("a data URL attachment is uploaded once and reused", async () => {
  const uploads = [];
  const { hostedScreenshotFiles } = load("src/lib/media/hostedScreenshotFiles.ts", {
    "@/lib/createTaskAttachmentUploads": { startCreateTaskUpload: () => { uploads.push(1); return { id: "one", promise: Promise.resolve({ url: shot }) }; } },
  });
  const pending = { name: "pasted.png", type: "image/png", source: base64Png };
  const saved = await hostedScreenshotFiles([pending, { ...pending }]);
  assert.deepEqual(saved.map((file) => file.url), [shot, shot]);
  assert.equal(uploads.length, 1);
});
