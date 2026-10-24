const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");
const { z } = require("zod");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false, interopDefault: true });
const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
const metadata = jiti(path.join(root, "src/lib/ai/taskWriterSkills.ts"));
const registry = jiti(path.join(root, "src/lib/ai/prompts/registry.ts"));
const resolver = jiti(path.join(root, "src/app/api/ai/_lib/skills.ts"));
const flag = "htpr-7319-skill-chat-followup";
const note = "/deeper Retry failed checkout payments.";
const body = "Expose the missing retry boundary; distinguish known facts from assumptions.";
const skill = { id: 18, slug: "deeper", name: "Deeper 深く", updatedAt: new Date("2026-10-21T00:00:00.000Z"), body, projectId: 15, userId: null, enabled: true };
const identities = [{ id: skill.id, slug: skill.slug, name: skill.name, updatedAt: skill.updatedAt.toISOString() }];
const savedDescription = "Do not retry an already-settled payment; retry window undecided.";
const questions = ["Define the retry window", "Prevent duplicate payment settlement"];
const followup = "/deeper (Deeper 深く) supplied a writing template. Observed change: added the settled-payment exclusion.\nConcerns: duplicate settlement.\nIdeas: define the retry boundary.\nQuestions: what is the retry window?";
const task = { id: 43, uniqueIndex: 7319, projectId: 15, sectionId: 7, ticketNumber: "HTPR-7319", title: "Retry checkout", userId: 985, section: "Todo", status: "Normal", project: { teamId: "team", team: { aiProviderSettings: {} } }, description_: { content: savedDescription }, assignees: [], comments: [] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function load(file, mocks = {}, sourceRoot = root) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(sourceRoot, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
    if (id === "@/lib/api/errorMessage") return load("src/lib/api/errorMessage.ts", {});
    if (["./taskWriterSkills", "@/lib/ai/taskWriterSkills"].includes(id)) return metadata;
    if (id === "@/lib/flags/keys") return keys;
    if (id === "@/lib/net/downloadWithoutBrotli") return { downloadWithoutBrotli: undefined };
    if (id === "@/lib/ai/prompts/registry") return registry;
    if (id.startsWith("@/") || id.startsWith(".")) throw new Error(`Unstubbed ${file}: ${id}`);
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

function questionsRoute(options = {}) {
  const calls = [], scopes = [], lookups = [], cacheInputs = [];
  const route = load("src/app/api/ai/task-questions/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ agentId: options.agentId }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, run) => run() },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => { assert.equal(userId, 985); return [flag].includes(key) ? options.enabled !== false : true; } },
    "@/app/api/ai/_lib/skills": { resolveSkills: (text, context, lookup) => resolver.resolveSkills(text, context, lookup ?? (async (slugs, scope) => { lookups.push({ slugs, scope }); return options.skills ?? [skill]; })) },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => options.unauthenticated ? null : ({ id: 985, displayName: "QA" }) },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), configureAiModelUsage() {}, providerOptionsForAiModel: () => ({}), aiUsageProviderForCredential: () => "fixture" },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }), getTeamGatewayApiKey: async () => "fixture" },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, value) => { cacheInputs.push(value); return value.fixed; } },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value, isSessionNoise: () => false },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ model: "fixture", provider: "fixture" }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId, agentId) => ({ viewer: userId, ...(agentId ? { agentId } : {}) }) },
    "@/lib/prisma": { default: { task: { findFirst: async (query) => { scopes.push(query.where); return options.denied ? null : task; } }, comment: { findMany: async () => [] } } },
    "@/lib/errors/reportError": { reportError: async () => {} },
    ai: { Output: { object: (value) => value }, generateText: async (input) => { calls.push(input); return { output: input.output.schema.parse({ questions, followup }) }; }, NoObjectGeneratedError: { isInstance: () => false }, NoOutputGeneratedError: { isInstance: () => false } },
    "next/server": { NextResponse: { json: Response.json } },
  }, process.env.HTPR_7319_ROUTE_ROOT ?? root);
  return { calls, scopes, lookups, cacheInputs, post: (extra = {}, request = {}) => route.POST({ headers: new Headers(), json: async () => ({ taskId: 43, kind: "new-ticket", skillFollowup: { skills: identities, originalInput: note, ...extra }, ...request }) }) };
}

test("route captures authorized skill, cleaned original note and saved ticket in one grounded model call (production red control)", async () => {
  const h = questionsRoute({ agentId: "runner" });
  const response = await h.post({ skills: [{ ...identities[0], name: "UNTRUSTED CLIENT NAME", body: "UNTRUSTED CLIENT BODY" }] });
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 1);
  const input = h.calls[0];
  for (const expected of [body, skill.name, "Retry failed checkout payments.", savedDescription]) assert.ok(input.prompt.includes(expected), expected);
  assert.equal(input.maxOutputTokens, 1800);
  assert.ok(!input.prompt.includes("UNTRUSTED CLIENT"));
  assert.ok(!input.prompt.includes("/deeper Retry"));
  assert.match(input.instructions, /untrusted source data/);
  assert.match(input.instructions, /observed additions or clarifications/);
  assert.match(input.instructions, /Distinguish requested checks from completed checks/);
  assert.match(input.instructions, /Never claim research, tests, external verification/);
  assert.match(input.instructions, /concerns; improvement ideas; follow-up questions/);
  assert.ok(!h.cacheInputs[0].fixed.includes(body));
  assert.deepEqual(h.lookups, [{ slugs: ["deeper"], scope: { userId: 985, projectId: 15 } }]);
  assert.deepEqual(h.scopes[0].project, { viewer: 985, AND: [{ viewer: 985, agentId: "runner" }] });
  assert.deepEqual(await response.json(), { questions, followup });
});

