const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { load } = require("./task-route-loader.cjs");
const { access, matches, hydrate, enforcedScope } = require("./helpers/agent-board-scope.cjs");

const FLAG = "htpr-7699-desktop-cli-token";
const TEST_SIGNING_KEY = ["desktop", "7699", "test", "signing", "key", "0000000000"].join("-");
process.env["JWT_" + "SECRET"] = TEST_SIGNING_KEY;
process.env.JWT_ISSUER = "hypertask";
process.env.JWT_OAUTH_AUDIENCE = "https://mcp.hypertask.ai";
const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const member = { id: 985, email: "member@example.test", displayName: "Member" };
const outsider = { id: 77, email: "outsider@example.test", displayName: "Outsider" };
const agentId = "44444444-4444-4444-8444-444444444444";
const output = "<h1>Draft</h1><p>Expected task description</p>";

function harness() {
  const state = { cookieId: null, cookieAgentId: undefined, cookieTeamScope: null, mode: "EVERYONE", flagError: false, revocationError: false, revoked: new Set(), split: false, feature: true, providerError: null };
  const users = [owner, member, outsider].map(user => ({ ...user, mcpTokensRevokedAt: null }));
  const projects = [15, 16, 99].map(id => ({
    id, ownerId: id === 99 ? outsider.id : owner.id, status: "Normal", title: `Board ${id}`, uniqueIdentifier: `B${id}`,
    owner: id === 99 ? outsider : owner, members: id === 99 ? [] : [{ userId: member.id, agentId: null, user: member }],
    section: [], labels: [],
  }));
  const sections = projects.map(project => ({ id: project.id, projectId: project.id, section_title: "Todo", ranking: "A0100", visibility: true, deleted: false }));
  const tasks = projects.map(project => ({ id: project.id * 10, projectId: project.id, project, title: `Task ${project.id}`, ranking: "A0200", status: "Normal", deletedAt: null, updatedAt: new Date(), uniqueIndex: 1, sectionId: project.id, description_: { content: "" } }));
  const comments = tasks.map(task => ({ id: task.id * 10, taskId: task.id, task }));
  const pages = projects.map(project => ({ projectId: project.id, project, publicId: `page-${project.id}`, title: "Board notes", archived: false, taskId: project.id * 10, task: tasks.find(task => task.projectId === project.id) }));
  const calls = { protected: [], access: [], flags: [], usage: [], provider: [], retrieval: [], locks: [], writes: [], savedWhere: [], searches: [], agents: [], auth: [] };
  const saved = [];
  const repository = (name, rows) => ({
    findFirst: async (args) => { calls.protected.push({ name, ...args }); return hydrate(rows.find(row => matches(row, args.where)), args); },
    findMany: async (args) => { calls.protected.push({ name, ...args }); return rows.filter(row => matches(row, args.where)).slice(0, args.take ?? rows.length).map(row => hydrate(row, args)); },
  });
  const prisma = {
    user: {
      findUnique: async ({ where }) => { calls.auth.push(where.id); return users.find(user => user.id === where.id) ?? null; },
      findFirst: async ({ where }) => where.id === 332 ? { id: 332, displayName: "HyperAI" } : users.find(user => user.email === where.email) ?? null,
    },
    revokedToken: { findFirst: async ({ where }) => {
      if (state.revocationError) throw new Error("revocation store unavailable");
      const match = where.jti.in.find(jti => state.revoked.has(`${where.user_id}:${jti}`));
      return match ? { jti: match } : null;
    } },
    oAuthClient: { findUnique: async ({ where }) => where.client_id === "desktop-client" ? { client_id: where.client_id } : null },
    project: repository("project", projects), task: repository("task", tasks), section: repository("section", sections), comment: repository("comment", comments), page: repository("page", pages),
    taskTemplate: repository("template", []),
  };
  const tx = { savedContent: {
    findFirst: async ({ where }) => { calls.savedWhere.push(where); return saved.find(row => matches(row, where)) ?? null; },
    deleteMany: async ({ where }) => { calls.writes.push({ action: "delete", where }); for (let i = saved.length - 1; i >= 0; i--) if (matches(saved[i], where)) saved.splice(i, 1); },
    create: async ({ data }) => { calls.writes.push({ action: "create", data }); const row = { id: `saved-${saved.length}`, ...data }; saved.push(row); return row; },
  } };
  const predicates = Object.fromEntries(["projectContentAccessWhere", "taskWriteAccessWhere"].map(name => [name, (...args) => {
    calls.access.push({ name, args });
    return access[name](...args);
  }]));
  const editor = {
    getCurrentUserFromCookies: async () => users.find(user => user.id === state.cookieId) ?? null,
    errorMessage: error => error.message,
    createSseErrorResponse: (error, status) => new Response(`event: error\ndata: ${JSON.stringify({ error })}\n\n`, { status, headers: { "content-type": "text/event-stream" } }),
    SSE_HEADERS: { "content-type": "text/event-stream" }, sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    filterOneImagePass: text => ({ emit: text, leftover: "" }),
    createDocumentAttachmentSummary: () => "", createTaskAuthoringStyle: () => "Style", TASK_AUTHORING_STYLE: "Style", TASK_AUTHORING_WEB_STYLE: "Style",
    createTaskWriterPromptParts: ({ input }) => ({ instructions: "Instructions", input }), createTaskWriterUserContent: text => text,
    extractImgSrcs: () => null,
    retrieveTaskWriterContext: async args => { calls.retrieval.push(args); return "Authorized context"; },
    selectTaskWriterModel: async args => { calls.provider.push(args); if (state.providerError) throw state.providerError; return { model: {}, modelId: "fixture", usageProvider: "fixture", teamId: "team" }; },
  };
  const flags = {
    HTPR_7699_DESKTOP_CLI_TOKEN_FLAG: FLAG,
    HTPR_6937_NEW_TASK_WINDOW_FLAG: "existing-target", HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose", HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG: "split",
    isFeatureEnabled: async (key, id) => {
      calls.flags.push({ key, id });
      if (key === FLAG) {
        if (state.flagError) throw new Error("flag store unavailable");
        return state.mode === "EVERYONE" || (state.mode === "OWNER_AND_QA" && [owner.id, member.id].includes(id));
      }
      return key === "existing-target" || key === "compose" || (key === "split" && state.split);
    },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": flags,
    "@/lib/flags/keys": { HTPR_7312_CTRLJ_SKILLS_FLAG: "skills", HTPR_7513_WRITER_PROJECT_LABELS_FLAG: "labels" },
    "@/lib/auth/agentScope": enforcedScope,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.cookieId == null ? null : { userId: state.cookieId, agentId: state.cookieAgentId, teamScope: state.cookieTeamScope, source: "better-auth" } },
    "@/utils/controllers/logs/createLog": { default: async () => null },
    "@/lib/mcp/managementKeyTeamScope": {},
    "@/utils/controllers/projects/getAllIncludes": predicates,
    "@/app/api/ai/_lib/editorAi": editor,
    "@/lib/net/downloadWithoutBrotli": {},
    "@/lib/media/inlineAgentImages.server": {},
    "@/utils/controllers/tasks/parentTaskAccess": {},
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": {},
    "@/lib/mcp/webhooks/taskEvents": {},
    "@/lib/mcp/webhooks/outbox": {},
    "@/lib/agentWebhooks/outbox": {},
    "@/lib/telemetry/savedWork": {},
    "./create-global-effects": {},
    "@/lib/realtime/server": {},
    "@/utils/controllers/tasks/create": {},
    "./create-fullscreen": {},
    "@/lib/api/task-writes/create-fullscreen": {},
    "@/lib/auth/sessionUserRecord": {},
    "@/pages/api/queues/taskDeleteQueue": {},
    "@/pages/api/queues/tasks/taskDeleteReminder": {},
    "@/lib/mcp/tasks/agentMutationFence": {},
    "@/lib/errors/reportError": { reportError: async () => null },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage: (_model, usage) => calls.usage.push(usage) },
    "@/app/api/ai/_lib/currentTaskContext": {
      loadCurrentTaskContext: async (ids, userId, agentId, scope) => { calls.retrieval.push({ ids, userId, agentId, ...scope }); return ""; },
      resolveAiUsageTaskId: async args => { calls.retrieval.push(args); return null; },
    },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "Context", createTaskWriterSystemPromptTemplate: text => text },
    "@/app/api/ai/_lib/taskWriterBoardResearch": { buildTaskWriterRetrievalQuery: ({ prompt }) => prompt, formatRelatedTicketCandidates: () => "", formatStyleExamples: () => "", formatBoardVocabulary: () => "", TASK_WRITER_RELATED_CANDIDATE_LIMIT: 5 },
    "@/app/api/ai/_lib/skills": { resolveSkills: async text => ({ cleanedText: text, skills: [] }) },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => state.feature },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 5 },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (_tasks, _comments, principal) => { calls.retrieval.push(principal); return { taskRows: [] }; } },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, { fixed }) => fixed },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "ai": {
      streamText: () => { calls.provider.push("stream"); return { textStream: (async function* () { yield output; })() }; },
      generateText: async () => { calls.provider.push("generate"); return { output: { tasks: [{ title: "Draft", description: output }] } }; }, Output: { object: value => value },
    },
    "@/utils/generateRank": { default: (before, after) => `rank:${before ?? ""}:${after ?? ""}` },
    "@/utils/controllers/savedContent/helper": { includeSavedContentComment: () => ({}) },
    "@/lib/taskCardActions/writeLocks": { withTaskStarWriteLock: async (id, op) => { calls.locks.push(id); return op(tx); } },
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
    "@/utils/controllers/pages/standalonePagesEnabled": { standalonePagesEnabled: async () => true },
    "@/lib/aiModelOptions": { aiModelDefinitions: [], aiImageModelDefinitions: [] },
    "@/utils/controllers/agents/boardMembers": { getBoardAgentMembers: async (projectId, userId) => { calls.agents.push({ projectId, userId }); return [{ agent: { id: `agent-${projectId}`, displayName: "Board agent" } }]; } },
    "../search/document": { turbopufferFetchMentionTasks: async (_query, ids, projectId) => { calls.searches.push({ ids, projectId }); return tasks.filter(task => ids.includes(task.projectId)).map(task => ({ id: task.id, project_id: task.projectId, name: task.title, type: "task" })); } },
  };
  const auth = load("src/lib/mcp/auth/verifyJwt.ts", mocks);
  mocks["@/lib/mcp/auth/verifyJwt"] = auth;
  mocks["@/lib/mcp/auth"] = { validateMcpAuth: async request => auth.validateJwtToken(request.headers.get("Authorization").slice(7), { boundedLogging: true }) };
  const requestUser = load("src/app/api/ai/_lib/requestUser.ts", mocks);
  mocks["@/app/api/ai/_lib/requestUser"] = requestUser;
  const resolver = load("src/lib/auth/desktopCliTokenUser.ts", mocks);
  mocks["@/lib/auth/desktopCliTokenUser"] = resolver;
  const handlers = {};
  const cases = {
    writer: { file: "src/app/api/ai/task-writer/route.ts", method: "POST", endpoint: "task-writer" },
    defaults: { file: "src/pages/api/tasks/createGlobally.ts", method: "GET", endpoint: "task-defaults" },
    private: { file: "src/pages/api/savedContent/toggleSaved.ts", method: "POST", endpoint: "comment-star-pin" },
    public: { file: "src/pages/api/savedContent/toggleSaved.ts", method: "POST", endpoint: "comment-star-pin" },
    mentions: { file: "src/pages/api/tasks/searchByParam.ts", method: "GET", endpoint: "mention-search" },
  };
  async function call(area, token, overrides = {}) {
    const spec = cases[area];
    handlers[area] ??= load(spec.file, mocks);
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(state.cookieId ? { cookie: "fixture-cookie" } : {}) };
    const body = { projectId: 15, PROMPT: "Write a task", requestKind: "manual", taskId: 150, commentId: 1500, type: area === "public" ? "Public" : "Private", userId: 77, agentId: "forged-actor", ...overrides.body };
    if (area === "writer") {
      const response = await handlers[area].POST(new Request("https://example.test/api/ai/task-writer", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: overrides.rawBody ?? JSON.stringify(body) }));
      const text = await response.text();
      return { statusCode: response.status, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text, headers: response.headers };
    }
    const req = { method: overrides.method ?? spec.method, headers, cookies: {}, query: { projectId: "15", sectionId: "15", position: "bottom", param: "all", userId: "77", agentId: "forged-actor", ...overrides.query }, body };
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, setHeader(name, value) { this.headers[name] = value; } };
    await handlers[area].default(req, res);
    return res;
  }
  return { state, users, projects, tasks, comments, saved, calls, call, auth, resolver, requestUser, mocks, cases, prisma,
    token: (user = owner) => auth.createMcpToken(user.id, user.email, "30d"),
    oauth: () => auth.createOAuthToken("desktop-owner", owner.id, owner.email, "desktop-client"),
    sign: (claims = {}, options = {}, key = TEST_SIGNING_KEY) => jwt.sign({ sub: owner.email, userId: owner.id, jti: `fixture-${Math.random()}`, mcpIssuedAtMs: Date.now(), ...claims }, key, Object.fromEntries(Object.entries({ issuer: "hypertask", audience: "mcp-api", expiresIn: "30d", ...options }).filter(([, value]) => value !== undefined))),
  };
}

