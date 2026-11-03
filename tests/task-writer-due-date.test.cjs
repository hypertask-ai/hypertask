const { withStubs } = require("./helpers/stub-map.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const key = "htpr-7054-ctrlj-due-date";
const now = new Date("2026-10-10T02:00:00Z");
test.mock.timers.enable({ apis: ["Date"], now });
const example = "Review onboarding, due 2026-10-16";
const html = '<h1 id="ai-generated-task-title">Review onboarding, due 2026-10-16</h1><p>Review onboarding by the deadline.</p><span id="ai-generated-task-due-date" style="display:none">2026-10-16</span>';

function moduleWithStubs(file, stubs) {
  stubs = withStubs({ "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: undefined }, "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html } }, stubs);
  stubs = withStubs({ "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope }, stubs);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(mod, mod.exports, (id) => {
    if (id === "@/utils/controllers/tasks/parentTaskAccess") return load(path.join(root, "src/utils/controllers/tasks/parentTaskAccess.ts"));
    if (id === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertTaskCountTransition: async () => {}, assertTicketRoom: async () => {}, assertProjectTicketRoom: async () => {}, assertBoardRoom: async () => {} };
    if (id === "@/lib/storage/verifyTaskAttachmentLinks") return { verifyTaskAttachmentLinks: async () => new Map() };
    if (id === "@/lib/api/errorMessage") return moduleWithStubs("src/lib/api/errorMessage.ts", {});
    if (id in stubs) return stubs[id];
    if (!id.startsWith("@/") && !id.startsWith(".")) return require(id);
    throw new Error(`Unexpected dependency: ${id}`);
  });
  return mod.exports;
}

async function withComposer(enabled, check) {
  const cached = new Map(Object.entries(require.cache));
  const dom = new JSDOM("");
  const saved = ["DOMParser", "fetch"].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const creates = [], requests = [];
  const stub = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  try {
    global.DOMParser = dom.window.DOMParser;
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(html, { headers: enabled ? { "X-Task-Writer-Due-Date": "enabled" } : {} });
    };
    stub("src/lib/deriveCurrentBoardBilling.ts", { deriveCurrentBoardBilling: () => ({}) });
    stub("src/lib/createTaskAttachmentUploads.ts", { bindCreateTaskUploads() {} });
    stub("src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts", { default: async (body) => {
      creates.push(body);
      return { resposne: { newTask: { id: 91 } } };
    } });
    const filename = require.resolve("axios");
    require.cache[filename] = { id: filename, filename, loaded: true, exports: { default: { get: async () => ({ data: { sectionId: 12, section: "Todo", ranking: "a" } }) } } };
    const api = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false, interopDefault: true })(path.join(root, "src/lib/ai/composeTask.ts"));
    await api.createComposedTask({ text: example, files: [], project: { id: 7, uniqueIdentifier: "TEST" }, userId: 985 });
    await check({ creates, requests });
  } finally {
    for (const name of Object.keys(require.cache)) if (!cached.has(name)) delete require.cache[name];
    for (const [name, value] of cached) require.cache[name] = value;
    for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(global, name, descriptor) : delete global[name];
    dom.window.close();
  }
}

