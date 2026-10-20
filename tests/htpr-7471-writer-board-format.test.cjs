const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const { z } = require("zod");
const root = process.env.HTPR_7471_TEST_ROOT ?? path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const schemas = load(path.join(root, "src/lib/ai/tools/schemas.ts"));
const constants = load(path.join(root, "src/lib/constants/constants.ts"));
const properties = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
const duplicateGuard = load(path.join(root, "src/lib/ai/taskWriterDuplicateGuard.ts"));
const { toStoredHtml } = load(path.join(root, "src/utils/helperFunctions/toStoredHtml.ts"));
const output = '<h1 id="ai-generated-task-title">Writer title</h1><p>Writer body.</p><p id="ai-generated-task-properties"><span id="ai-generated-task-priority">2</span><span id="ai-generated-task-estimate">3</span></p>';
const flag = "htpr-7471-writer-board-format";
const fields = [{ id: "score-field", name: "ICE", type: "Number", options: null }];
const marker = (value) => `<span id="ai-generated-task-custom-fields" style="display:none">${JSON.stringify(value)}</span>`;
const optionalModule = (file) => fs.existsSync(path.join(root, file)) ? load(path.join(root, file)) : {};
const fieldTools = () => optionalModule("src/lib/ai/taskWriterCustomFields.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, Error, Date, AbortController, Response, Headers, ReadableStream, TextEncoder, TextDecoder, DOMParser: new (require("jsdom").JSDOM)("").window.DOMParser, fetch: (...args) => global.fetch(...args), performance,
    console: { log() {}, warn() {}, error() {} },
    require: (id) => {
      if (id in stubs) return stubs[id];
      if (["@/lib/ai/taskWriterCustomFields", "./taskWriterCustomFields"].includes(id)) return fieldTools();
      if (id.startsWith("@/") || id.startsWith("./")) throw new Error(`Unstubbed dependency ${id} in ${file}`);
      return require(id);
    },
  }, { filename });
  return loadedModule.exports;
}