test("route denies unauthorized tasks and rejects deleted, foreign, mismatched or changed skill versions without attribution", async () => {
  for (const config of [{ denied: true }, { unauthenticated: true }, { skills: [] }, { skills: [{ ...skill, projectId: 99 }] }, { skills: [{ ...skill, id: 19 }] }, { skills: [{ ...skill, updatedAt: new Date("2026-10-22T00:00:00.000Z") }] }]) {
    const h = questionsRoute(config);
    const response = await h.post();
    assert.equal(h.calls.length, 0);
    assert.equal(h.lookups.length, config.denied || config.unauthenticated ? 0 : 1);
    assert.equal((await response.json()).followup, undefined);
  }
});

test("route flag off retains the writing-only questions contract and does not resolve skills", async () => {
  const h = questionsRoute({ enabled: false });
  assert.deepEqual(await (await h.post()).json(), { questions });
  assert.equal(h.lookups.length, 0);
  assert.equal(h.calls[0].instructions, registry.renderPrompt("task-questions-writing-1"));
  assert.equal(h.calls[0].maxOutputTokens, 500);
});

test("route without skill context or with next-move kind retains its existing prompt and response", async () => {
  for (const request of [{ skillFollowup: undefined }, { kind: "next-move" }]) {
    const h = questionsRoute();
    assert.deepEqual(await (await h.post({}, request)).json(), { questions });
    assert.equal(h.lookups.length, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].maxOutputTokens, 500);
    assert.ok(!h.calls[0].prompt.includes(body));
    assert.ok(!h.calls[0].prompt.includes(note));
    assert.equal(h.calls[0].instructions, registry.renderPrompt(request.kind ? "task-questions-context-1" : "task-questions-writing-1"));
  }
});

test("route bounds follow-up input and rejects malformed identities before task or model access", async () => {
  for (const extra of [
    { originalInput: "a".repeat(metadata.MAX_SKILL_INPUT_LENGTH + 1) },
    { skills: [] },
    { skills: [{ ...identities[0], slug: "deeper /other" }] },
    { skills: [{ ...identities[0], updatedAt: "not-a-version" }] },
  ]) {
    const h = questionsRoute();
    assert.equal((await h.post(extra)).status, 400);
    assert.deepEqual(h.scopes, []);
    assert.deepEqual(h.lookups, []);
    assert.deepEqual(h.calls, []);
  }
});

function writerPreparation(options = {}) {
  const retrieval = [], parts = [];
  const prompts = jiti(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
  const run = load("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (flag) => [keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG, keys.HTPR_7312_CTRLJ_SKILLS_FLAG].includes(flag) },
    "@/lib/ai/taskWriterDueDate": {}, "@/lib/ai/composeTaskTarget": {},
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/lib/prisma": { default: { project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) }, section: { findMany: async () => [] }, taskTemplate: { findMany: async () => [] } } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (taskRows, commentRows, principal) => {
      assert.equal(principal?.teamScope == null, true);
      return { taskRows, commentRows };
    } },
    "@/app/api/ai/_lib/editorAi": { ...prompts, createTaskWriterPromptParts: (input) => { parts.push(input); return prompts.createTaskWriterPromptParts(input); }, createTaskWriterUserContent: (input) => input, retrieveTaskWriterContext: async (input) => { retrieval.push(input.prompt); return ""; }, selectTaskWriterModel: async () => ({ modelId: "fixture", model: {}, settings: {} }), createDocumentAttachmentSummary: () => "", extractImgSrcs: () => new Set() },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "", createTaskWriterSystemPromptTemplate: () => "Writer rules" },
    "@/app/api/ai/_lib/taskWriterBoardResearch": jiti(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts")),
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, input) => input.fixed + input.suffix },
    "@/app/api/ai/_lib/skills": { resolveSkills: (text, context, lookup) => resolver.resolveSkills(text, context, lookup ?? (async () => options.skills ?? [skill])) },
  });
  return { parts, retrieval, prepare: (text) => run.prepareTaskWriterRun(run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: text, taskDescription: text, userRetrievalTexts: [text], requestKind: "compose-task", invokeSkills: true }), 985) };
}

test("writer uses the real skill body and cleaned note together; unknown and plain notes do not claim invocation", async () => {
  for (const text of [note, "Retry failed checkout payments.", "/unknown Retry checkout"]) {
    const h = writerPreparation();
    const result = await h.prepare(text);
    assert.equal(result.instructions.includes(body), text === note);
    assert.equal(result.composeSkillsEnabled, true);
    assert.equal(result.skills.length, text === note ? 1 : 0);
    if (text === note) {
      assert.match(result.messages[0].content, /Retry failed checkout payments/);
      assert.ok(!result.messages[0].content.includes("/deeper"));
      assert.ok(!h.parts[0].taskDescription.includes("/deeper"));
      assert.deepEqual(h.retrieval, ["Retry failed checkout payments."]);
    }
  }
});

