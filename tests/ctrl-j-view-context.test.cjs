const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./helpers/create-view-context.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-6999-ctrl-j-view-context";
const emptyFilters = { addedFilters: [], matchFilters: "ALL" };
const constants = load("src/lib/constants/constants.ts", {
  "../configs/general.config": { generalConfig: {} },
  "@/lib/aiModelOptions": { aiModelOptions: [], defaultAiModelOption: {} },
});
const viewHelpers = load("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", {
  "@/lib/firstScreen/boardView": {}, "@/models/Views/model": {},
  "@/utils/helperFunctions/helperFunctions": { deepCopy: structuredClone },
  "./FilterHelperFunctions": { defaultFilterSettings: emptyFilters },
  "@/utils/sortByParam": {}, "./TableColumnsHelperFunctions": {},
  "./SubtaskHelperFunction": {}, "./EmptySectionsHelperFunction": {}, "@/lib/sectionAutoAssign": {},
});
const viewDefaults = load("src/utils/helperFunctions/Views/NewTaskViewDefaults.ts", {
  "@/lib/constants/constants": constants,
});
const labels = [{ id: "11111111-1111-4111-8111-111111111111", value: "Urgent" }];
const assignees = [
  { id: 42, uid: "human-42", displayName: "Member" },
  { id: "33333333-3333-4333-8333-333333333333", displayName: "Agent", userId: 42, revokedAt: null },
];
const priority = constants.PriorityConstants.find(value => value.priority_index === 2);
const estimate = constants.EstimateConstants.find(value => value.estimate_index === 4);
const filters = entries => ({ matchFilters: "ALL", addedFilters: Object.entries(entries).map(([type, searchPayload]) => ({ type, searchPayload, match: "ALL" })) });
const allFilters = () => filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] });
const project = (activeFilters = allFilters(), id = 15) => ({
  id, uniqueIdentifier: "HTPR", project_view: { user_project_views: [{ appliedView: { board_filters: activeFilters } }] },
});
const writerPath = "src/components/Modals/commands/HTC/ComposeTaskWriter.tsx";
const writerSource = ts.createSourceFile(writerPath, fs.readFileSync(path.join(root, writerPath), "utf8"), ts.ScriptTarget.Latest, true);
function initializer(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(writerSource) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(writerSource);
  assert.ok(result, `${name} must exist`);
  return result.getText(writerSource);
}
function evaluate(expression, context) {
  const compiled = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}
function composer() {
  const creates = [], writes = [];
  let helperCalls = 0;
  const api = load("src/lib/ai/composeTask.ts", {
    "@/lib/media/browserRenderableImage": { isBrowserRenderableImage: () => false },
    axios: { default: { get: async () => ({ data: { sectionId: 12, section: "Todo", ranking: "a" } }) } },
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/api/ai/task-writer" },
    "./taskWriterBoardContext": { buildTaskWriterRequestScope: board => ({ projectId: board.id }) },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/utils/aiWriterUtils": { extractTitleAndDescription: () => ({ title: "AI title", description: "<p>AI body</p>" }) },
    "@/utils/htmlEscape": { escapeHtml: value => value },
    "./taskWriterMedia": { extractTaskWriterMedia: html => ({ html, media: [] }), createTaskWriterMediaTokenFactory() {}, restoreTaskWriterMedia: html => html },
    "@/lib/createTaskAttachmentUploads": { bindCreateTaskUploads() {} },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": viewHelpers,
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": {
      getNewTaskViewDefaults: activeFilters => { helperCalls++; return viewDefaults.getNewTaskViewDefaults(activeFilters); },
    },
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async body => {
      creates.push(body);
      return { resposne: { newTask: { id: 91, projectId: body.projectId, sectionId: body.sectionId } } };
    } },
  });
  return { ...api, creates, writes, get helperCalls() { return helperCalls; } };
}
async function withComposer(check, { writerFails = false } = {}) {
  const original = global.fetch;
  const api = composer();
  global.fetch = async (url, options) => {
    api.writes.push({ url, body: JSON.parse(options.body) });
    return { ok: !writerFails, text: async () => "<h1>AI title</h1><p>AI body</p>" };
  };
  try { await check(api); } finally { global.fetch = original; }
}
async function send(api, { flag = true, currentProject = project(), destinationProject, pathname = "/project", existingTaskId } = {}) {
  const mounted = { current: true };
  const calls = [];
  const context = {
    enabled: true, sending: { current: false }, pendingImages: { current: 0 }, dictating: false,
    text: "Describe this task", files: [], showProgress: false, composer: { current: null },
    setWritingHeight() {}, setWriting() {}, setStage() {}, onBusyChange() {}, setError(error) { if (error) throw new Error(error); },
    taskContextRef: { current: null }, newTaskWindow: Boolean(existingTaskId), destinationProject,
    window: { location: { pathname, href: `https://app.hypertask.ai${pathname}${pathname === "/project" ? "?id=15" : ""}` } },
    inView: existingTaskId ? { taskId: existingTaskId } : null,
    axios: { get: async () => ({ data: { id: existingTaskId, projectId: 15, uniqueIndex: 1 } }) },
    isEmptyComposeTarget: () => true, composeTaskBoardId: api.composeTaskBoardId,
    parseCookies: () => ({ previousBoard: "project-15|&|todo" }), lastUsedBoards: {},
    user: { id: 985 }, currentProject, globalAPIHandlers: { getAllProjectsMinimal: async () => [project()] }, mounted,
    createComposedTask: async body => {
      calls.push(body);
      const result = await api.createComposedTask(body);
      mounted.current = false;
      return result;
    },
  };
  context.viewContextEnabled = evaluate(initializer("viewContextEnabled"), {
    useFlag: key => { assert.equal(key, flagKey); return flag; },
    HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG: flagKey,
  });
  await evaluate(initializer("send"), context)();
  return calls;
}
const legacyBody = (boardId = 15, existingTaskId) => ({
  userId: 985, projectId: boardId, projectIdentifier: "HTPR", title: "AI title", description: "<p>AI body</p>",
  sectionId: existingTaskId ? undefined : 12, section_title: existingTaskId ? undefined : "Todo",
  ranking: existingTaskId ? undefined : "a", assignees: [], requestKind: "compose-task",
  ...(existingTaskId ? { existingTaskId } : {}),
});