test("composer forwards validated ISO due date and browser time zone to the normal create API", async () => {
  await withComposer(true, ({ creates, requests }) => {
    assert.equal(creates[0].writerDueDate, "2026-10-16");
    assert.equal(creates[0].writerTimeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(requests[0].timeZone, creates[0].writerTimeZone);
    assert.doesNotMatch(creates[0].description, /ai-generated-task-due-date/);
  });
});

test("composer leaves legacy title and save payload unchanged when the server flag is off", async () => {
  await withComposer(false, ({ creates }) => {
    assert.equal(creates[0].writerDueDate, undefined);
    assert.equal(creates[0].writerTimeZone, undefined);
    assert.equal(creates[0].dueDate, undefined);
    assert.equal(creates[0].title, example);
  });
});

const dates = load(path.join(root, "src/lib/ai/taskWriterDueDate.ts"));
const ticketTypes = load(path.join(root, "src/lib/ai/taskWriterTicketType.ts"));
const keys = load(path.join(root, "src/lib/flags/keys.ts"));

const marker = (date) => `<p>Finish</p><span id="ai-generated-task-due-date" style="display:none">${date}</span>`;

test("a valid model date is kept and the marker is rewritten", () => {
  const context = dates.taskWriterDateContext("Europe/London", now);
  const result = dates.applyTaskWriterDueDate(html, context);
  assert.equal(result.dueDate, "2026-10-16");
  assert.match(result.html, /ai-generated-task-due-date[^>]*>2026-10-16/);
  assert.match(result.html, /Review onboarding, due 2026-10-16/);
});

test("invalid calendar, past, beyond two years and missing model dates give no due date", () => {
  const context = dates.taskWriterDateContext("UTC", now);
  assert.equal(context.today, "2026-10-10");
  for (const value of ["2026-02-30", "2026-13-16", "2026-10-00", "2026-10-09", "2028-10-11", "2099-10-16", "2026-10-16T00:00:00Z", "soon"]) {
    const result = dates.applyTaskWriterDueDate(marker(value), context);
    assert.equal(result.dueDate, undefined, value);
    assert.doesNotMatch(result.html, /ai-generated-task-due-date/, value);
  }
  assert.equal(dates.applyTaskWriterDueDate("<p>Finish</p>", context).dueDate, undefined);
  assert.equal(dates.applyTaskWriterDueDate(marker("2026-10-10"), context).dueDate, "2026-10-10");
  assert.equal(dates.applyTaskWriterDueDate(marker("2028-10-10"), context).dueDate, "2028-10-10");
  assert.equal(dates.validateTaskWriterDueDate(16, context.today), undefined);
  assert.equal(dates.taskWriterDateContext("invalid/zone", now).timeZone, "UTC");
});

test("today comes from the user's time zone and the prompt states the rules", () => {
  const west = dates.taskWriterDateContext("America/Los_Angeles", now);
  assert.equal(west.today, "2026-10-09");
  assert.equal(dates.taskWriterDateContext("Asia/Tokyo", now).today, "2026-10-10");
  assert.equal(dates.applyTaskWriterDueDate(marker("2026-10-09"), west).dueDate, "2026-10-09");
  const text = dates.taskWriterDueDateInstructions(west);
  assert.match(text, /2026-10-09[\s\S]*America\/Los_Angeles/);
  assert.match(text, /explicitly asks/);
  assert.match(text, /negates/);
});

function saveHarness(enabled) {
  const writes = [], updates = [], jobs = [];
  const prisma = {
    user: { findUnique: async () => ({ id: 985 }) },
    project: { findFirst: async () => ({ id: 7 }), findUnique: async () => ({ uniqueIdentifier: "TEST" }) },
    task: {
      findFirst: async () => ({ id: 52, projectId: 7, title: "", status: "Normal", description_: { content: "" } }),
      create: async ({ data }) => { writes.push(data); return { id: 91, ...data }; },
    },
    section: { findFirst: async () => ({ id: 12, section_title: "Todo" }) },
    $executeRaw: async () => {},
  };
  const queue = { cancelDueDateJob: async (...args) => jobs.push({ cancel: args }), scheduleDueDateJob: async (...args) => jobs.push({ schedule: args }) };
  const effects = { schedulePostCreateWork() {} };
  const stubs = {
    "@/lib/ai/prompts/registry": { renderPrompt: () => "output language rule" },
    "@/lib/ai/taskWriterDueDate": dates, "@/lib/ai/taskWriterTicketType": ticketTypes, "@/lib/flags/keys": keys,
    "@/lib/api/task-writes/create-global-effects": effects, "./create-global-effects": effects,
    "@/lib/ai/composeTaskTarget": load(path.join(root, "src/lib/ai/composeTaskTarget.ts")),
    "@/lib/flags": { ...keys, isFeatureEnabled: async (flag) => flag === key ? enabled : true },
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: Error } },
    "@/utils/generateRank": {}, "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_prisma, _actor, callback) => ({ ...(await callback(prisma)), boardWebhookDeliveryIds: [] }) },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: async () => {} },
    "@/lib/telemetry/savedWork": { enqueueBoardCreated: async () => "board-key", processAnalyticsIntentSoon: () => {}, enqueueTaskCreated: async () => "task-key", creationChannelFromHeader: () => 'web', CREATION_CHANNEL_HEADER: 'X-Hypertask-Creation-Channel', CREATION_AGENT_HEADER: 'X-Hypertask-Creation-Agent' },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    "@/lib/auth/session": { SESSION_COOKIE: "session", verifySession: () => null },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (body) => { updates.push(body); return { status: 200, json: { ...body, projectId: 7 } }; } },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {}, broadcastTaskChange: async () => {} },
    "../queues/duedateQueue": queue, "@/pages/api/queues/duedateQueue": queue,
    "next/server": { NextResponse: { json: Response.json } }, "better-auth/cookies": { parseCookies: () => new Map() },
  };
  stubs["./route"] = moduleWithStubs("src/lib/api/task-writes/route.ts", stubs);
  const api = moduleWithStubs("src/lib/api/task-writes/create-global.ts", stubs);
  const post = async (extra = {}) => {
    const body = { title: "Review onboarding", description: "<p>Review</p>", projectId: 7, userId: 985, sectionId: 12, requestKind: "compose-task", writerDueDate: "2026-10-16", writerTimeZone: "America/Los_Angeles", ...extra };
    const response = await api.POST({ json: async () => body, headers: new Headers(), cookies: {} }, { userId: 985 });
    return { status: response.status, body: await response.json() };
  };
  return { post, writes, updates, jobs };
}