async function writerResponse(options = {}) {
  const calls = [];
  const properties = jiti(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
  const route = load("src/app/api/ai/task-writer/route.ts", {
    "@/lib/ai/taskWriterDueDate": {},
    "@/lib/ai/taskWriterTicketType": {},
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/lib/auth/desktopCliTokenUser": { getDesktopCliTokenUser: async () => null, logDesktopCliAuthorization() {} },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key) => [flag].includes(key) && options.enabled !== false },
    "@/app/api/ai/_lib/taskWriterProperties": properties,
    "@/app/api/ai/_lib/taskWriterRun": { taskWriterRequestSchema: z.object({}).passthrough(), missingRequiredFields: () => false, prepareTaskWriterRun: async () => ({ selected: { model: {}, settings: {} }, instructions: "Writer", messages: [], skills: options.skills ?? [skill], composeSkillsEnabled: options.optedIn !== false, splitTasks: options.json, tasksSchema: z.object({ tasks: z.array(z.object({ title: z.string(), description: z.string() })) }) }), AiFeatureDisabledError: class extends Error {}, AutoDescriptionSuggestionsDisabledError: class extends Error {}, ProjectAccessError: class extends Error {} },
    "@/app/api/ai/_lib/editorAi": { SSE_HEADERS: { "Content-Type": "text/html" }, filterOneImagePass: (text) => ({ emit: text }), createSseErrorResponse: (error, status) => Response.json({ error }, { status }), errorMessage: (error) => error.message, sseFrame: () => "event: error\n" },
    ai: { Output: { object: (value) => value }, generateText: async (input) => { calls.push(input); return { output: { tasks: [{ title: "Retry checkout", description: `<p>${savedDescription}</p>` }] } }; }, streamText: (input) => { calls.push(input); return { textStream: (async function* () { yield `<h1 id="ai-generated-task-title">Retry checkout</h1><p>${savedDescription}</p>`; })(), finishReason: Promise.resolve("stop") }; } },
    "next/server": { NextResponse: { json: Response.json } },
  });
  return route.POST({ json: async () => ({ projectId: 15, requestKind: "compose-task", invokeSkills: true }) });
}

function composeApi(writes = []) {
  return load("src/lib/ai/composeTask.ts", {
    "@/lib/media/inlineAgentImages": { inlineAgentImages: (value) => value, imageEmbeddingOptOut: () => false },
    "@/lib/media/browserRenderableImage": {},
    axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Todo", ranking: "a" } }) } },
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/api/ai/task-writer" },
    "./taskWriterBoardContext": { buildTaskWriterRequestScope: () => ({ projectId: 15 }) },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/utils/aiWriterUtils": jiti(path.join(root, "src/utils/aiWriterUtils.ts")),
    "@/utils/htmlEscape": jiti(path.join(root, "src/utils/htmlEscape.ts")),
    "./taskWriterMedia": { createTaskWriterMediaTokenFactory: () => () => "", extractTaskWriterMedia: (html) => ({ html, media: [] }), restoreTaskWriterMedia: (html) => html, stripTaskWriterMediaTokens: (value) => value },
    "@/lib/createTaskAttachmentUploads": { bindCreateTaskUploads() {} },
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (payload) => { writes.push(payload); return { resposne: { newTask: task } }; } },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {}, "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
    "@/lib/ai/taskWriterTicketType": jiti(path.join(root, "src/lib/ai/taskWriterTicketType.ts")), "@/utils/helperFunctions/describeTaskWriterFailure": {},
  });
}

test("JSON and HTML writer headers round-trip Unicode identities, never bodies or create payload metadata", async () => {
  const dom = new JSDOM("");
  const oldParser = global.DOMParser, oldFetch = global.fetch;
  global.DOMParser = dom.window.DOMParser;
  try {
    for (const json of [true, false]) {
      const response = await writerResponse({ json });
      assert.deepEqual(metadata.readTaskWriterSkills(response.headers.get(metadata.TASK_WRITER_SKILLS_HEADER)), identities);
      assert.ok(!decodeURIComponent(response.headers.get(metadata.TASK_WRITER_SKILLS_HEADER)).includes(body));
      global.fetch = async () => response;
      const writes = [];
      const result = await composeApi(writes).createComposedTask({ text: note, files: [], project: { id: 15 }, userId: 985 });
      assert.equal(result.writerFailed, false);
      assert.deepEqual(result.skills, identities);
      assert.equal(writes.length, 1);
      assert.ok(!JSON.stringify(writes).includes("updatedAt"));
      assert.ok(!writes[0].description.includes("deeper"));
    }
  } finally { global.DOMParser = oldParser; global.fetch = oldFetch; dom.window.close(); }
});

test("writer metadata omits flag-off, non-opted-in, unknown and oversized skills; malformed headers degrade safely", async () => {
  for (const config of [{ enabled: false }, { optedIn: false }, { skills: [] }, { skills: Array.from({ length: 16 }, (_, id) => ({ ...skill, id: id + 1, name: "深".repeat(200) })) }]) {
    for (const json of [true, false]) {
      const response = await writerResponse({ ...config, json });
      assert.equal(response.headers.get(metadata.TASK_WRITER_SKILLS_HEADER), null);
      await response.text();
    }
  }
  for (const header of ["%not-json", "{}", encodeURIComponent('[{"id":1}]'), "a".repeat(4097)]) assert.equal(metadata.readTaskWriterSkills(header), undefined);
  const h = writerPreparation({ skills: [skill, { ...skill, id: 19, slug: "review" }] });
  const prepared = await h.prepare("/deeper /review /deeper Retry checkout");
  assert.deepEqual(prepared.skills.map(({ slug }) => slug), ["deeper", "review"]);
});