test("same-board new ticket inherits all active view defaults through the actual composer send", async () => {
  await withComposer(async api => {
    await send(api);
    assert.deepEqual(api.creates[0], { ...legacyBody(), tags: labels, assignees, priority, estimate });
    assert.equal(api.helperCalls, 1);
    assert.equal(api.writes[0].body.requestKind, "compose-task");
    assert.equal(api.writes[0].body.viewProject, undefined, "raw view context never goes to the AI server");
  });
});

test("explicit user or AI values win, and labels and human/agent assignees merge by ID", async () => {
  await withComposer(async api => {
    const fields = {
      tags: [{ ...labels[0], value: "Explicit label" }, { id: "22222222-2222-4222-8222-222222222222", value: "Caller" }],
      assignees: [{ ...assignees[0], displayName: "Explicit member" }, { id: 43, uid: "human-43" }],
      priority: constants.PriorityConstants.find(value => value.priority_index === 1),
      estimate: constants.EstimateConstants.find(value => value.estimate_index === 2),
    };
    const before = structuredClone(fields);
    const viewOnlyLabel = { id: "44444444-4444-4444-8444-444444444444", value: "View only" };
    const board = project(filters({ Labels: [...labels, viewOnlyLabel], Assignees: assignees, Priority: [priority], Size: [estimate] }));
    await api.createComposedTask({ text: "note", files: [], project: board, viewProject: board, userId: 985, fields });
    assert.deepEqual(api.creates[0].tags, [...fields.tags, viewOnlyLabel]);
    assert.deepEqual(api.creates[0].assignees, [...fields.assignees, assignees[1]]);
    assert.equal(api.creates[0].priority, fields.priority);
    assert.equal(api.creates[0].estimate, fields.estimate);
    assert.deepEqual(fields, before, "caller selections are not mutated");
  });
});

test("explicit no-priority and no-size choices are not replaced", async () => {
  await withComposer(async api => {
    const fields = { priority: constants.PriorityConstants[0], estimate: constants.EstimateConstants[0] };
    await api.createComposedTask({ text: "note", files: [], project: project(), viewProject: project(), userId: 985, fields });
    assert.equal(api.creates[0].priority, fields.priority);
    assert.equal(api.creates[0].estimate, fields.estimate);
  });
});