function harness(options = {}) {
  const saved = [], calls = [], usage = [], selections = [], confirmations = [], retrieval = [], reports = [];
  const instructionLoads = [], fieldLoads = [], fieldSaves = [], checks = [];
  let active = 0, maxActive = 0;
  const signal = options.controller?.signal;
  const model = {
    specificationVersion: "v4", provider: "fixture", modelId: "writer-model", supportedUrls: {},
    async doStream(params) {
      const result = await this.doGenerate(params);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: result.content[0].text });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish", finishReason: result.finishReason, usage: result.usage });
        controller.close();
      } }) };
    },
    async doGenerate(params) {
      calls.push(params);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (options.fail) throw new Error("Writer unavailable");
      options.onGenerate?.();
      return {
        content: [{ type: "text", text: options.split ? JSON.stringify({ tasks: [{ title: "First", description: "<p>First body.</p>", customFields: [{ fieldId: "score-field", value: 19 }] }, { title: "Second", description: "<p>Second body.</p>", customFields: [{ fieldId: "score-field", value: "high" }, { fieldId: "foreign-field", value: 30 }] }] }) : options.output ?? output }],
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        finishReason: { unified: "stop" },
      };
    },
  };
  const editor = {
    ...load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts")),
    selectTaskWriterModel: async (input) => {
      selections.push(plain(input));
      if (options.preparationError) throw options.preparationError;
      return { model, modelId: "writer-model", teamId: "team", usageProvider: "fixture", settings: {}, tools: undefined };
    },
    retrieveTaskWriterContext: async (args) => { retrieval.push(plain(args)); return ""; },
    createDocumentAttachmentSummary: () => "",
    createTaskWriterUserContent: (input) => input,
    extractImgSrcs: () => new Set(),
    filterOneImagePass: (text) => ({ emit: text }),
    errorMessage: (error) => error.message,
  };
  const prisma = {
    project: { findFirst: async ({ where }) => options.denied || where.id !== 15 ? null : ({ id: 15, title: "Own board", section: [], labels: [] }) },
    aI_Custom_Instructions: { findFirst: async ({ where }) => { instructionLoads.push(where); return { customInstruction: where.projectId === 15 ? "OWN_INSTRUCTIONS_SENTINEL" : "FOREIGN_INSTRUCTIONS_SENTINEL" }; } },
    customField: { findMany: async ({ where }) => { fieldLoads.push(where); return where.projectId === 15 ? (options.noFields ? [] : fields) : [{ id: "foreign-field", name: "FOREIGN_FIELD", type: "Number" }]; } },
    section: { findMany: async () => [], findFirst: async () => options.badSection ? null : { id: 7 } },
    taskTemplate: { findMany: async () => [] },
    agent: { findFirst: async () => options.badAgent ? null : { id: "agent" } },
  };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG ? Boolean(options.split) : key === flag ? options.format !== false : key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG ? options.web !== false : [keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG, keys.HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG].includes(key);
    } },
    "@/lib/flags/keys": keys,
    "@/app/api/ai/_lib/customInstructions": moduleWithStubs("src/app/api/ai/_lib/customInstructions.ts", new Proxy({ "@/lib/prisma": { __esModule: true, default: prisma }, "ai": ai }, { has: () => true, get: (target, id) => target[id] ?? {} })),
    "@/lib/ai/prompts/registry": load(path.join(root, "src/lib/ai/prompts/registry.ts")),
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => !options.featureDisabled },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": {},
    "@/lib/ai/taskWriterDueDate": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/taskWriterPrompt": load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts")),
    "@/app/api/ai/_lib/taskWriterBoardResearch": load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts")),
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, args) => args.fixed + args.suffix },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "" }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
  });
  const draft = moduleWithStubs("src/app/api/ai/_lib/taskWriterDraft.ts", {
    ai,
    "./modelProvider": { configureAiModelUsage: (_model, record) => usage.push(plain(record)) },
    "./editorAi": editor,
    "./taskWriterRun": run,
    "./taskWriterProperties": properties,
    "@/lib/ai/taskWriterDuplicateGuard": duplicateGuard,
  });
  const errors = { errorMessage: (error) => error.message };
  const execution = moduleWithStubs("src/lib/ai/tools/execution.ts", {
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": {},
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/tasks/resolveTask": {},
    "@/app/api/ai/chat/stream/bulkTools": {},
    "@/lib/ai/chatStream/errors": errors,
  });
  const create = moduleWithStubs("src/lib/ai/tools/createTask.ts", {
    ai,
    "@/app/api/ai/chat/stream/bulkTools": { buildBulkOperationKey: (kind, tasks) => JSON.stringify([kind, tasks]) },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async (args) => { confirmations.push(args); return options.confirmed ? "execute" : "preview"; } },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async (projectId, userId) => {
        assert.equal(userId, 985);
        return options.denied || projectId !== 15 ? { error: { message: "Not a board member" } }
          : { project: { uniqueIdentifier: "HTPR", teamId: "team" } };
      },
      getSectionForTask: async () => ({ section: { id: 7, section_title: "Inbox" } }),
      validateParentTask: async () => options.badParent ? { error: { message: "Invalid parent" } } : {},
      createTask: async (payload) => {
        if (options.saveDenied) throw new Error("Permission revoked");
        saved.push(plain(payload));
        return { id: saved.length, projectId: payload.projectId, uniqueIndex: saved.length, title: payload.title };
      },
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/constants/constants": constants,
    "@/utils/controllers/getMemberAndOwnerForBoard": { __esModule: true, default: async () => [985, 42] },
    "@/utils/helperFunctions/toStoredHtml": { toStoredHtml },
    "@/lib/mcp/boards/links": { buildMcpTaskUrl: (id, index) => `/detail/project-${id}/${index}` },
    "@/lib/ai/tools/schemas": schemas,
    "@/lib/ai/tools/constants": { MAX_BULK_TOOL_TARGETS: 50 },
    "@/lib/ai/tools/execution": execution,
    "@/lib/ai/tools/helpers": { sanitizeForJson: plain, mapTaskToDetail: (task) => task },
    "@/lib/ai/chatStream/errors": errors,
    "@/utils/controllers/customFields": { upsertCustomFieldValue: async (...args) => fieldSaves.push(plain(args)) },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { checks.push([key, userId]); return key === flag && options.format !== false; } },
    "@/lib/flags/keys": keys,
    "@/app/api/ai/_lib/taskWriterDraft": draft,
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => !options.agentNotMember },
  });
  const context = {
    user: { id: 985 }, actingAgentId: options.agentId ?? null,
    sendStatus() {}, confirmationSessionId: "chat", bulkPreviewsIssued: new Set(),
    abortSignal: signal,
    ...(options.enabled === undefined ? {} : { chatTaskWriterEnabled: options.enabled }),
  };
  const tool = create.createCreateTaskTool(context).hypertask_create_task;
  const route = moduleWithStubs("src/app/api/mcp/ai/task-writer/route.ts", {
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler, validateMcpRouteAuth: async () => ({ user: context.user, agentId: context.actingAgentId }), checkMcpRouteRateLimit: async () => null },
    "@/lib/mcp/auth": { createUnauthorizedResponse: () => Response.json({}, { status: 401 }) },
    "@/lib/errors/reportError": { reportError: async (record) => reports.push(record) },
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/app/api/ai/_lib/taskWriterDraft": draft,
  });
  const webRoute = moduleWithStubs("src/app/api/ai/task-writer/route.ts", {
    ai,
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/ai/taskWriterDueDate": load(path.join(root, "src/lib/ai/taskWriterDueDate.ts")),
    "@/lib/ai/taskWriterTicketType": load(path.join(root, "src/lib/ai/taskWriterTicketType.ts")),
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/app/api/ai/_lib/editorAi": { ...editor, SSE_HEADERS: { "content-type": "text/event-stream" }, sseFrame: () => "event: error", createSseErrorResponse: (error, status) => Response.json({ error }, { status }) },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/app/api/ai/_lib/taskWriterProperties": properties,
  });
  const saveRoute = moduleWithStubs("src/lib/api/task-writes/create-global.ts", {
    "@/utils/controllers/tasks/parentTaskAccess": {},
    "@/lib/ai/taskWriterDueDate": {},
    "@/lib/flags/keys": keys,
    "next/server": { NextResponse: { json: Response.json } },
    "better-auth/cookies": { parseCookies: () => new Map() },
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
    "@/lib/ai/composeTaskTarget": {},
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => { checks.push([key, userId]); return key === flag ? options.format !== false : key === keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG; } },
    "@/lib/prisma": { default: { ...prisma, user: { findUnique: async () => ({ id: 985 }) } }, __esModule: true },
    "@/utils/controllers/customFields": { getCustomFieldsForProject: async (projectId) => { fieldLoads.push({ projectId }); return options.noFields ? [] : fields; }, upsertCustomFieldValue: async (...args) => fieldSaves.push(plain(args)) },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
    "@/utils/generateRank": {},
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, _actor, create) => {
      const result = await create({ $executeRaw: async () => {}, section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) }, project: { findUnique: async () => ({ uniqueIdentifier: "OWN" }) }, task: { create: async ({ data }) => { saved.push(plain(data)); return { ...data, id: saved.length, description_: { content: data.description_.create.content } }; } } });
      return { result: result.result, boardWebhookDeliveryIds: [] };
    } },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: async () => {} },
    "@/lib/telemetry/savedWork": { creationChannelFromHeader: () => "web" },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    "@/lib/auth/session": { verifySession: () => ({}) },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "./create-global-effects": { schedulePostCreateWork() {} },
    "./route": { taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session, request) },
  });
  const composer = moduleWithStubs("src/lib/ai/composeTask.ts", {
    "@/lib/media/browserRenderableImage": {},
    axios: { __esModule: true, default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/writer" },
    "./taskWriterBoardContext": { buildTaskWriterRequestScope: (project) => ({ projectId: project.id }) },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/utils/aiWriterUtils": load(path.join(root, "src/utils/aiWriterUtils.ts")),
    "@/utils/htmlEscape": load(path.join(root, "src/utils/htmlEscape.ts")),
    "./taskWriterMedia": { createTaskWriterMediaTokenFactory() {}, extractTaskWriterMedia: (html) => ({ html, media: [] }), restoreTaskWriterMedia: (html) => html, stripTaskWriterMediaTokens: (text) => text },
    "@/lib/createTaskAttachmentUploads": { bindCreateTaskUploads() {} },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
    "@/lib/ai/taskWriterTicketType": load(path.join(root, "src/lib/ai/taskWriterTicketType.ts")),
    "@/utils/helperFunctions/describeTaskWriterFailure": {},
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { __esModule: true, default: async (body) => {
      const response = await saveRoute.POST({ headers: new Headers(), json: async () => body }, { userId: 985 });
      const data = await response.json();
      return { error: response.status !== 200, resposne: data };
    } },
  });
  return { tool, saved, calls, usage, selections, confirmations, retrieval, reports, run, instructionLoads, fieldLoads, fieldSaves, checks,
    compose: async (customInstructions = "", enabled = options.format !== false) => {
      const previousFetch = global.fetch, previousParser = global.DOMParser;
      global.DOMParser = new (require("jsdom").JSDOM)("").window.DOMParser;
      global.fetch = async (_url, args) => webRoute.POST({ json: async () => JSON.parse(args.body) });
      try { return await composer.createComposedTask({ text: "Make this change", files: [], project: { id: 15, ai_custom_instructions: [{ customInstruction: customInstructions }] }, userId: 985, applyBoardFormat: enabled }); }
      finally { global.fetch = previousFetch; global.DOMParser = previousParser; }
    },
    save: (body) => saveRoute.POST({ headers: new Headers(), json: async () => ({ projectId: 15, userId: 985, title: "T", description: "<p>B</p>", requestKind: "compose-task", ...body }) }, { userId: 985 }),
    get maxActive() { return maxActive; },
    execute: (input) => tool.execute(tool.inputSchema.parse(input)),
    post: (input) => route.POST({ json: async () => input }),
  };
}


