const { withStubs } = require("./helpers/stub-map.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const { z } = require("zod");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const schemas = load(path.join(root, "src/lib/ai/tools/schemas.ts"));
const constants = load(path.join(root, "src/lib/constants/constants.ts"));
const properties = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
const duplicateGuard = load(path.join(root, "src/lib/ai/taskWriterDuplicateGuard.ts"));
const { toStoredHtml } = load(path.join(root, "src/utils/helperFunctions/toStoredHtml.ts"));
const output = '<h1 id="ai-generated-task-title">Writer title</h1><p>Writer body.</p><p id="ai-generated-task-properties"><span id="ai-generated-task-priority">2</span><span id="ai-generated-task-estimate">3</span></p>';
const flag = "htpr-7513-writer-project-labels";
const boardLabels = [{ id: "multiprompt-id", value: "Multiprompt" }, { id: "wazig-id", value: "Wazig" }, { id: "bug-id", value: "Bug" }];
const labelMarker = (ids) => `<span id="ai-generated-task-tags" style="display:none">${ids.join(",")}</span>`;
const fields = [{ id: "score-field", name: "ICE", type: "Number", options: null }];
const marker = (value) => `<span id="ai-generated-task-custom-fields" style="display:none">${JSON.stringify(value)}</span>`;
const optionalModule = (file) => fs.existsSync(path.join(root, file)) ? load(path.join(root, file)) : {};
const fieldTools = () => optionalModule("src/lib/ai/taskWriterCustomFields.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

function moduleWithStubs(file, stubs) {
  if (!("@/lib/auth/agentScope" in stubs)) stubs = withStubs({ "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope }, stubs);
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
      if (id === "@/lib/net/downloadWithoutBrotli") return { downloadWithoutBrotli: undefined };
      if (id === "@/app/api/ai/_lib/skillAccess") return { AccountSkillAccessError: class extends Error {} };
      if (id === "@/lib/auth/agentScope") return require("./helpers/agent-board-scope.cjs").enforcedScope;
      if (["@/lib/ai/taskWriterSkills", "./taskWriterSkills"].includes(id)) return load(path.join(root, "src/lib/ai/taskWriterSkills.ts"));
      if (id === "@/lib/media/inlineAgentImages.server") return { inlineAgentImagesForUser: async (html) => html };
      if (id === "@/lib/media/inlineAgentImages") return load(path.join(root, "src/lib/media/inlineAgentImages.ts"));
      if (id === "@/lib/ai/prompts/registry") return load(path.join(root, "src/lib/ai/prompts/registry.ts"));
      if (["@/lib/ai/taskWriterCustomFields", "./taskWriterCustomFields"].includes(id)) return fieldTools();
      if (id.startsWith("@/") || id.startsWith("./")) throw new Error(`Unstubbed dependency ${id} in ${file}`);
      return require(id);
    },
  }, { filename });
  return loadedModule.exports;
}

function harness(options = {}) {
  const saved = [], calls = [], usage = [], selections = [], confirmations = [], retrieval = [], reports = [], labelSaves = [], labelCreates = [];
  const instructionLoads = [], fieldLoads = [], fieldSaves = [], checks = [];
  let active = 0, maxActive = 0;
  const signal = options.controller?.signal;
  let existingLabels = options.existingLabels ?? [];
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
        content: [{ type: "text", text: options.split ? JSON.stringify({ tasks: options.tasks }) : options.output ?? output }],
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
    project: { findFirst: async ({ where }) => options.denied || where.id !== 15 ? null : ({ id: 15, title: "Own board", section: [], labels: boardLabels }) },
    label: { findMany: async ({ where }) => where.projectId === 15 ? boardLabels.filter((label) => !where.id || where.id.in.includes(label.id)) : [], create: async (value) => { labelCreates.push(value); throw new Error("Must not create labels"); } },
    aI_Custom_Instructions: { findFirst: async ({ where }) => { instructionLoads.push(where); return { customInstruction: where.projectId === 15 ? "OWN_INSTRUCTIONS_SENTINEL" : "FOREIGN_INSTRUCTIONS_SENTINEL" }; } },
    customField: { findMany: async ({ where }) => { fieldLoads.push(where); return where.projectId === 15 ? (options.noFields ? [] : fields) : [{ id: "foreign-field", name: "FOREIGN_FIELD", type: "Number" }]; } },
    section: { findMany: async () => [], findFirst: async () => options.badSection ? null : { id: 7 } },
    taskTemplate: { findMany: async () => [] },
    task: { findFirst: async () => ({ id: 52, projectId: 15, status: "Normal", title: "", description_: { content: "" } }) },
    taskLabel: { findMany: async () => existingLabels.map((labelId) => ({ labelId, label: boardLabels.find((label) => label.id === labelId) })) },
    agent: { findFirst: async () => options.badAgent ? null : { id: "agent" } },
  };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (taskRows, commentRows, principal) => {
      assert.equal(principal?.teamScope == null, true);
      return { taskRows, commentRows };
    } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG ? Boolean(options.split) : key === flag ? options.labels !== false : key === keys.HTPR_7471_WRITER_BOARD_FORMAT_FLAG ? options.format !== false : key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG ? options.web !== false : [keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG, keys.HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG, keys.HTPR_6937_NEW_TASK_WINDOW_FLAG].includes(key);
    } },
    "@/lib/flags/keys": keys,
    "@/app/api/ai/_lib/customInstructions": moduleWithStubs("src/app/api/ai/_lib/customInstructions.ts", new Proxy({ "@/lib/prisma": { __esModule: true, default: prisma }, "ai": ai }, { has: () => true, get: (target, id) => target[id] ?? {} })),
    "@/lib/ai/prompts/registry": load(path.join(root, "src/lib/ai/prompts/registry.ts")),
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => !options.featureDisabled },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": load(path.join(root, "src/lib/ai/composeTaskTarget.ts")),
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
    "@/lib/ai/tools/readAgentGate": { refuseReadAgentToolCall: async () => null },
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
    "@/utils/controllers/customFields": { saveWriterCustomFieldValues: async (taskId, values) => { for (const { fieldId, value } of values) fieldSaves.push(plain([fieldId, taskId, value])); } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { checks.push([key, userId]); return key === flag && options.labels !== false; } },
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
    "@/app/api/ai/_lib/taskWriterProperties": properties,
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (body) => { saved.push(plain(body)); return { status: 200, json: { ...body, projectId: 15, uniqueIndex: 52 } }; } },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {}, broadcastTaskChange: async () => {} },
    "@/lib/mcp/tasks/services": { mutateTaskLabels: async (taskId, projectId, changes) => {
      assert.equal(projectId, 15);
      if (!existingLabels.some((id) => changes.skipIfPresent.includes(id))) {
        existingLabels = [...new Set([...existingLabels, ...changes.add])];
        labelSaves.push(changes.add.map((labelId) => ({ taskId, labelId })));
      }
    } },
    "@/lib/ai/taskWriterDueDate": {},
    "@/lib/flags/keys": keys,
    "next/server": { NextResponse: { json: Response.json } },
    "better-auth/cookies": { parseCookies: () => new Map() },
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
    "@/lib/ai/composeTaskTarget": load(path.join(root, "src/lib/ai/composeTaskTarget.ts")),
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => { checks.push([key, userId]); return key === flag ? options.labels !== false : key === keys.HTPR_7471_WRITER_BOARD_FORMAT_FLAG ? options.format !== false : [keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG, keys.HTPR_6937_NEW_TASK_WINDOW_FLAG].includes(key); } },
    "@/lib/prisma": { default: { ...prisma, user: { findUnique: async () => ({ id: 985 }) } }, __esModule: true },
    "@/utils/controllers/customFields": { getCustomFieldsForProject: async (projectId) => { fieldLoads.push({ projectId }); return options.noFields ? [] : fields; }, saveWriterCustomFieldValues: async (taskId, values) => { for (const { fieldId, value } of values) fieldSaves.push(plain([fieldId, taskId, value])); } },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
    "@/utils/generateRank": {},
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, _actor, create) => {
      const result = await create({ $executeRaw: async () => {}, section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) }, project: { findUnique: async () => ({ uniqueIdentifier: "OWN" }) }, taskLabel: { createMany: async ({ data }) => labelSaves.push(plain(data)), findMany: async () => [] }, task: { create: async ({ data }) => { saved.push(plain(data)); return { ...data, id: saved.length, description_: { content: data.description_.create.content } }; } } });
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
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => ({ addedFilters: ["labels"] }) },
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": { getNewTaskViewDefaults: () => ({ tags: options.viewTags ?? [], assignees: [] }) },
    "@/lib/ai/taskWriterTicketType": load(path.join(root, "src/lib/ai/taskWriterTicketType.ts")),
    "@/utils/helperFunctions/describeTaskWriterFailure": {},
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { __esModule: true, default: async (body) => {
      const response = await saveRoute.POST({ headers: new Headers(), json: async () => body }, { userId: 985 });
      const data = await response.json();
      return { error: response.status !== 200, resposne: data };
    } },
  });
  return { tool, saved, calls, usage, selections, confirmations, retrieval, reports, labelSaves, labelCreates, run, instructionLoads, fieldLoads, fieldSaves, checks,
    compose: async (extra = {}) => {
      const previousFetch = global.fetch, previousParser = global.DOMParser;
      global.DOMParser = new (require("jsdom").JSDOM)("").window.DOMParser;
      global.fetch = async (_url, args) => webRoute.POST({ json: async () => JSON.parse(args.body) });
      try { return await composer.createComposedTask({ text: "Make this change", files: [], project: { id: 15, ai_custom_instructions: [{ customInstruction: "" }] }, userId: 985, ...extra }); }
      finally { global.fetch = previousFetch; global.DOMParser = previousParser; }
    },
    save: (body) => saveRoute.POST({ headers: new Headers(), json: async () => ({ projectId: 15, userId: 985, title: "T", description: "<p>B</p>", requestKind: "compose-task", ...body }) }, { userId: 985 }),
    get maxActive() { return maxActive; },
    execute: (input) => tool.execute(tool.inputSchema.parse(input)),
    post: (input) => route.POST({ json: async () => input }),
  };
}