const logs = [];
const originalInfo = console.info;
const originalLog = console.log;
const originalError = console.error;
console.info = (...args) => logs.push(args);
console.log = (...args) => logs.push(args);
console.error = (...args) => logs.push(args);
test.after(() => { console.info = originalInfo; console.log = originalLog; console.error = originalError; });
test.beforeEach(() => { logs.length = 0; });
const decisions = () => logs.filter(([label]) => label === "[desktop/cli-bearer]").map(([, payload]) => payload);
const outcomes = () => logs.filter(([label]) => label === "[desktop/cli-authorization]").map(([, payload]) => payload);

for (const area of ["writer", "defaults", "private", "public", "mentions"]) {
  test(`${area}: human CLI now allowed with verified actor and final authorization log`, async () => {
    const h = harness();
    const response = await h.call(area, h.token());
    assert.equal(response.statusCode, 200);
    assert.ok(h.calls.access.length > 0);
    assert.ok(h.calls.access.every(({ args }) => args[0] === owner.id));
    assert.deepEqual(decisions(), [{ endpoint: h.cases[area].endpoint, decision: "allow", reason: "human_cli_token", userId: owner.id }]);
    assert.deepEqual(outcomes(), [{ endpoint: h.cases[area].endpoint, userId: owner.id, decision: "allow", reason: "authorized", status: 200 }]);
    assert.deepEqual(h.calls.flags.filter(({ key }) => key === FLAG), [{ key: FLAG, id: owner.id }]);
    if (area === "writer") {
      assert.equal(response.body, output);
      assert.equal(h.calls.usage[0].userId, owner.id);
      assert.ok(h.calls.retrieval.every(args => (args.principal?.userId ?? args.userId) === owner.id));
    } else if (area === "defaults") assert.deepEqual(response.body, { section: "Todo", ranking: "rank:A0200:", sectionId: 15 });
    else if (area === "mentions") assert.ok(response.body.some(row => row.type === "task" && row.id === 150));
    else assert.equal(response.body.saved.userId, owner.id);
  });

  test(`${area}: cookie still allowed On and Off, takes precedence over conflicting and invalid bearer`, async () => {
    for (const mode of ["EVERYONE", "OFF"]) for (const invalid of [false, true]) {
      const h = harness(); h.state.cookieId = member.id; h.state.mode = mode;
      assert.equal((await h.call(area, invalid ? "invalid.signature.value" : h.token())).statusCode, 200);
      assert.ok(h.calls.access.length > 0);
      assert.ok(h.calls.access.every(({ args }) => args[0] === member.id));
      assert.deepEqual(h.calls.flags.filter(({ key }) => key === FLAG), []);
      assert.deepEqual(h.calls.auth, []);
      assert.deepEqual(decisions(), []);
      assert.deepEqual(outcomes(), []);
    }
  });

  test(`${area}: Owner+QA still allows verified owner and QA CLI users`, async () => {
    for (const user of [owner, member]) {
      const h = harness(); h.state.mode = "OWNER_AND_QA";
      assert.equal((await h.call(area, h.token(user))).statusCode, 200);
      assert.ok(h.calls.access.some(({ args }) => args[0] === user.id));
    }
  });

  const refusals = {
    "flag Off": h => { h.state.mode = "OFF"; return h.token(); },
    "flag lookup failure": h => { h.state.flagError = true; return h.token(); },
    "Owner+QA excludes another human": h => { h.state.mode = "OWNER_AND_QA"; return h.token(outsider); },
    "agent token": h => h.sign({ agentId }),
    "team-bound agent token": h => h.sign({ agentId, agentTeamId: "team", agentTeamAccessBinding: "binding" }),
    "MCP OAuth on CLI path": h => h.oauth(),
    "management key": () => "htmk_fixture-management-key",
    "API key": () => "htk_fixture-api-key",
    "invalid signature": h => h.sign({ userId: 123456789 }, {}, ["foreign", "test", "signing", "key", "0000000000"].join("-")),
    "expired": h => h.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, { expiresIn: undefined }),
    "future nbf": h => h.sign({ nbf: Math.floor(Date.now() / 1000) + 3600 }),
    "revoked": h => { const token = h.token(); h.state.revoked.add(`${owner.id}:user:${owner.id}:${jwt.decode(token).jti}`); return token; },
    "revoke-all": h => { h.users[0].mcpTokensRevokedAt = new Date(Date.now() + 60_000); return h.token(); },
    "revoke-all missing issuance": h => { h.users[0].mcpTokensRevokedAt = new Date(Date.now() + 60_000); return h.sign({ mcpIssuedAtMs: undefined }, { noTimestamp: true }); },
    "missing exp": h => h.sign({}, { expiresIn: undefined }),
    "zero issuance": h => { h.users[0].mcpTokensRevokedAt = new Date(); return jwt.sign(JSON.stringify({ iss: "hypertask", aud: "mcp-api", userId: owner.id, sub: owner.email, iat: 0, exp: Math.floor(Date.now() / 1000) + 3600 }), TEST_SIGNING_KEY); },
    "unusable issuance": h => h.sign({ mcpIssuedAtMs: 1e30 }),
    "empty agent claim": h => h.sign({ agentId: null }),
    "inconsistent team claims": h => h.sign({ agentTeamId: "team", agentTeamAccessBinding: "binding" }),
    "deleted user": h => h.sign({ userId: 1001 }),
    "revocation store failure": h => { h.state.revocationError = true; return h.token(); },
    "wrong issuer": h => h.sign({}, { issuer: "foreign" }),
    "wrong audience": h => h.sign({}, { audience: "foreign" }),
    "extra audience": h => h.sign({}, { audience: ["mcp-api", "foreign"] }),
    "legacy": h => h.sign({}, { issuer: "hypertasks", audience: "hypertasks-mcp" }),
    "audience-less": h => h.sign({}, { audience: undefined }),
    "malformed": () => "not-a-jwt",
    "missing bearer": () => null,
  };
  for (const [name, credential] of Object.entries(refusals)) {
    test(`${area}: now refused ${name}; cookie still allowed and minted CLI positive control`, async () => {
      const h = harness();
      const token = credential(h);
      if (area === "writer" && name === "MCP OAuth on CLI path") {
        assert.equal(await h.resolver.getDesktopCliTokenUser(new Headers({ Authorization: `Bearer ${token}` }), "task-writer"), null);
        assert.equal((await h.call(area, token)).statusCode, 200);
        assert.equal(outcomes().length, 0);
        return;
      }
      assert.equal((await h.call(area, token)).statusCode, 401);
      assert.deepEqual(h.calls.protected, []);
      assert.deepEqual(h.calls.provider, []);
      assert.deepEqual(h.calls.usage, []);
      assert.deepEqual(h.calls.writes, []);
      assert.deepEqual(h.calls.locks, []);
      assert.equal(outcomes().length, 0);
      if (name === "invalid signature") {
        assert.ok(!logs.some(args => JSON.stringify(args).includes("123456789")));
        assert.deepEqual(h.calls.auth, []);
      }
      h.state.cookieId = member.id;
      assert.equal((await h.call(area, token)).statusCode, 200);
      const fresh = harness();
      assert.equal((await fresh.call(area, fresh.token())).statusCode, 200);
    });
  }

  test(`${area}: foreign board refused with verified principal, no generation or saved-content write; cookie member still allowed`, async () => {
    const h = harness();
    const overrides = { body: { projectId: 99, taskId: 990, commentId: 9900 }, query: { projectId: "99", sectionId: "99" } };
    const response = await h.call(area, h.token(), overrides);
    const status = ["writer", "defaults"].includes(area) ? 403 : 404;
    assert.equal(response.statusCode, status);
    if (area === "mentions") assert.deepEqual(response.body, []);
    assert.ok(h.calls.access.length > 0);
    assert.ok(h.calls.access.every(({ args }) => args[0] === owner.id));
    assert.equal(outcomes().at(-1).status, status);
    assert.equal(outcomes().at(-1).decision, "refuse");
    assert.deepEqual(h.calls.provider, []); assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.locks, []);
    h.state.cookieId = member.id;
    assert.equal((await h.call(area, h.token())).statusCode, 200);
  });

  test(`${area}: pre-rollout token and post-revocation token still allowed`, async () => {
    const h = harness();
    const toggleOffStatus = area === "private" || area === "public" ? 201 : 200;
    const old = Date.now() - 7 * 86400_000;
    const token = h.sign({ iat: Math.floor(old / 1000), mcpIssuedAtMs: old });
    assert.equal((await h.call(area, token)).statusCode, 200);
    assert.equal((await h.call(area, h.sign({ mcpIssuedAtMs: undefined }))).statusCode, toggleOffStatus);
    assert.equal((await h.call(area, h.sign({}, { noTimestamp: true }))).statusCode, 200);
    h.users[0].mcpTokensRevokedAt = new Date(old - 1000);
    assert.equal((await h.call(area, token)).statusCode, toggleOffStatus);
  });
}