const promptText = (h) => JSON.stringify(h.calls[0].prompt);
const digest = (value) => require("node:crypto").createHash("sha256").update(value).digest("hex");
const skeletonRule = /brevity shortens sections[^.]*never drops a recurring one/i;

test("persisted instructions reach the actual SDK prompt for chat and empty-client compose; explicit text wins", async () => {
  const chat = harness({ enabled: true });
  assert.equal((await chat.execute({ project_id: 15, brief: "Make this change" })).success, true);
  assert.match(promptText(chat), /OWN_INSTRUCTIONS_SENTINEL/);
  const compose = harness();
  assert.equal((await compose.compose()).writerFailed, false);
  assert.match(promptText(compose), /OWN_INSTRUCTIONS_SENTINEL/);
  const explicit = harness();
  await explicit.compose("EXPLICIT_CLIENT_SENTINEL");
  assert.match(promptText(explicit), /EXPLICIT_CLIENT_SENTINEL/);
  assert.doesNotMatch(promptText(explicit), /OWN_INSTRUCTIONS_SENTINEL/);
  assert.equal(explicit.instructionLoads.length, 0);
  const whitespace = harness();
  await whitespace.compose("  \n ");
  assert.match(promptText(whitespace), /OWN_INSTRUCTIONS_SENTINEL/);
});