const savedIds = (h, surface) => surface === "chat" ? h.saved.map((task) => task.labels) : h.saved.map((_, i) => h.labelSaves.flat().filter((entry) => entry.taskId === i + 1).map((entry) => entry.labelId));

for (const surface of ["compose", "chat"]) {
  for (const [name, id] of [["Multiprompt", "multiprompt-id"], ["Wazig", "wazig-id"]]) {
    test(`${surface}: ${name} project label survives the real writer and save path`, async () => {
      const h = harness({ enabled: true, output: output + labelMarker([id]) });
      const result = surface === "chat" ? await h.execute({ project_id: 15, brief: `Fix ${name}; the other project is only a comparison` }) : await h.compose({ text: `Fix ${name}` });
      assert.equal(surface === "chat" ? result.success : !result.writerFailed, true);
      assert.deepEqual(savedIds(h, surface), [[id]]);
      const prompt = JSON.stringify(h.calls[0].prompt);
      for (const label of boardLabels) { assert.ok(prompt.includes(label.id)); assert.ok(prompt.includes(label.value)); }
      assert.match(prompt, /project.*ticket is about/i);
      assert.match(prompt, /(?:unclear|ambiguous)/i);
      assert.deepEqual(h.labelCreates, []);
      assert.doesNotMatch(JSON.stringify(h.saved), /ai-generated-task-tags/);
    });
  }
  test(`${surface}: unknown, foreign ids, invented names and duplicates are ignored`, async () => {
    const h = harness({ enabled: true, output: output + labelMarker(["wazig-id", "foreign-id", "unknown", "Invented Project", "Multiprompt", "wazig-id"]) });
    if (surface === "chat") assert.equal((await h.execute({ project_id: 15, brief: "Fix Wazig" })).success, true);
    else assert.equal((await h.compose()).writerFailed, false);
    assert.deepEqual(savedIds(h, surface), [["wazig-id"]]);
    assert.deepEqual(h.labelCreates, []);
  });
  test(`${surface}: unclear project never falls back to the first label`, async () => {
    const h = harness({ enabled: true, output: output + labelMarker(["Invented Project"]) });
    if (surface === "chat") await h.execute({ project_id: 15, brief: "Fix something" });
    else await h.compose();
    assert.equal(h.saved.length, 1);
    assert.deepEqual(savedIds(h, surface), [[]]);
    assert.deepEqual(h.labelCreates, []);
  });
  test(`${surface}: explicit labels win over writer labels`, async () => {
    const h = harness({ enabled: true, output: output + labelMarker(["wazig-id"]) });
    if (surface === "chat") await h.execute({ project_id: 15, brief: "Fix Wazig", labels: ["multiprompt-id", "bug-id"] });
    else await h.compose({ fields: { tags: [boardLabels[0], boardLabels[2]] } });
    assert.deepEqual(savedIds(h, surface), [["multiprompt-id", "bug-id"]]);
  });
  test(`${surface}: flag off keeps old label behavior including explicit choices`, async () => {
    for (const explicit of [false, true]) {
      const h = harness({ enabled: true, labels: false, output: output + labelMarker(["wazig-id"]) });
      if (surface === "chat") await h.execute({ project_id: 15, brief: "Fix Wazig", ...(explicit ? { labels: ["bug-id"] } : {}) });
      else await h.compose({ ...(explicit ? { fields: { tags: [boardLabels[2]] } } : {}) });
      assert.deepEqual(savedIds(h, surface), [explicit ? ["bug-id"] : []]);
      assert.equal(h.saved.length, 1);
      assert.deepEqual(h.labelCreates, []);
      assert.doesNotMatch(JSON.stringify(h.calls[0].prompt), /wazig-id|multiprompt-id/);
    }
  });
}