test("writer headers preserve every resolved skill in order on both response branches", async () => {
  const skills = [skill, { ...skill, id: 19, slug: "review", name: "Review" }];
  for (const json of [true, false]) {
    const response = await writerResponse({ json, skills });
    assert.deepEqual(metadata.readTaskWriterSkills(response.headers.get(metadata.TASK_WRITER_SKILLS_HEADER)), skills.map(({ id, slug, name, updatedAt }) => ({ id, slug, name, updatedAt: updatedAt.toISOString() })));
    await response.text();
  }
});

async function withCompose(options, check) {
  const dom = new JSDOM("<div id='root'></div>", { url: options.existing ? "https://app.hypertask.ai/detail/project-15/7319" : "https://app.hypertask.ai/project?id=15" });
  const original = ["window", "document", "navigator", "HTMLElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT", "fetch", "setTimeout"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const atoms = Object.fromEntries(["currentProjectAtom", "currentUserAtom", "lastUsedBoardsAtom", "composeTaskChatIntroAtom", "composeTaskSkillFollowupAtom", "composeTaskQuestionsTaskIdAtom", "showAIChatInterfaceAtom", "isAiChatSidebarModeAtom", "aiChatAutoOpenSuppressedAtom", "aiChatNewTicketPathAtom", "aiChatExplicitOpenAtAtom", "dockedChatScopeAtom", "fullScreenChatScopeAtom", "inViewObjectAtom", "taskDetailNonEssentialReadyAtom", "aiChatEditTaskIdAtom"].map((name) => [name, name]));
  const project = { id: 15, title: "Board", uniqueIdentifier: "HTPR" };
  const values = new Map([[atoms.currentProjectAtom, project], [atoms.currentUserAtom, { id: 985, uid: "qa" }], [atoms.lastUsedBoardsAtom, {}], [atoms.taskDetailNonEssentialReadyAtom, true], [atoms.inViewObjectAtom, options.existing ? { taskId: 43, taskProjectId: 15 } : {}]]);
  const subscribers = new Set();
  const introWrites = [], navigations = [], requests = [], persisted = [], sent = [], creations = [];
  const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
  const get = (atom) => values.get(atom) ?? null;
  const set = (atom, next) => { const value = typeof next === "function" ? next(get(atom)) : next; if (atom === atoms.composeTaskChatIntroAtom && value) introWrites.push(value); values.set(atom, value); subscribers.forEach((fn) => fn()); };
  const setters = new Map(Object.values(atoms).map((atom) => [atom, (next) => set(atom, next)]));
  const state = { useRecoilValue: (atom) => React.useSyncExternalStore(subscribe, () => get(atom)), useSetRecoilState: (atom) => setters.get(atom), useRecoilState: (atom) => [React.useSyncExternalStore(subscribe, () => get(atom)), setters.get(atom)] };
  const flags = new Set([keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG, keys.HTPR_7312_CTRLJ_SKILLS_FLAG, keys.HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG, keys.HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG]);
  if (options.enabled !== false) flags.add(flag);
  if (options.paged) flags.add(keys.HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  for (const key of options.extraFlags ?? []) flags.add(key);
  for (const key of options.disabledFlags ?? []) flags.delete(key);
  if (options.batch) flags.add(keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG);
  if (options.existing) flags.add(keys.HTPR_6937_NEW_TASK_WINDOW_FLAG);
  const taskContext = React.createContext(options.existing ? { currentTask: { ...task, title: "", description_: { content: "" } }, setCurrentTask() {}, setDescription() {} } : undefined);
  const mobileContext = React.createContext(false);
  const basic = { "@/lib/state": state, "@/store": atoms, "@/hooks/useFlag": { useFlag: (key) => flags.has(key), useFlagReady: () => true } };
  const api = composeApi();
  let visible = true, history, reactRoot, selectedTask = 43;
  const pending = deferred();
  let expireFollowup;
  const realSetTimeout = global.setTimeout;
  if (options.timeout) global.setTimeout = (callback, delay, ...args) => {
    if (delay === 30000) { expireFollowup = callback; return -7319; }
    return realSetTimeout(callback, delay, ...args);
  };
  const rows = [{ id: "session-43", title: "Chat", userId: 985, taskId: 43, projectId: 15, createdAt: new Date(), updatedAt: new Date(), messages: [] }];
  const response = (data) => ({ data, status: 200, headers: {}, config: {}, statusText: "OK" });
  const wire = load("src/utils/api/ai_chat/aiChatHelpers.ts", { "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) }, "@/lib/constants": { default: {} }, "@/utils/axiosClient": { default: {} } });
  const historyApi = {
    ...wire,
    AI_Chat_API: {
      getAllSessions: async () => response({ success: true, sessions: structuredClone(rows) }),
      getSessionPage: async () => response({ success: true, sessions: rows.map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 })), nextCursor: null }),
      getSessionTranscript: async () => structuredClone(rows[0]),
      createSessionNext: async () => response({ success: true, session: structuredClone(rows[0]) }),
      addMessage: async (_id, message) => { persisted.push(message); const stored = { ...message, id: "server-intro-43" }; rows[0] = { ...rows[0], messages: [stored] }; return response({ message: stored }); },
    },
  };
  const dockedChatScope = load("src/hooks/MultiPages/AIChat/useDockedChatScope.ts", { ...basic, "@/lib/flags/definitions/htpr-7685-chat-follows-board": { HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG: "htpr-7685-chat-follows-board" } });
  const historyMocks = { ...basic, "next/navigation": { usePathname: () => "/detail/project-15/7319" }, "@/utils/api/ai_chat": historyApi, "./useDockedChatScope": dockedChatScope };
  const paged = load("src/hooks/MultiPages/AIChat/usePagedChatHistory.ts", { ...historyMocks, "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null } });
  const { useSessionAndChatHistory } = load("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts", { ...historyMocks, "./usePagedChatHistory": paged });
  const chatContext = { useAiChatContext: () => ({ ...history, chatMounted: true, handleMessageListScroll() {}, registerMessageListRef() {}, scrollMessagesToBottom() {}, isTyping: false, handleSendMessage: (value) => sent.push(value), isDetailPage: true, selectSession() {} }) };
  const { MessageList } = load("src/components/AI_CHAT/MessageList.tsx", { ...basic, "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": chatContext, "./MessageItem": { MessageItem: ({ message }) => React.createElement("div", { "data-message": message.id }, message.content) }, "./TypingIndicator": load("src/components/AI_CHAT/TypingIndicator.tsx") });
  const { WelcomeScreen } = load("src/components/AI_CHAT/WelcomeScreen.tsx", {
    ...basic, "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": chatContext,
    "next/navigation": { usePathname: () => "/detail/project-15/7319" },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false }, "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/hooks/General/useHydrated": { useHydrated: () => true },
    "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
    "@/utils/generateTime": { default: () => "now" },
    "./taskSummaryAction": { taskSummaryActionFor: () => ({ label: "Summarize the current task", prompt: "Summarize" }) },
  });
  const Compose = load("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx", {
    ...basic,
    "@/hooks/General/useKeepAiChatClosed": { useKeepAiChatClosed: () => ({ ready: true, keepAiChatClosed: options.keepClosed ?? false }) },
    "next/navigation": { useRouter: () => ({ push: (url) => { navigations.push(url); visible = false; } }) },
    nookies: { parseCookies: () => ({}) },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext }, "@/lib/contexts/TaskDetail/TaskProvider": { TaskContext: taskContext },
    "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({ fileItems: [], files: [], fileInputRef: { current: null } }) },
    axios: { default: { get: async () => ({ data: { ...task, title: "", description_: { content: "" }, comments: [], attachments: [] } }) } },
    "@/lib/ai/composeTaskTarget": { isEmptyComposeTarget: () => true },
    "@/components/RTE/Components/AudioButton": { default: () => null },
    "@/lib/utils/keyboardShortcuts": { getShortcutDisplay: () => [] },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/components/Common/AttachmentsUpload/ImageGalleryView": { default: () => null },
    "@/components/AI_CHAT/AttachmentButton": { AttachmentButton: () => null },
    "@/components/AI_CHAT/SendMessageButton": { SendMessageButton: (props) => React.createElement("button", { ...props, mobile: undefined, "data-send": "" }, "Send") },
    "@/components/AI_CHAT/AiComposerTextarea": { AiComposerTextarea: React.forwardRef((props, ref) => React.createElement("textarea", { ...props, ref })) },
    "@/components/AI_CHAT/FullScreenChatLoading": { default: () => null },
    "@/components/Common/CommonModalComponents": { HintKey: ({ children }) => children },
    "@/utils/aiChat/extractPastedImageFiles": {},
    "@/lib/ai/composeTask": { ...api, createComposedTask: async (input) => { creations.push(input); return { task, writerFailed: options.writerFailed ?? false, skills: options.noSkill ? undefined : identities, tasks: options.batch ? [task, { ...task, id: 44, uniqueIndex: 7320 }] : [task], failedTitles: [] }; } },
    "@/utils/api/global": { default: {} },
    "@/hooks/MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createTaskGlobally() {} }) },
    "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ updateActiveItemAndItemInView: () => set(atoms.inViewObjectAtom, { taskId: 43, taskProjectId: 15 }) }) },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ updateTaskInCache() {} }) },
    "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: () => ["task-43"] },
    "@/lib/realtime/taskDetailRefresh": { preserveTaskAssigneesChangedDuringFetch: (_current, saved) => saved, refreshTaskDetailQueryCache: async () => {}, shouldPreserveTaskEditorContent: () => false, mergeRealtimeTaskDetail: (_current, saved) => saved },
    "@/lib/ai/composeTaskBoard": {}, "./composeBoardTarget": {},
    "@/components/AI_CHAT/ChatScopeChip": {}, "@/components/Modals/MoveTaskToBoard": {},
    "@/components/PageComponents/TaskDetail/AI Task Writer/useSkillSlashMenu": { useSkillSlashMenu: () => ({ onKeyDown: () => false, onInput() {}, onCaretMove() {}, close() {}, menu: null }) },
    "@/lib/createTaskAttachmentUploads": { discardUnboundCreateTaskUploads() {} },
  }).default;
  global.fetch = async (url, init) => {
    if (url.startsWith("/api/ai-chat/task-sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    const input = JSON.parse(init.body);
    requests.push(input);
    if (input.skillFollowup) return pending.promise;
    return { ok: true, json: async () => ({ questions: ["Generic retry question"] }) };
  };
  function Chat() {
    history = useSessionAndChatHistory(selectedTask, true, options.taskScoped !== false);
    return history.showWelcomeScreen ? React.createElement(WelcomeScreen) : React.createElement(MessageList);
  }
  function Harness() {
    const open = state.useRecoilValue(atoms.showAIChatInterfaceAtom);
    state.useRecoilValue(atoms.inViewObjectAtom);
    return React.createElement(React.Fragment, null,
      visible && React.createElement(Compose, { active: true, onCreated() {}, onBusyChange() {} }),
      (open || options.forceChat) && React.createElement(Chat));
  }
  const render = async () => React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Harness))));
  const flush = async () => { for (let turn = 0; turn < 4; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  try {
    reactRoot = createRoot(document.getElementById("root"));
    await render();
    // Invoke the real textarea handler without depending on React's process-global input-event detection.
    const textarea = document.querySelector("textarea");
    const propsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
    await React.act(async () => textarea[propsKey].onChange({ target: { value: note } }));
    await React.act(async () => document.querySelector("[data-send]").click());
    await render();
    await flush();
    await check({ dom, requests, creations, introWrites, persisted, sent, navigations, client, get, atoms, history: () => history,
      deliver: async (answer = { questions, followup }) => { await React.act(async () => pending.resolve({ ok: true, json: async () => answer })); await flush(); await render(); },
      expire: async () => { await React.act(async () => expireFollowup()); await flush(); await render(); },
      fail: async () => { await React.act(async () => pending.reject(new Error("Unavailable"))); await flush(); await render(); },
      open: async () => { await React.act(async () => set(atoms.showAIChatInterfaceAtom, true)); await flush(); },
      viewOther: async () => { selectedTask = 99; await React.act(async () => set(atoms.inViewObjectAtom, { taskId: 99 })); await render(); },
      reload: async () => { await React.act(async () => reactRoot.unmount()); client.clear(); reactRoot = createRoot(document.getElementById("root")); await render(); await flush(); },
    });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear();
    for (const [key, descriptor] of original) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
}

for (const paged of [false, true]) {
  test(`Compose opens before follow-up resolves with TypingIndicator, survives modal unmount, then persists one escaped intro and cached chips (${paged ? "paged" : "legacy"})`, async () => {
    await withCompose({ paged, extraFlags: [keys.HTPR_7586_ONE_QUESTIONS_CALL_FLAG] }, async (view) => {
      assert.deepEqual(view.navigations, ["/detail/project-15/7319"]);
      assert.equal(view.get(view.atoms.showAIChatInterfaceAtom), true);
      assert.equal(document.querySelector("[data-compose-task-writer]"), null);
      assert.ok(document.querySelector('[aria-label="AI is thinking"]'));
      assert.equal(view.history().showWelcomeScreen, false);
      assert.equal(view.introWrites.length, 0);
      assert.equal(view.persisted.length, 0);
      assert.equal(view.requests.length, 1);
      assert.deepEqual(view.requests[0], { taskId: 43, kind: "new-ticket", skillFollowup: { skills: identities, originalInput: note } });
      await view.deliver({ questions, followup: followup + "\n<img src=x onerror=alert(1)>" });
      assert.equal(view.introWrites.length, 1);
      assert.equal(view.persisted.length, 1);
      assert.equal(view.get(view.atoms.composeTaskSkillFollowupAtom), null);
      assert.match(view.persisted[0].content, /from your note\. Want me to refine it\?/);
      assert.ok(view.persisted[0].content.includes("/deeper"));
      assert.ok(view.persisted[0].content.includes("&lt;img"));
      assert.ok(!view.persisted[0].content.includes("<img"));
      assert.deepEqual(view.client.getQueryData(["task-questions", "new-ticket", 43]), { questions });
      assert.equal(view.requests.length, 1);
      assert.equal(document.querySelectorAll("[data-message]").length, 1);
      assert.equal(document.querySelector("[data-message]").getAttribute("data-message"), "server-intro-43");
      const chips = [...document.querySelectorAll("[data-compose-question]")];
      assert.deepEqual(chips.map((chip) => chip.textContent), questions);
      await React.act(async () => chips[0].click());
      assert.deepEqual(view.sent, [questions[0]]);
      await view.reload();
      assert.equal(view.history().currentSession.messages.length, 1);
      assert.equal(view.history().currentSession.messages[0].content, view.persisted[0].content);
      assert.equal(view.persisted.length, 1);
      const payload = await sendAfterIntro(view.history().currentSession, questions[0]);
      assert.equal(payload.chat_history[0].content, view.persisted[0].content);
      assert.equal(payload.chat_history[0].role, "assistant");
    });
  });
}

test("Compose follow-up error falls back to exactly one generic intro and ordinary questions, never a creation error", async () => {
  await withCompose({}, async (view) => {
    await view.fail();
    assert.equal(view.introWrites.length, 1);
    assert.equal(view.persisted.length, 1);
    assert.ok(!view.persisted[0].content.includes("/deeper"));
    assert.match(view.persisted[0].content, /from your note\. Want me to refine it\?/);
    assert.deepEqual(view.requests.map(({ skillFollowup, ...input }) => skillFollowup ? "followup" : input), ["followup", { taskId: 43, kind: "new-ticket" }]);
    assert.equal(document.querySelector("[role=alert]"), null);
    assert.equal(document.querySelector('[aria-label="AI is thinking"]'), null);
  });
});

test("missing follow-up output restores the normal intro and one ordinary questions fetch", async () => {
  await withCompose({}, async (view) => {
    assert.ok(document.querySelector('[aria-label="AI is thinking"]'));
    await view.deliver({ questions });
    assert.equal(view.introWrites.length, 1);
    assert.equal(view.persisted.length, 1);
    assert.ok(!view.persisted[0].content.includes("/deeper"));
    assert.equal(view.requests.length, 2);
    assert.equal(view.get(view.atoms.composeTaskSkillFollowupAtom), null);
    assert.equal(document.querySelector("[role=alert]"), null);
  });
});

test("skill generation suppresses competing questions even with both questions-call bugfix flags off", async () => {
  await withCompose({ disabledFlags: [keys.HTPR_7586_ONE_QUESTIONS_CALL_FLAG, keys.HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG] }, async (view) => {
    assert.equal(view.requests.length, 1);
    assert.ok(document.querySelector('[aria-label="AI is thinking"]'));
    assert.equal(view.introWrites.length, 0);
    await view.deliver();
    assert.equal(view.requests.length, 1);
    assert.equal(view.persisted.length, 1);
  });
});

test("pending skill generation and intro do not replace a non-task-scoped welcome or persist into it", async () => {
  await withCompose({ taskScoped: false }, async (view) => {
    assert.equal(view.history().showWelcomeScreen, true);
    assert.equal(view.persisted.length, 0);
    await view.deliver();
    assert.equal(view.history().showWelcomeScreen, true);
    assert.equal(view.persisted.length, 0);
    assert.equal(view.get(view.atoms.composeTaskChatIntroAtom).taskId, 43);
  });
});

for (const options of [{ enabled: false }, { noSkill: true }, { writerFailed: true }]) {
  test(`Compose retains today's generic flow without follow-up for ${JSON.stringify(options)}`, async () => {
    await withCompose(options, async (view) => {
      assert.equal(view.navigations.length, 1);
      assert.equal(view.introWrites.length, 1);
      assert.equal(view.persisted.length, 1);
      assert.ok(!view.requests.some((input) => input.skillFollowup));
      assert.equal(view.get(view.atoms.composeTaskSkillFollowupAtom), null);
      assert.ok(!view.persisted[0].content.includes("/deeper"));
    });
  });
}

for (const paged of [false, true]) {
  test(`keep-chat-closed still generates the first intro; opening later persists it once (${paged ? "paged" : "legacy"})`, async () => {
    await withCompose({ keepClosed: true, paged }, async (view) => {
      assert.equal(view.get(view.atoms.showAIChatInterfaceAtom), null);
      assert.equal(view.navigations.length, 1);
      await view.deliver();
      assert.equal(view.persisted.length, 0);
      assert.equal(view.introWrites.length, 1);
      await view.open();
      assert.equal(view.persisted.length, 1);
      assert.ok(view.persisted[0].content.includes("/deeper"));
      assert.equal(view.requests.length, 1);
    });
  });
}

test("skill intro still lands when ordinary ticket-question chips are disabled", async () => {
  await withCompose({ disabledFlags: [keys.HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG] }, async (view) => {
    assert.equal(view.requests.length, 1);
    assert.ok(document.querySelector('[aria-label="AI is thinking"]'));
    await view.deliver();
    assert.equal(view.persisted.length, 1);
    assert.ok(view.persisted[0].content.includes("/deeper"));
    assert.equal(document.querySelectorAll("[data-compose-question]").length, 0);
    assert.equal(view.requests.length, 1);
  });
});

test("split Compose enriches only the primary ticket and retains batch links without adding chips", async () => {
  await withCompose({ batch: true }, async (view) => {
    assert.equal(view.requests.length, 1);
    assert.equal(view.requests[0].taskId, 43);
    await view.deliver();
    assert.equal(view.persisted.length, 1);
    assert.match(view.persisted[0].content, /I created 2 tickets/);
    assert.match(view.persisted[0].content, /project-15\/7320/);
    assert.ok(view.persisted[0].content.includes("Concerns: duplicate settlement"));
    assert.equal(document.querySelectorAll("[data-compose-question]").length, 0);
    assert.equal(view.requests.length, 1);
  });
});

test("filling an empty existing ticket gets the same one-message follow-up", async () => {
  await withCompose({ existing: true }, async (view) => {
    assert.equal(view.creations[0].existingTaskId, 43);
    await view.deliver();
    assert.equal(view.persisted.length, 1);
    assert.match(view.persisted[0].content, /I filled in HTPR-7319/);
    assert.ok(view.persisted[0].content.includes("/deeper"));
  });
});

test("a pending follow-up does not show a typing indicator on another viewed ticket", async () => {
  await withCompose({}, async (view) => {
    await view.viewOther();
    assert.equal(document.querySelector('[aria-label="AI is thinking"]'), null);
    await view.deliver();
    assert.equal(view.persisted.length, 0);
    assert.equal(view.get(view.atoms.composeTaskChatIntroAtom).taskId, 43);
    assert.equal(view.client.getQueryData(["task-questions", "new-ticket", 99]), undefined);
  });
});

test("bounded timeout aborts generation and ignores late completion; input and response validation degrade safely", async (t) => {
  const api = composeApi();
  const oldFetch = global.fetch;
  let signal;
  const late = deferred();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    global.fetch = async (_url, init) => { signal = init.signal; assert.equal(JSON.parse(init.body).skillFollowup.originalInput.length, metadata.MAX_SKILL_INPUT_LENGTH); return late.promise; };
    const result = api.requestComposeSkillFollowup(43, identities, "a".repeat(15000));
    t.mock.timers.tick(30000);
    assert.equal(await result, null);
    assert.equal(signal.aborted, true);
    late.resolve({ ok: true, json: async () => ({ questions, followup }) });
    for (const answer of [{ questions }, { followup, questions: [1] }, { followup: "", questions }, { followup: "a".repeat(12001), questions }]) {
      global.fetch = async () => ({ ok: true, json: async () => answer });
      assert.equal(await api.requestComposeSkillFollowup(43, identities, note), null);
    }
  } finally { global.fetch = oldFetch; t.mock.timers.reset(); }
});

test("flag definition and generated registry use the designed Owner + QA rollout and risk metadata", () => {
  const mod = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  const definition = mod.default ?? mod;
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.deepEqual(definition.related, ["htpr-7312-ctrlj-skills", "htpr-7317-ctrlj-ticket-questions"]);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.trim());
  assert.equal(keys.HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, flag);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => [flag].includes(key)), definition);
});