for (const web of [true, false]) {
  test(`recurring skeleton and title pattern outrank brevity only with the flag (web=${web})`, async () => {
    const on = harness({ enabled: true, web });
    await on.execute({ project_id: 15, brief: "Make this change" });
    assert.match(promptText(on), skeletonRule);
    assert.match(promptText(on), /title pattern/i);
    assert.match(promptText(on), /same order/i);
    assert.match(promptText(on), /custom fields.*(?:examples|instructions)/i);
    assert.ok(on.checks.some(([key, userId]) => key === flag && userId === 985));
    const off = harness({ enabled: true, format: false, web });
    await off.execute({ project_id: 15, brief: "Make this change" });
    assert.doesNotMatch(promptText(off), skeletonRule);
  });
}

for (const surface of ["chat", "compose"]) {
  test(`${surface}: vocabulary includes the board Number definition and saves model customFields=19`, async () => {
    const h = harness({ enabled: true, output: output + marker([{ fieldId: "score-field", value: 19 }]) });
    if (surface === "chat") assert.equal((await h.execute({ project_id: 15, brief: "Make this change" })).success, true);
    else assert.equal((await h.compose()).writerFailed, false);
    assert.match(promptText(h), /score-field/);
    assert.match(promptText(h), /ICE/);
    assert.match(promptText(h), /Number/);
    assert.deepEqual(h.fieldSaves, [["score-field", 1, 19]]);
    const description = surface === "chat" ? h.saved[0].description : h.saved[0].description_.create.content;
    assert.doesNotMatch(description, /ai-generated-task-custom-fields|score-field/);
  });
  test(`${surface}: invalid Number and foreign or unknown fields are ignored without failing creation`, async () => {
    const h = harness({ enabled: true, output: output + marker([{ fieldId: "score-field", value: "high" }, { fieldId: "foreign-field", value: 20 }, { fieldId: "unknown", value: 19 }]) });
    if (surface === "chat") assert.equal((await h.execute({ project_id: 15, brief: "Make this change" })).success, true);
    else assert.equal((await h.compose()).writerFailed, false);
    assert.equal(h.saved.length, 1);
    assert.deepEqual(h.fieldSaves, []);
    assert.match(promptText(h), /score-field/);
    assert.doesNotMatch(promptText(h), /FOREIGN_FIELD/);
  });
  test(`${surface}: a board without custom fields gets no field block or save`, async () => {
    const h = harness({ enabled: true, noFields: true });
    if (surface === "chat") await h.execute({ project_id: 15, brief: "Make this change" });
    else await h.compose();
    assert.equal(h.saved.length, 1);
    assert.doesNotMatch(promptText(h), /customFields:|CUSTOM_FIELDS|"fieldId"/);
    assert.deepEqual(h.fieldSaves, []);
    assert.match(promptText(h), /OWN_INSTRUCTIONS_SENTINEL/);
  });
}