test("split JSON: Multiprompt and Wazig tickets keep their own validated labels", async () => {
  const h = harness({ split: true, tasks: [
    { title: "Fix Multiprompt", description: "<p>Multiprompt body</p>", labelIds: ["multiprompt-id", "foreign-id", "multiprompt-id"] },
    { title: "Fix Wazig", description: "<p>Wazig body</p>", labelIds: ["wazig-id", "Invented", "unknown", "Multiprompt"] },
  ] });
  assert.equal((await h.compose()).writerFailed, false);
  assert.deepEqual(savedIds(h, "compose"), [["multiprompt-id"], ["wazig-id"]]);
  assert.deepEqual(h.labelCreates, []);
});

test("split JSON: view-default tags win for every ticket; flag off ignores writer ids", async () => {
  const tasks = [
    { title: "Multiprompt", description: "<p>Body</p>", labelIds: ["multiprompt-id"] },
    { title: "Wazig", description: "<p>Body</p>", labelIds: ["wazig-id"] },
  ];
  for (const labels of [true, false]) {
    const h = harness({ split: true, tasks, labels, viewTags: [boardLabels[2]] });
    assert.equal((await h.compose({ viewProject: { id: 15 } })).writerFailed, false);
    assert.deepEqual(savedIds(h, "compose"), [["bug-id"], ["bug-id"]]);
    const bare = harness({ split: true, tasks, labels });
    assert.equal((await bare.compose()).writerFailed, false);
    assert.deepEqual(savedIds(bare, "compose"), labels ? [["multiprompt-id"], ["wazig-id"]] : [[], []]);
  }
});