async function sendAfterIntro(session, question) {
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
    "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
    "./aiChatStream": { consumeAiChatStream: async () => {} },
    "react-hot-toast": { default: { error: assert.fail } },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/aiChat/streamRefusal": {},
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/lib/aiChat/transportRetry": {},
    "@/lib/aiModelOptions": { chatModelRequestFields: load("src/lib/aiModelOptions.ts").chatModelRequestFields },
  });
  const ref = () => ({ current: null });
  const noop = () => {};
  const oldFetch = global.fetch;
  let payload;
  global.fetch = async (_url, init) => { payload = JSON.parse(init.body); return { ok: true, body: {} }; };
  try {
    const sender = createAiChatSend({
      sessionIntentGenerationRef: { current: 0 },
      sessionPagingEnabled: true, getDisplayedSession: () => session, isByokBlocked: false, isTyping: false,
      fileUpload: { fileItems: [], clearFiles: noop }, messageQueueRef: { current: [] }, sendInFlightRef: { current: false },
      surface: "task_detail", inViewObject: { taskId: 43 }, waitForChatSession: async () => session,
      currentProject: { id: 15 }, processAttachments: async () => [], setIsTyping: noop, addMessageToSessionQuery: noop,
      scopedProjectId: 15, isFullScreenChat: false, taskId: 43, modelTeamId: "team", contextList: [],
      currentAiOption: { id: "fixture", model: "fixture", source: "fixture" }, ticketScopeSelected: true,
      pathname: "/detail/project-15/7319", currentUser: { id: 985 }, billing: {}, isDemo: false,
      streamingSessionRef: ref(), streamingAssistantMessageRef: ref(), streamingRequestRef: ref(),
      setCurrentStreamingSession: noop, chatRoute: "/api/ai/chat", setAgentStatus: noop,
      updateSessionTitle: noop, queryClient: {}, updateLastMessageInSessionCache: noop, appendMessageToSessionCache: noop,
      drainQueuedMessage: noop, handleSendMessageRef: ref(),
    });
    assert.equal(await sender.handleSendMessage(question), true);
    return payload;
  } finally { global.fetch = oldFetch; }
}