test("CLI/MCP returns validated customFields without leaking its metadata into HTML", async () => {
  const h = harness({ output: output + marker([{ fieldId: "score-field", value: "19" }]) });
  const response = await h.post({ project_id: 15, prompt: "Make this change" });
  assert.equal(response.status, 200);
  const draft = await response.json();
  assert.deepEqual(draft.customFields, [{ fieldId: "score-field", value: 19 }]);
  assert.doesNotMatch(draft.html, /custom-fields|score-field/);
  assert.match(promptText(h), /OWN_INSTRUCTIONS_SENTINEL/);
  assert.deepEqual(h.fieldSaves, []);
});

for (const web of [true, false]) {
  test(`flag off: exact production SDK prompts, no instruction/field load or save (web=${web})`, async () => {
    const h = harness({ enabled: true, format: false, web });
    await h.execute({ project_id: 15, brief: "Make this change" });
    assert.equal(digest(promptText(h)), web ? "d8492475696ad235a452af16a21a09469f4a04d9354134d753a66ad552746303" : "5e696ae7af81c707c8752ecda742a77a8f0ce3060dd6f4c619693cee8407a5e8");
    assert.deepEqual(h.instructionLoads, []);
    assert.deepEqual(h.fieldLoads, []);
    assert.deepEqual(h.fieldSaves, []);
    assert.doesNotMatch(promptText(h), /OWN_INSTRUCTIONS|score-field|FOREIGN|CUSTOM_FIELDS/);
    const compose = harness({ format: false, web });
    assert.equal((await compose.compose()).writerFailed, false);
    assert.deepEqual(compose.instructionLoads, []);
    assert.deepEqual(compose.fieldLoads, []);
    assert.deepEqual(compose.fieldSaves, []);
  });
}

test("authorization precedes instruction and field loading, with an own-board positive control", async () => {
  const own = harness({ enabled: true });
  await own.execute({ project_id: 15, brief: "Make this change" });
  assert.match(promptText(own), /OWN_INSTRUCTIONS_SENTINEL/);
  assert.match(promptText(own), /score-field/);
  assert.doesNotMatch(promptText(own), /FOREIGN_INSTRUCTIONS_SENTINEL|FOREIGN_FIELD/);
  assert.ok(own.instructionLoads.every((where) => where.projectId === 15));
  assert.ok(own.fieldLoads.every((where) => where.projectId === 15));
  for (const projectId of [15, 999]) {
    const denied = harness({ denied: projectId === 15 });
    await assert.rejects(() => denied.run.prepareTaskWriterRun(denied.run.taskWriterRequestSchema.parse({ projectId, PROMPT: "Brief" }), 985), /access denied/);
    assert.deepEqual(denied.instructionLoads, []);
    assert.deepEqual(denied.fieldLoads, []);
    assert.deepEqual(denied.calls, []);
  }
});