for (const [name, config] of [
  ["other-board destination", { destinationProject: project(allFilters(), 16) }],
  ["fill-existing", { pathname: "/detail/project-15/1", existingTaskId: 91 }],
  ["no view", { currentProject: { id: 15, uniqueIdentifier: "HTPR" } }],
  ["empty filters", { currentProject: project(emptyFilters) }],
  ["flag off", { flag: false }],
  ["stale board context outside a board", { pathname: "/inbox" }],
]) {
  test(`${name} preserves today's create payload byte for byte`, async () => {
    await withComposer(async api => {
      await send(api, config);
      const expected = legacyBody(config.destinationProject?.id ?? 15, config.existingTaskId);
      assert.equal(JSON.stringify(api.creates[0]), JSON.stringify(expected));
      assert.equal(api.helperCalls, 0);
    });
  });
}

test("fill-existing never applies defaults even if view context reaches the create helper", async () => {
  await withComposer(async api => {
    await api.createComposedTask({ text: "note", files: [], project: project(), viewProject: project(), userId: 985, existingTaskId: 91 });
    assert.deepEqual(api.creates[0], legacyBody(15, 91));
    assert.equal(api.helperCalls, 0);
  });
});

test("exclude-match filters and placeholders do not become task fields", async () => {
  await withComposer(async api => {
    const activeFilters = allFilters();
    activeFilters.addedFilters.forEach(filter => { filter.match = "NONE"; });
    activeFilters.addedFilters[0] = { type: "Labels", match: "ALL", searchPayload: [{ id: "no-label" }] };
    activeFilters.addedFilters[1] = { type: "Assignees", match: "ALL", searchPayload: [{ id: "unassigned" }] };
    await send(api, { currentProject: project(activeFilters) });
    assert.deepEqual(api.creates[0], legacyBody());
  });
});

test("existing create validation rejects foreign labels, users and agents before writes", async () => {
  for (const invalid of ["label", "user", "agent", null]) {
    const handler = load("src/pages/api/tasks/createGlobally.ts", {
      "@/lib/api/task-writes/route": { withTaskWriteFlag: handler => handler },
      "@/lib/api/task-writes/create-global-effects": {
        isAgentAssignee: person => typeof person.id === "string", getActiveAgentOwnerId: async () => 42,
      },
      "@/lib/ai/composeTaskTarget": {}, "@prisma/client": {},
      "@/lib/flags": { isFeatureEnabled: async () => true }, "@/utils/generateRank": {},
      "@/lib/prisma": { default: {
        user: { findUnique: async () => ({ id: 985 }) }, project: { findFirst: async () => ({ id: 15 }) },
        label: { findMany: async ({ where }) => {
          assert.equal(where.projectId, 15);
          assert.deepEqual(where.id.in, labels.map(label => label.id));
          return invalid === "label" ? [] : labels;
        } },
      } },
      "@/utils/controllers/tasks/getNextUniqueTaskIndex": {},
      "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: () => assert.fail("validation must finish before writes") },
      "@/lib/mcp/webhooks/outbox": {}, "@/lib/agentWebhooks/outbox": {},
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
      "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
      "@/lib/auth/session": { SESSION_COOKIE: "session", verifySession: () => null },
      "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
      "@/lib/mcp/tasks/services": { validateProjectMemberIds: async (projectId, ids) => {
        assert.equal(projectId, 15);
        assert.deepEqual(ids, [42, 42]);
        return { invalidIds: invalid === "user" ? [42] : [] };
      } },
      "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async (projectId, agentId) => {
        assert.equal(projectId, 15);
        assert.equal(agentId, assignees[1].id);
        return invalid !== "agent";
      } },
    }).default;
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: "POST", headers: {}, cookies: {}, body: {
      ...legacyBody(), tags: labels, assignees, priority, estimate, sectionId: 0,
    } }, response);
    assert.equal(response.code, 400);
    assert.match(response.body.message, invalid === "label" ? /labels do not belong/ :
      invalid === "user" ? /not members/ : invalid === "agent" ? /Agent is not a member/ : /Invalid section/);
  }
});

test("active unsaved filters override the saved view, and writer fallback retains view defaults", async () => {
  await withComposer(async api => {
    const board = project();
    board.project_view.user_project_views[0].unsavedView = { board_filters: filters({ Size: [estimate] }) };
    await send(api, { currentProject: board });
    assert.equal(api.creates[0].title, "Describe this task");
    assert.equal(api.creates[0].estimate, estimate);
    assert.equal(api.creates[0].tags, undefined);
    assert.deepEqual(api.creates[0].assignees, []);
    assert.equal(api.creates[0].priority, undefined);
  }, { writerFails: true });
});