for (const area of ["defaults", "private", "public"]) {
  test(`${area}: scoped cookie stays first and cannot borrow the CLI human's board access`, async () => {
    const h = harness();
    h.state.cookieId = member.id; h.state.cookieAgentId = agentId;
    h.state.cookieTeamScope = { teamId: "restricted-team", accessBinding: "binding" };
    assert.equal((await h.call(area, h.token())).statusCode, area === "defaults" ? 403 : 404);
    assert.ok(h.calls.access.some(({ args }) => args[0] === member.id && args[1] === agentId && args[2] === h.state.cookieTeamScope));
    assert.deepEqual(decisions(), []); assert.deepEqual(outcomes(), []);
    assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.locks, []);
    h.state.cookieAgentId = undefined; h.state.cookieTeamScope = null;
    assert.equal((await h.call(area, h.token())).statusCode, 200);
  });
}

test("Task Writer keeps OAuth and cookie access with CLI flag Off; shared resolver alone still refuses CLI", async () => {
  const h = harness(); h.state.mode = "OFF";
  assert.equal((await h.call("writer", h.oauth())).statusCode, 200);
  assert.equal(await h.requestUser.getAiRequestUser(new Request("https://example.test", { headers: { Authorization: `Bearer ${h.token()}` } })), null);
  h.state.cookieId = member.id;
  assert.equal((await h.call("writer", h.token())).statusCode, 200);
  assert.deepEqual(decisions(), []); assert.deepEqual(outcomes(), []);
});

