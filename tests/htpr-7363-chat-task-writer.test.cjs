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
const plain = (value) => JSON.parse(JSON.stringify(value));

function moduleWithStubs(file, stubs) {
  stubs = withStubs({ "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: undefined }, "@/app/api/ai/_lib/skillAccess": { AccountSkillAccessError: class extends Error {} }, "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope }, stubs);
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, Error, Date, AbortController,
    console: { log() {}, warn() {}, error() {} },
    require: (id) => {
      if (id in stubs) return stubs[id];
      if (id === "@/lib/api/errorMessage") return moduleWithStubs("src/lib/api/errorMessage.ts", {});
      if (id === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false };
      if (id === "@/lib/storage/verifyTaskAttachmentLinks") return { verifyTaskAttachmentLinks: async () => new Map() };
      if (id === "@/lib/media/inlineAgentImages.server") return { inlineAgentImagesForUser: async (html) => html };
      if (id === "@/lib/media/inlineAgentImages") return load(path.join(root, "src/lib/media/inlineAgentImages.ts"));
      if (id === "@/lib/ai/prompts/registry") return load(path.join(root, "src/lib/ai/prompts/registry.ts"));
      if (id.startsWith("@/") || id.startsWith("./")) throw new Error(`Unstubbed dependency ${id} in ${file}`);
      return require(id);
    },
  }, { filename });
  return loadedModule.exports;
}

function harness(options = {}) {
  const saved = [], calls = [], usage = [], selections = [], confirmations = [], retrieval = [], reports = [];
  let active = 0, maxActive = 0;
  const signal = options.controller?.signal;
  const model = {
    specificationVersion: "v4", provider: "fixture", modelId: "writer-model", supportedUrls: {},
    async doGenerate(params) {
      calls.push(params);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (options.fail) throw new Error("Writer unavailable");
      options.onGenerate?.();
      return {
        content: [{ type: "text", text: options.output ?? output }],
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
    project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) },
    section: { findMany: async () => [], findFirst: async () => options.badSection ? null : { id: 7 } },
    taskTemplate: { findMany: async () => [] },
    agent: { findFirst: async () => options.badAgent ? null : { id: "agent" } },
  };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (taskRows, commentRows, principal) => {
      assert.equal(principal?.teamScope == null, true);
      return { taskRows, commentRows };
    } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key) => key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG || key === keys.HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG },
    "@/lib/flags/keys": keys,
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
    "@/lib/ai/tools/readAgentGate": { refuseReadAgentToolCall: async () => null },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/tasks/resolveTask": {},
    "@/app/api/ai/chat/stream/bulkTools": {},
    "@/lib/ai/chatStream/errors": errors,
  });
  const create = moduleWithStubs("src/lib/ai/tools/createTask.ts", {
    "@/lib/flags/keys": keys,
    "@/lib/flags": { isFeatureEnabled: async () => false },
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
  return { tool, saved, calls, usage, selections, confirmations, retrieval, reports, run,
    get maxActive() { return maxActive; },
    execute: (input) => tool.execute(tool.inputSchema.parse(input)),
    post: (input) => route.POST({ json: async () => input }),
  };
}

function expectedLegacySchema() {
  return schemas.createTaskItemSchema.partial().extend({
    tasks: z.array(schemas.createTaskItemSchema).max(50).optional().describe("Tasks to create in one call. Prefer this over repeated tool calls."),
    confirmed: z.boolean().optional().describe("Set true ONLY after the user has explicitly approved creating 4 or more tasks in their own message. Never set it to confirm your own proposal."),
  });
}

test("flag off: exact legacy schema, description, single and bulk saved payloads; zero writer calls", async () => {
  const h = harness();
  assert.deepEqual(z.toJSONSchema(h.tool.inputSchema), z.toJSONSchema(expectedLegacySchema()));
  assert.equal(h.tool.description, "Create one or many tasks, up to 50 per call. For multiple tasks, pass tasks with each task's project_id and fields in one call instead of looping. Returns created tasks and per-task failures.");
  const input = { project_id: 15, title: "Supplied title", description: "Supplied **body**", priority: "High", assignee_ids: [42], labels: ["bug"], due_date: "2026-10-20", parent_task_id: 9 };
  const one = await h.execute(input);
  assert.deepEqual(one, { success: true, task: { id: 1, projectId: 15, uniqueIndex: 1, title: input.title }, url: "/detail/project-15/1" });
  assert.deepEqual(h.saved[0], {
    creationChannel: "agent", projectId: 15, title: input.title, description: toStoredHtml(input.description),
    sectionId: 7, sectionTitle: "Inbox", userId: 985, priorityIndex: 2, estimateIndex: 0,
    dueDate: "2026-10-20T00:00:00.000Z", projectUniqueIdentifier: "HTPR", teamId: "team",
    labels: ["bug"], assigneeIds: [42], parentTaskId: 9, agentId: null,
  });
  const bulk = await h.execute({ tasks: [{ project_id: 15, title: "A", priority: "Urgent" }, { project_id: 15, title: "B", priority: "Low" }] });
  assert.equal(bulk.success, true);
  assert.deepEqual(bulk.failures, []);
  for (const [index, title, priorityIndex] of [[1, "A", 1], [2, "B", 4]]) {
    assert.deepEqual(h.saved[index], { creationChannel: "agent", projectId: 15, title, description: "", sectionId: 7, sectionTitle: "Inbox", userId: 985, priorityIndex, estimateIndex: 0, projectUniqueIdentifier: "HTPR", teamId: "team", labels: [], agentId: null });
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.selections.length, 0);
});

test("flag on: real chat tool and CLI handler have identical writer title, body, priority, size and usage", async () => {
  const h = harness({ enabled: true, agentId: "agent" });
  const brief = "  Keep every detail.\nAnd this refinement.  ";
  const schema = z.toJSONSchema(h.tool.inputSchema);
  for (const key of ["title", "description", "priority", "estimate"]) {
    assert.equal(schema.properties[key], undefined);
    assert.equal(schema.properties.tasks.items.properties[key], undefined);
  }
  assert.ok(schema.properties.tasks.items.required.includes("brief"));
  assert.equal((await h.execute({ project_id: 15, brief })).success, true);
  const response = await h.post({ project_id: 15, prompt: brief });
  assert.equal(response.status, 200);
  const cli = await response.json();
  assert.deepEqual({ title: h.saved[0].title, html: h.saved[0].description, priority: h.saved[0].priorityIndex, estimate: h.saved[0].estimateIndex },
    { title: cli.title, html: cli.html, priority: cli.priority, estimate: cli.estimate });
  assert.deepEqual(cli, { success: true, html: "<p>Writer body.</p>", title: "Writer title", priority: 2, estimate: 3, mode: "task_writer", model: "writer-model", provider: "fixture", skills: [] });
  assert.doesNotMatch(h.saved[0].description, /ai-generated|Proposed properties/);
  assert.equal(toStoredHtml(h.saved[0].description), h.saved[0].description);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.usage[0], h.usage[1]);
  assert.deepEqual(h.usage[0], { userId: 985, teamId: "team", projectId: 15, taskId: null, agentId: "agent", provider: "fixture", feature: "task-writer" });
  assert.equal(h.selections[0].taskWriterAgentId, "agent");
  assert.equal(h.retrieval[0].prompt.includes(brief.trim()), true);
  for (const call of h.calls) {
    assert.equal(call.tools, undefined);
    const system = call.prompt.find((message) => message.role === "system").content;
    assert.ok(system.indexOf("=== SKILL 1: web-writing ===") < system.indexOf("=== SKILL 2: unslop ==="));
    assert.ok(call.prompt.find((message) => message.role === "user").content[0].text.endsWith(brief));
  }
});