test("compose save revalidates caller fields against only the authorized board, and server flag off refuses fields", async () => {
  const on = harness();
  const response = await on.save({ customFields: [{ fieldId: "score-field", value: "19" }, { fieldId: "foreign-field", value: 30 }, { fieldId: "unknown", value: 2 }] });
  assert.equal(response.status, 200);
  assert.deepEqual(on.fieldSaves, [["score-field", 1, 19]]);
  const denied = harness({ denied: true });
  assert.equal((await denied.save({ customFields: [{ fieldId: "score-field", value: 19 }] })).status, 403);
  assert.deepEqual(denied.fieldLoads, []);
  assert.deepEqual(denied.fieldSaves, []);
  const off = harness({ format: false });
  assert.equal((await off.save({ customFields: [{ fieldId: "score-field", value: 19 }] })).status, 200);
  assert.deepEqual(off.fieldSaves, []);
  assert.deepEqual(off.fieldLoads, []);
});

test("field validation: finite numbers, select option id/label, trimmed capped text; rejects malformed values", () => {
  const { validateTaskWriterCustomFields } = fieldTools();
  assert.equal(typeof validateTaskWriterCustomFields, "function");
  const definitions = [...fields, { id: "select", name: "Stage", type: "Select", options: [{ id: "option", label: "Ready" }] }, { id: "text", name: "Note", type: "Text" }];
  assert.deepEqual(plain(validateTaskWriterCustomFields(definitions, [{ fieldId: "score-field", value: " 19 " }, { fieldId: "select", value: "option" }, { fieldId: "text", value: "  hello  " }])), [{ fieldId: "score-field", value: 19 }, { fieldId: "select", value: "Ready" }, { fieldId: "text", value: "hello" }]);
  for (const value of ["high", "", "  ", "Infinity", Infinity, NaN, null, {}, [], true]) assert.deepEqual(plain(validateTaskWriterCustomFields(fields, [{ fieldId: "score-field", value }])), []);
  assert.deepEqual(plain(validateTaskWriterCustomFields(definitions, [{ fieldId: "select", value: "nope" }, null, {}])), []);
  assert.equal(validateTaskWriterCustomFields(definitions, [{ fieldId: "text", value: "a".repeat(5000) }])[0].value.length, 2000);
  assert.deepEqual(plain(validateTaskWriterCustomFields(definitions, [{ fieldId: "select", value: "Ready" }])), [{ fieldId: "select", value: "Ready" }]);
});

test("vocabulary includes select options, stays within its existing cap, and omits an empty field block", () => {
  const { formatBoardVocabulary } = load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts"));
  const own = formatBoardVocabulary({ projectTitle: "Own", customFields: [{ id: "select", name: "Stage", type: "Select", options: [{ id: "option", label: "Ready" }] }] });
  assert.match(own, /select/);
  assert.match(own, /Stage/);
  assert.match(own, /option/);
  assert.match(own, /Ready/);
  assert.doesNotMatch(formatBoardVocabulary({ projectTitle: "Own", customFields: [] }), /CUSTOM_FIELDS/);
  const capped = formatBoardVocabulary({ projectTitle: "Own", projectDescription: "x".repeat(9000), customFields: Array.from({ length: 50 }, (_, id) => ({ id: String(id), name: "n".repeat(64), type: "Text" })) });
  assert.ok(capped.length <= 4040);
});


test("structured compose carries each task's own validated fields through the real SDK and save route", async () => {
  const h = harness({ split: true });
  const result = await h.compose();
  assert.equal(result.writerFailed, false);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(h.fieldSaves, [["score-field", 1, 19]]);
  assert.match(promptText(h), /OWN_INSTRUCTIONS_SENTINEL/);
  assert.match(promptText(h), /score-field/);
  assert.doesNotMatch(JSON.stringify(h.saved), /customFields|foreign-field/);
});

test("client flag off does not forward writer fields even when the server flag is on", async () => {
  const h = harness({ output: output + marker([{ fieldId: "score-field", value: 19 }]) });
  assert.equal((await h.compose("", false)).writerFailed, false);
  assert.match(promptText(h), /OWN_INSTRUCTIONS_SENTINEL/);
  assert.deepEqual(h.fieldSaves, []);
  assert.equal(h.saved.length, 1);
});

test("one feature definition defaults to Everyone with a registry-supported low release risk", () => {
  const definition = optionalModule("src/lib/flags/definitions/htpr-7471-writer-board-format.ts").default;
  assert.ok(definition);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-20");
  assert.equal(definition.releaseRisk.risk, "small");
});