test("Task Writer CLI and cookie preserve split output and usage identity", async () => {
  for (const cookie of [false, true]) {
    const h = harness(); h.state.split = true; if (cookie) h.state.cookieId = member.id;
    const response = await h.call("writer", h.token(), { body: { requestKind: "compose-task" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { tasks: [{ title: "Draft", description: output }] });
    assert.equal(h.calls.usage[0].userId, cookie ? member.id : owner.id);
  }
});

test("Task Writer refuses foreign existing task before retrieval/provider and preserves feature/plan refusals", async () => {
  for (const scenario of ["target", "feature", "plan", "provider"]) {
    const h = harness();
    if (scenario === "feature") h.state.feature = false;
    if (scenario === "plan" || scenario === "provider") h.state.providerError = Object.assign(new Error("Unavailable"), { name: scenario === "plan" ? "AiPlanAccessError" : "AiGatewayKeyRequiredError" });
    assert.equal((await h.call("writer", h.token(), { body: { requestKind: "compose-task", ...(scenario === "target" ? { existingTaskId: 990 } : {}) } })).statusCode, 403);
    assert.deepEqual(h.calls.retrieval, []); assert.deepEqual(h.calls.usage, []);
    assert.equal(outcomes().at(-1).status, 403);
  }
});

test("Task Writer logs malformed-body and missing-field refusals for CLI only", async () => {
  for (const overrides of [{ rawBody: "{" }, { body: { PROMPT: "" } }]) {
    const h = harness();
    assert.equal((await h.call("writer", h.token(), overrides)).statusCode, 400);
    assert.equal(outcomes().at(-1).status, 400);
    assert.deepEqual(h.calls.provider, []);
  }
});

test("defaults reject foreign section, retain board-constrained ranking, and log missing sections", async () => {
  const h = harness();
  assert.equal((await h.call("defaults", h.token(), { query: { sectionId: "99" } })).body.sectionId, 15);
  const ranking = h.calls.protected.find(call => call.name === "task");
  assert.equal(ranking.where.projectId, 15);
  assert.ok(matches(h.projects[0], ranking.where.project));
  assert.ok(!matches(h.projects[2], ranking.where.project));
  h.projects[0].id = 17;
  assert.equal((await h.call("defaults", h.token(), { query: { projectId: "17" } })).statusCode, 404);
  assert.equal(outcomes().at(-1).status, 404);
});

for (const area of ["private", "public"]) {
  test(`${area}: comment mismatch refused; private ownership and shared pin toggle unchanged`, async () => {
    const h = harness();
    assert.equal((await h.call(area, h.token(), { body: { commentId: 9900 } })).statusCode, 404);
    assert.equal(h.calls.locks.length, 0);
    assert.equal((await h.call(area, h.token(), { body: { projectId: 99 } })).statusCode, 200);
    assert.equal(h.saved[0].projectId, 15);
    assert.equal(h.saved[0].userId, owner.id);
    assert.equal(h.calls.savedWhere.at(-1).userId, area === "private" ? owner.id : undefined);
    assert.equal((await h.call(area, h.token(member))).statusCode, area === "private" ? 200 : 201);
    if (area === "private") {
      assert.equal(h.saved.length, 2);
      assert.equal((await h.call(area, h.token())).statusCode, 201);
      assert.equal(h.saved[0].userId, member.id);
    } else assert.equal(h.saved.length, 0);
    assert.ok(h.calls.locks.every(id => id === 150));
  });
  test(`${area}: malformed IDs/types and non-POST bearer never mutate; cookie still retains task stars`, async () => {
    for (const body of [{ taskId: "bad" }, { commentId: "bad" }, { type: "Other" }]) {
      const h = harness(); assert.equal((await h.call(area, h.token(), { body })).statusCode, 400); assert.equal(h.calls.locks.length, 0);
      assert.equal(outcomes().at(-1).status, 400);
    }
    const h = harness();
    assert.equal((await h.call(area, h.token(), { method: "GET" })).statusCode, 401);
    assert.equal((await h.call(area, h.token(), { body: { type: "Private", commentId: null } })).statusCode, 401);
    h.state.cookieId = member.id;
    assert.equal((await h.call(area, h.token(), { body: { type: "Private", commentId: null } })).statusCode, 200);
  });
}

test("mention all/named groups exclude foreign boards, tasks, pages and agents while allowing other authorized boards", async () => {
  for (const param of ["all", "Board"]) for (const cookie of [false, true]) {
    const h = harness(); if (cookie) h.state.cookieId = member.id;
    const response = await h.call("mentions", h.token(), { query: { param } });
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.some(row => row.type === "project" && row.id === 16));
    assert.ok(!response.body.some(row => row.id === 99 || row.id === 990 || row.id === "page-99" || row.id === "agent-99"));
    assert.ok(response.body.some(row => row.id === "page-15"));
    assert.deepEqual(h.calls.agents, [{ projectId: 15, userId: cookie ? member.id : owner.id }]);
    if (param !== "all") {
      assert.deepEqual(h.calls.searches, [{ ids: [15, 16], projectId: 15 }]);
      assert.ok(response.body.some(row => row.type === "task" && row.id === 160));
    }
  }
});

test("CLI final outcomes include infrastructure refusals without exposing error detail", async () => {
  for (const area of ["writer", "defaults", "private", "public", "mentions"]) {
    const h = harness();
    if (area === "writer") h.state.providerError = new Error("private-provider-detail");
    else if (area === "private" || area === "public") h.prisma.task.findFirst = async () => { throw new Error("private-repository-detail"); };
    else if (area === "defaults") h.prisma.project.findFirst = async () => { throw new Error("private-repository-detail"); };
    else h.prisma.project.findMany = async () => { throw new Error("private-repository-detail"); };
    const response = await h.call(area, h.token());
    const expected = area === "private" || area === "public" ? 400 : area === "mentions" ? 404 : 500;
    assert.equal(response.statusCode, expected);
    assert.equal(outcomes().at(-1).status, expected);
    assert.equal(outcomes().at(-1).decision, "refuse");
    assert.ok(!JSON.stringify(outcomes()).includes("private-"));
  }
});

test("POST createGlobally and other taskWriteHandler routes remain cookie-only with flag On", async () => {
  for (const file of ["src/pages/api/tasks/createGlobally.ts", "src/pages/api/tasks/create.ts", "src/pages/api/tasks/recoverTask.ts"]) {
    const h = harness();
    const handler = load(file, h.mocks).default;
    const req = { method: "POST", headers: { Authorization: `Bearer ${h.token()}` }, cookies: {}, query: {}, body: { taskId: 150, projectId: 15, title: "Never create", description: "Body" } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader() {} };
    await handler(req, res);
    assert.equal(res.statusCode, 401, file);
    assert.deepEqual(h.calls.protected, []); assert.deepEqual(h.calls.writes, []);
    assert.deepEqual(decisions(), []);
  }
});

test("missing bearer is silent and resolver logs contain no token, email, cookie or user content", async () => {
  const h = harness();
  assert.equal(await h.resolver.getDesktopCliTokenUser(new Headers(), "task-defaults"), null);
  assert.deepEqual(decisions(), []);
  const token = h.token();
  const headers = new Headers({ Authorization: `Bearer ${token}`, cookie: "private-cookie", "x-forwarded-user-id": "77" });
  const session = await h.resolver.getDesktopCliTokenUser(headers, "task-defaults");
  assert.equal(session.userId, owner.id); assert.equal(session.user.id, owner.id); assert.equal(session.source, "cli-bearer");
  assert.equal(session.teamScope, null); assert.ok(!("agentId" in session));
  const serialized = JSON.stringify(logs);
  for (const secret of [token, token.split(".")[2], owner.email, "private-cookie"]) assert.ok(!serialized.includes(secret));
});

test("flag is feature/access, Owner+QA, with ticket-specific server gate", () => {
  const definition = load("src/lib/flags/definitions/htpr-7699-desktop-cli-token.ts", {}).default;
  assert.equal(definition.key, FLAG); assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA"); assert.equal(definition.releaseRisk.highRisk, "access");
  assert.equal(definition.releaseRisk.risk, "new"); assert.ok(definition.releaseRisk.reason);
});