test("compose save validates untrusted writer ids on the server and respects its own flag", async () => {
  for (const labels of [true, false]) {
    const h = harness({ labels });
    const response = await h.save({ writerLabelIds: ["wazig-id", "foreign-id", "unknown", "Invented", "Multiprompt", "wazig-id"] });
    assert.equal(response.status, 200);
    assert.deepEqual(savedIds(h, "compose"), [labels ? ["wazig-id"] : []]);
    assert.deepEqual(h.labelCreates, []);
  }
});

test("MCP drafts expose only validated ids; flag off leaves the old response", async () => {
  for (const labels of [true, false]) {
    const h = harness({ labels, output: output + labelMarker(["multiprompt-id", "foreign-id", "Invented"]) });
    const response = await h.post({ project_id: 15, prompt: "Fix Multiprompt" });
    assert.equal(response.status, 200);
    const draft = await response.json();
    assert.deepEqual(draft.labelIds, labels ? ["multiprompt-id"] : undefined);
    assert.doesNotMatch(draft.html, /ai-generated-task-tags/);
  }
});

test("bugfix flag has the requested rollout and small release risk", () => {
  const definition = optionalModule("src/lib/flags/definitions/htpr-7513-writer-project-labels.ts").default;
  assert.ok(definition);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.shippedOn, "2026-10-21");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, undefined);
});


test("filling an empty Ctrl+J task saves writer labels but keeps existing user labels", async () => {
  for (const labels of [true, false]) {
    for (const existingLabels of [[], ["bug-id"]]) {
      const h = harness({ labels, existingLabels, output: output + labelMarker(["wazig-id"]) });
      const result = await h.compose({ existingTaskId: 52 });
      assert.equal(result.writerFailed, false);
      assert.equal(result.task.id, 52);
      assert.deepEqual(h.labelSaves.flat().map((entry) => entry.labelId), labels && !existingLabels.length ? ["wazig-id"] : []);
      if (labels && !existingLabels.length) assert.equal(result.task.taskLabels[0].labelId, "wazig-id");
    }
  }
});