{
  test(`app normal create saves validated deadline at the picker's local default time and schedules it`, async () => {
    const h = saveHarness(true);
    assert.equal((await h.post()).status, 200);
    assert.equal(h.writes[0].dueDate.toISOString(), "2026-10-16T16:00:00.000Z");
    assert.equal(h.writes[0].dueDateNotifiedAt, null);
    assert.equal(h.jobs[0].schedule[1].toISOString(), h.writes[0].dueDate.toISOString());
    assert.equal((await h.post({ writerDueDate: "2026-02-30" })).status, 200);
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].dueDate ?? null, null);
  });
  test(`app existing empty ticket uses the normal update controller and resets its due-date job`, async () => {
    const h = saveHarness(true);
    assert.equal((await h.post({ existingTaskId: 52 })).status, 200);
    assert.equal(h.updates[0].dueDate.toISOString(), "2026-10-16T16:00:00.000Z");
    assert.equal(h.updates[0].dueDateNotifiedAt, null);
    assert.equal(h.jobs[0].cancel[0], 52);
    assert.equal(h.jobs[1].schedule[0].taskId, 52);
    assert.equal(h.writes.length, 0);
  });
  test(`app flag off ignores writer date, preserves ordinary due dates, and never alters an existing deadline`, async () => {
    const h = saveHarness(false);
    assert.equal((await h.post()).status, 200);
    assert.equal(h.writes[0].dueDate, undefined);
    assert.equal(h.jobs.length, 0);
    assert.equal((await h.post({ dueDate: "2026-10-20T09:00:00Z" })).status, 200);
    assert.equal(h.writes[1].dueDate, "2026-10-20T09:00:00Z");
    assert.equal((await h.post({ existingTaskId: 52 })).status, 200);
    assert.equal(h.updates[0].dueDate, undefined);
    const manual = saveHarness(true);
    assert.equal((await manual.post({ requestKind: undefined })).status, 200);
    assert.equal(manual.writes[0].dueDate, undefined);
  });
}