test("Compose timeout queues one generic intro, resumes normal questions and never replaces it with a late follow-up", async () => {
  await withCompose({ timeout: true }, async (view) => {
    assert.ok(document.querySelector('[aria-label="AI is thinking"]'));
    await view.expire();
    assert.equal(view.introWrites.length, 1);
    assert.equal(view.persisted.length, 1);
    assert.ok(!view.persisted[0].content.includes("/deeper"));
    assert.equal(view.requests.length, 2);
    await view.deliver();
    assert.equal(view.introWrites.length, 1);
    assert.equal(view.persisted.length, 1);
    assert.equal(document.querySelector("[role=alert]"), null);
  });
});

test("client discards writer metadata on HTTP, stream or parse failure; invalid metadata never fails a successful save", async () => {
  const oldFetch = global.fetch, oldParser = global.DOMParser;
  const dom = new JSDOM("");
  global.DOMParser = dom.window.DOMParser;
  try {
    const header = metadata.encodeTaskWriterSkills(identities);
    for (const response of [
      new Response("Unavailable", { status: 500, headers: { [metadata.TASK_WRITER_SKILLS_HEADER]: header } }),
      new Response("event: error\ndata: interrupted", { headers: { [metadata.TASK_WRITER_SKILLS_HEADER]: header } }),
      Response.json({ tasks: [{ title: "Incomplete" }] }, { headers: { [metadata.TASK_WRITER_SKILLS_HEADER]: header } }),
    ]) {
      global.fetch = async () => response;
      const writes = [];
      const result = await composeApi(writes).createComposedTask({ text: note, files: [], project: { id: 15 }, userId: 985 });
      assert.equal(result.writerFailed, true);
      assert.equal(result.skills, undefined);
      assert.equal(writes[0].title, note);
    }
    global.fetch = async () => new Response('<h1 id="ai-generated-task-title">Retry checkout</h1><p>Retry boundary</p>', { headers: { [metadata.TASK_WRITER_SKILLS_HEADER]: "%malformed" } });
    const result = await composeApi().createComposedTask({ text: note, files: [], project: { id: 15 }, userId: 985 });
    assert.equal(result.writerFailed, false);
    assert.equal(result.skills, undefined);
  } finally { global.fetch = oldFetch; global.DOMParser = oldParser; dom.window.close(); }
});