test("access pair: board member still saves; non-member target board refused before writer spend", async () => {
  const allowed = harness({ enabled: true });
  assert.equal((await allowed.execute({ project_id: 15, brief: "Create it" })).success, true);
  assert.equal(allowed.saved.length, 1);
  const refused = harness({ enabled: true, denied: true });
  const result = await refused.execute({ project_id: 15, brief: "Create it" });
  assert.equal(result.success, false);
  assert.match(result.error, /Not a board member/);
  assert.equal(refused.calls.length, 0);
  assert.equal(refused.selections.length, 0);
  assert.equal(refused.saved.length, 0);
});

test("placement, date, parent, assignee and agent checks all precede writer calls", async () => {
  for (const [options, input] of [
    [{ badSection: true }, { section: "Missing" }], [{ badParent: true }, { parent_task_id: 9 }],
    [{}, { due_date: "bad date" }], [{}, { assignee_ids: [999] }],
    [{ agentId: "agent", badAgent: true }, {}], [{ agentId: "agent", agentNotMember: true }, {}],
  ]) {
    const h = harness({ enabled: true, ...options });
    assert.equal((await h.execute({ project_id: 15, brief: "Create it", ...input })).success, false);
    assert.equal(h.selections.length, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.saved.length, 0);
  }
});

test("writer failure, disabled writer, empty title and empty body never save or fall back", async () => {
  for (const options of [{ fail: true }, { featureDisabled: true }, { output: "<p>No title</p>" }, { output: '<h1 id="ai-generated-task-title">Only title</h1>' }, { output: "" }]) {
    const h = harness({ enabled: true, ...options });
    assert.equal((await h.execute({ project_id: 15, brief: "Full user brief", title: "Never save this", description: "Never save this" })).success, false);
    assert.equal(h.saved.length, 0);
  }
});

test("4+ tasks require cross-message confirmation keyed by target board and full brief before spend", async () => {
  const h = harness({ enabled: true });
  const tasks = Array.from({ length: 4 }, (_, index) => ({ project_id: 15, brief: `Brief ${index}` }));
  for (const confirmed of [false, true]) {
    const result = await h.execute({ tasks, confirmed });
    assert.equal(result.confirmation_required, true);
    assert.deepEqual(result.affected, tasks);
  }
  const key = JSON.parse(h.confirmations[0].operationKey);
  assert.deepEqual(key[1].map((task) => JSON.parse(task.key)), tasks.map((task) => ["project", 15, "brief", task.brief]));
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.length, 0);
});

test("confirmed bulk: at most three simultaneous writer calls; exactly one call and save per task", async () => {
  const h = harness({ enabled: true, confirmed: true });
  const result = await h.execute({ tasks: Array.from({ length: 8 }, (_, index) => ({ project_id: 15, brief: `Brief ${index}` })), confirmed: true });
  assert.equal(result.tasks.length, 8);
  assert.deepEqual(result.failures, []);
  assert.equal(h.calls.length, 8);
  assert.equal(h.saved.length, 8);
  assert.equal(h.maxActive, 3);
});

test("cancellation during generation and save-time access revocation never report a saved task", async () => {
  const controller = new AbortController();
  for (const options of [{ controller, onGenerate: () => controller.abort() }, { saveDenied: true }]) {
    const h = harness({ enabled: true, ...options });
    assert.equal((await h.execute({ project_id: 15, brief: "Create it" })).success, false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.saved.length, 0);
  }
});

test("CLI validation, empty-draft failure, typed permission errors and provider errors keep status and JSON", async () => {
  const invalid = harness();
  const invalidResponse = await invalid.post({ project_id: 15, prompt: "Brief", model: "override" });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /^Invalid request:/);
  assert.equal(invalid.calls.length, 0);
  for (const [options, status, message] of [
    [{ output: "" }, 500, properties.TASK_WRITER_EMPTY_DRAFT_MESSAGE],
    [{ featureDisabled: true }, 403, "This AI feature is turned off for your team"],
    [{ fail: true }, 500, "Writer unavailable"],
  ]) {
    const h = harness(options);
    const response = await h.post({ project_id: 15, prompt: "Brief" });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { success: false, error: message });
  }
});

test("new feature flag is registered as Owner + QA; ordinary tool contexts default off", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7363-chat-task-writer.ts"));
  assert.equal(definition.default.key, keys.HTPR_7363_CHAT_TASK_WRITER_FLAG);
  assert.equal(definition.default.kind, "feature");
  assert.equal(definition.default.defaultMode, "OWNER_AND_QA");
  const { createToolContext } = moduleWithStubs("src/lib/ai/tools/context.ts", {
    "next/server": {}, "@/lib/mcp/agents/create": {}, "@/lib/mcp/agents/revoke": {},
    "@/lib/ai/bulkConfirmation": {}, "@/lib/ai/tools/metadata": {}, "@/lib/ai/tools/helpers": {},
    "./taskAssignees": { createTaskAssigneeMutation: () => ({}) },
  });
  const controller = new AbortController();
  const args = [{ id: 985 }, {}, () => {}, () => {}, null, undefined, undefined];
  assert.equal(createToolContext(...args).chatTaskWriterEnabled, false);
  const enabled = createToolContext(...args, true, controller.signal);
  assert.equal(enabled.chatTaskWriterEnabled, true);
  assert.equal(enabled.abortSignal, controller.signal);
});

test("chat turn resolves the server flag once for the authenticated user and forwards cancellation", async () => {
  const checks = [], toolArgs = [];
  const { runModelTurn } = moduleWithStubs("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/prisma": {},
    "@/lib/flags": { isFeatureEnabled: async (...args) => { checks.push(args); return true; } },
    "@/lib/flags/keys": keys,
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "chat prompt" },
    "@/lib/ai/chatStream/content": { createUserContent: () => "request" },
    "@/lib/ai/tools/metadata": {}, "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: (...args) => { toolArgs.push(args); return {}; } },
    "./modelReply": { generateModelReply: async () => null },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  const providerAbort = new AbortController();
  await runModelTurn({ body: { user_context: { id: 999 } }, dbUser: { id: 985 }, providerAbort, send() {} }, {}, {});
  assert.deepEqual(plain(checks), [[keys.HTPR_7514_INLINE_AGENT_IMAGES_FLAG, 985], [keys.HTPR_7363_CHAT_TASK_WRITER_FLAG, 985]]);
  assert.equal(toolArgs.length, 1);
  assert.equal(toolArgs[0][7], true);
  assert.equal(toolArgs[0][8], providerAbort.signal);
  assert.equal(toolArgs[0][9], true);
});
