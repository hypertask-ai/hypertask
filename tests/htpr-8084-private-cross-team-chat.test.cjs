const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((clause) => matches(row, clause));
    if (key === "OR") return value.some((clause) => matches(row, clause));
    if (key === "NOT") return !matches(row, value);
    if (key === "__visibleTo") return row.userId === value || row.visibility === "TEAM";
    const actual = row[key];
    if (value === null || typeof value !== "object") return actual === value;
    if ("some" in value) return (actual ?? []).some((item) => matches(item, value.some));
    if ("in" in value) return value.in.includes(actual);
    if ("not" in value) return actual !== value.not;
    if ("gt" in value) return actual > value.gt;
    if ("lt" in value) return actual < value.lt;
    return matches(actual, value);
  });
}

function fixture({ marked = true, shared = true, sessionUserId = 6, teamId = "team-a", runtimeType = "EXTERNAL" } = {}) {
  const state = { sessionExists: true, viewer: { userId: 6 }, token: { user: { id: 6 }, agentId: "22222222-2222-4222-8222-222222222222", teamScope: null } };
  const writes = [], broadcasts = [], flags = [];
  const board = { id: 15, ownerId: 6, teamId: "team-a", status: "Normal", members: [{ userId: 7, agentId: null, status: "Accepted" }] };
  const agent = { id: "22222222-2222-4222-8222-222222222222", userId: 6, displayName: "Runner", visibility: "TEAM", runtimeType, revokedAt: null, archivedAt: null,
    crossTeamHomeTeamId: marked ? "team-a" : null, heartbeatAt: new Date(), runtimeGeneration: 0,
    members: [{ projectId: 15, status: "Accepted", project: board }], agentWebhookSubscription: null };
  const session = { id: "11111111-1111-4111-8111-111111111111", agentId: agent.id, agent, userId: sessionUserId,
    user: { displayName: "Owner" }, teamId, projectId: null, taskId: 150, title: "Private conversation", createdAt: new Date(), updatedAt: new Date(), _count: { messages: 1 } };
  const messages = [{ id: "human-1", sessionId: session.id, role: "human", content: "PRIVATE-HISTORY", createdAt: new Date(), authorUserId: 6, isDelivered: false, attachments: [] }];
  session.messages = messages;
  const participants = [6, 7, 8].map((userId) => ({ sessionId: session.id, userId, joinedAt: new Date(0), lastReadAt: new Date(0), draft: `${userId}-draft`, user: { displayName: `user-${userId}` } }));
  const prisma = {
    project: { findFirst: async ({ where }) => matches(board, where) ? board : null, findMany: async () => [board] },
    task: { findMany: async () => [{ id: 150 }] },
    agent: { findFirst: async ({ where }) => matches(agent, where) ? agent : null, findMany: async ({ where }) => matches(agent, where) ? [agent] : [] },
    member_Team: { findMany: async () => [{ teamId: "team-a" }, { teamId: "team-b" }] },
    chatSession: {
      findFirst: async ({ where }) => state.sessionExists && matches(session, where) ? session : null,
      findUnique: async () => state.sessionExists ? session : null,
      findMany: async ({ where }) => matches(session, where) ? [session] : [],
      count: async ({ where }) => Number(matches(session, where)),
      upsert: async () => { writes.push("open"); state.sessionExists = true; return session; },
      update: async ({ data }) => { writes.push("session"); Object.assign(session, data); return session; },
      updateMany: async ({ where }) => { if (!matches(session, where)) return { count: 0 }; writes.push("session"); return { count: 1 }; },
      deleteMany: async ({ where }) => { const count = Number(matches(session, where)); if (count) writes.push("delete"); return { count }; },
      create: async () => ({ id: "plain", agentId: null, messages: [], _count: { messages: 0 } }),
    },
    chatSessionParticipant: {
      upsert: async ({ create }) => { writes.push("participant"); return participants.find((row) => row.userId === create.userId); },
      findMany: async () => participants,
      update: async ({ where, data }) => { writes.push("draft"); Object.assign(participants.find((row) => row.userId === where.sessionId_userId.userId), data); },
      updateMany: async () => { writes.push("read"); return { count: 1 }; },
      findUnique: async ({ where }) => participants.find((row) => row.userId === where.sessionId_userId.userId),
    },
    chatMessage: {
      findMany: async () => [...messages], count: async () => 0,
      findFirst: async ({ where }) => messages.find((row) => matches(row, where)) ?? null,
      findUnique: async () => null,
      update: async ({ where, data }) => Object.assign(messages.find((row) => row.id === where.id), data),
      create: async ({ data }) => { writes.push("message"); const row = { id: "reply-1", createdAt: new Date(), ...data }; messages.push(row); return row; },
    },
    user: { findUnique: async () => ({ id: state.viewer.userId, displayName: "Owner" }) },
    agentWebhookSubscription: { findUnique: async () => null },
    agentRun: { findFirst: async () => null },
    attachment: { findMany: async () => [] },
    $transaction: async (operation) => typeof operation === "function" ? operation(prisma) : Promise.all(operation),
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Agent"')) return [{ id: state.token.agentId, userId: 6, heartbeatAt: new Date() }];
      if (sql.includes("WITH pending AS")) {
        const scoped = values.find((value) => value && typeof value === "object" && "strings" in value && value.strings.join("").includes("AND"));
        if (scoped?.strings.join("").includes("FALSE") || state.token.agentId !== agent.id) return [];
        return messages.filter((row) => !row.isDelivered).map((row) => ({ id: row.id, sessionId: session.id, text: row.content, userName: "Owner" }));
      }
      return [];
    },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.viewer },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ ...state.viewer, user: { id: state.viewer.userId } }) },
    "next/headers": { cookies: async () => ({ get: () => null }) },
    "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: false }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: async (_request, fn) => fn() },
    "@/lib/flags": { SHARED_AGENT_CHAT_FLAG: "shared", AGENT_CHAT_TICKET_CONFIRM_FLAG: "confirm", isFeatureEnabled: async (key) => { flags.push(key); return key === "htpr-7518-agent-sidebar-chats" || key === "shared" && shared; } },
    "@/lib/agents/visibility": { accessibleAgentWhere: (userId) => ({ __visibleTo: userId }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), projectContentAccessWhere: (_userId, _agentId, scope) => scope ? { teamId: scope.teamId } : {} },
    "@/utils/controllers/agents/boardMembers": { getAgentTeamIds: async () => new Map([[agent.id, "team-a"]]) },
    "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => state.token },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null, validateMcpAuth: async () => state.token },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/tasks/services": { getSectionForTask: async () => ({ error: null }), validateProjectAccess: async () => ({ error: null }) },
    "@/lib/mcp/tasks/agentMutationFence": { TaskTeamScopeError: class extends Error {} },
    "@/lib/agents/chatContext": { readableAgentChatContextIds: async () => new Set() },
    "@/lib/agentRuns/service": { browserMutationIsSameOrigin: () => true, readAgentChatTurn: async () => null, authenticateAgentRunRequest: async () => ({ ...state.viewer, source: "browser" }), stopAgentChatTurn: async () => { writes.push("stop"); return true; } },
    "@/lib/agents/chatBrief": { buildAgentChatBrief: async () => null },
    "@/lib/agents/chatTicketProposal": { chatTicketProposalSelect: {}, serializeChatTicketProposal: () => null, parseChatTicketProposal: () => ({ proposal: null, error: null }) },
    "@/lib/agents/agentChatActivity": { listAgentChatActivity: async () => [] },
    "@/lib/agents/chatActivityFeed": { asksForAgentActivity: () => false },
    "@/lib/agentWebhooks/outbox": { persistAgentRunTriggerWebhooks: async () => [], publishAgentWebhookDeliveries: async () => null },
    "@/lib/agents/runtimeState": { readAgentRuntimeSnapshot: async () => null, filterRuntimeSnapshotToBoards: (value) => value, classifyRuntimeHealth: () => "offline" },
    "@/lib/realtime/server": { AGENT_CHAT_EVENT: "agent-chat", userChannel: (id) => `user-${id}`, broadcast: async (channel) => { broadcasts.push(channel); } },
    "@/lib/storage/uploadTaskAttachmentToS3": {},
    "@/lib/storage/uploadAiChatAttachmentToS3": {},
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (text) => text },
    "@/lib/storage/deleteTaskAttachmentFromS3": { deleteTaskAttachmentFromS3: async () => true },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: state.viewer.userId }), getCliBearerChatUser: async () => null },
    "@/app/api/ai/_lib/cronServiceAuth": { getCronServiceRequestUser: async () => null },
    "@/lib/ai/chatStream/turnModel": { loadTurnModel: async () => { writes.push("stream"); return new Response("owner stream"); } },
    "@/lib/ai/chatStream/stream": {},
    "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/lib/nativeAgent/heartbeatTurnEnvelope": {},
    "@/lib/ai/chatStream/errors": { createSseErrorResponse: (error, status = 400) => Response.json({ error }, { status }) },
    "@/lib/ai/tools/helpers": { loadActingAgent: async () => ({ id: agent.id }) },
    "../stream/streamLease": { requestAiChatCancellation: async () => { writes.push("cancel"); return "cancelling"; } },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/lib/errors/reportError": {},
    "@/lib/redis": { getRedis: async () => ({ get: async () => null, set: async () => null }) },
  };
  const routes = {};
  const loadModule = (file, extra = {}) => load(file, { ...mocks, ...extra });
  const request = (path, method = "GET", body, sidebar = false) => new NextRequest(`https://app.hypertask.ai/api/${path}`, { method,
    headers: { "Content-Type": "application/json", ...(sidebar ? { "x-hypertask-sidebar-project": "15" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  async function call(name, sidebar = false) {
    const entries = {
      history: ["agent-chat/[sessionId]", "GET"],
      send: ["agent-chat/[sessionId]/messages", "POST", { text: "hello" }],
      stop: ["agent-chat/[sessionId]/stop", "POST", {}],
      draft: ["agent-chat/[sessionId]/participant", "PATCH", { draft: "new draft", read: true }],
      roster: ["agent-sidebar-chats", "GET"],
      open: [sidebar ? "agent-sidebar-chats" : "ai-chat/create-session", "POST", { agentId: agent.id, projectId: 15 }],
      list: ["ai-chat/all-sessions", "GET"],
      page: ["ai-chat/all-sessions", "GET"],
      transcript: ["ai-chat/all-sessions", "GET"],
      taskList: ["ai-chat/task-sessions", "GET"],
      rename: ["ai-chat/update-session", "POST", { sessionId: session.id, title: "renamed" }],
      delete: ["ai-chat/delete-session", "DELETE"],
      add: ["ai-chat/add-message", "POST", { sessionId: session.id, message: { role: "human", content: "hello" } }],
      agentRead: ["mcp/chat/sessions/[sessionId]/messages", "GET"],
      agentReply: ["mcp/chat/sessions/[sessionId]/messages", "POST", { text: "reply", replyToMessageId: "human-1" }],
      poll: ["mcp/chat/pending", "GET"],
      stream: ["ai/chat/stream", "POST", { session_id: session.id, message: "hello" }],
      cancel: ["ai/chat/cancel", "POST", { session_id: session.id, assistant_message_id: session.id, stream_id: session.id }],
    };
    const [path, method, body] = entries[name];
    const suffix = name === "page" ? "?compat=htpr-6924" : name === "transcript" ? `?compat=htpr-6924&sessionId=${session.id}` : name === "taskList" ? "?taskId=150" : name === "delete" ? `?delete=${session.id}` : "?projectId=15";
    routes[path] ??= loadModule(`src/app/api/${path}/route.ts`);
    return routes[path][method](request(path + suffix, method, body, sidebar), { params: Promise.resolve({ sessionId: session.id }) });
  }
  return { state, agent, session, writes, broadcasts, flags, participants, call, loadModule, request, prisma };
}

for (const shared of [true, false]) {
  for (const sidebar of [false, true]) {
    for (const name of ["history", "send", "draft", "stop", "open", ...(sidebar ? ["roster"] : [])]) {
      test(`${name}: sticky privacy, shared=${shared}, sidebar=${sidebar}, owner allowed / teammate refused`, async () => {
        const f = fixture({ shared });
        const allowed = await f.call(name, sidebar);
        assert.equal(allowed.status, 200, JSON.stringify(await allowed.json()));
        f.writes.length = 0;
        f.state.viewer.userId = 7;
        const refused = await f.call(name, sidebar);
        if (name === "roster") assert.deepEqual((await refused.json()).agents, []);
        else assert.equal(refused.status, 404, JSON.stringify(await refused.json()));
        assert.deepEqual(f.writes, []);
        assert.ok(!f.flags.includes("htpr-8084-cross-team-agents"), "privacy cannot depend on rollout state");
      });
    }
  }
  test(`private history hides previous participant roster, shared=${shared}`, async () => {
    const f = fixture({ shared });
    const body = await (await f.call("history")).json();
    assert.equal(body.messages[0].content, "PRIVATE-HISTORY");
    assert.equal(body.participants, null);
    assert.equal(body.sharedConversationEnabled, false);
    assert.equal(body.viewer.draft, "6-draft");
  });
  test(`broadcast discards foreign participant and explicit recipients, shared=${shared}`, async () => {
    const f = fixture({ shared });
    await f.loadModule("src/lib/agents/chatBroadcast.ts").broadcastChatSession(f.session.id, [7, 8, 99, 6]);
    assert.deepEqual(f.broadcasts, ["user-6"]);
  });
}

for (const name of ["history", "send", "draft", "stop", "open", "roster"]) test(`${name}: null marker preserves legacy TEAM sharing`, async () => {
  const f = fixture({ marked: false });
  f.state.viewer.userId = 7;
  assert.equal((await f.call(name, true)).status, 200);
});

for (const name of ["list", "page", "transcript", "taskList", "rename", "delete", "add", "stream", "cancel"]) test(`${name}: native direct entry protects older caller-owned agent sessions`, async () => {
  const owner = fixture({ runtimeType: "NATIVE" });
  assert.equal((await owner.call(name)).status, 200);
  const foreign = fixture({ runtimeType: "NATIVE", sessionUserId: 7 });
  foreign.state.viewer.userId = 7;
  const response = await foreign.call(name);
  const body = await response.json();
  if (["list", "page", "taskList"].includes(name)) assert.ok(!JSON.stringify(body).includes("Private conversation") && !JSON.stringify(body).includes("PRIVATE-HISTORY"));
  else assert.equal(response.status, 404, JSON.stringify(body));
  assert.deepEqual(foreign.writes, []);
});

for (const name of ["agentRead", "agentReply", "poll"]) test(`${name}: matching agent allowed, foreign identity refused, bound credential fenced`, async () => {
  const own = fixture();
  const response = await own.call(name);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const other = fixture();
  other.state.token.agentId = "other-agent";
  const refused = await other.call(name);
  if (name === "poll") assert.deepEqual((await refused.json()).messages, []);
  else assert.ok([403, 404].includes(refused.status));
  assert.deepEqual(other.writes, []);
  const bound = fixture({ teamId: "team-b" });
  bound.state.token.teamScope = { teamId: "team-a", accessBinding: "owner:account:0" };
  const fenced = await bound.call(name);
  if (name === "poll") assert.deepEqual((await fenced.json()).messages, []);
  else assert.equal(fenced.status, 404);
  assert.deepEqual(bound.writes, []);
});

test("AI session lists and history exclude another marked identity owned by the same user", async () => {
  const f = fixture();
  const deps = f.loadModule("src/app/api/mcp/ai/sessions/_dependencies.ts").aiSessionDependencies;
  assert.equal((await deps.list(f.state.token, 20, 0)).sessions.length, 1);
  f.state.token.agentId = "another-owned-agent";
  assert.deepEqual((await deps.list(f.state.token, 20, 0)).sessions, []);
  assert.equal(await deps.messages(f.state.token, f.session.id, 20, 0), null);
});

test("shared native stream/cancel request guard allows owner and refuses stale participant", async () => {
  const f = fixture({ runtimeType: "NATIVE", sessionUserId: 7 });
  const access = f.loadModule("src/lib/agents/chatAccess.ts");
  assert.equal((await access.loadSidebarChatRequest(f.request("ai/chat/stream"), f.session.id, { userId: 6 })).ok, true);
  assert.equal((await access.loadSidebarChatRequest(f.request("ai/chat/stream"), f.session.id, { userId: 7 })).ok, false, "cookie identity cannot authorize a different authenticated requester");
  f.state.viewer.userId = 7;
  assert.equal((await access.loadSidebarChatRequest(f.request("ai/chat/stream"), f.session.id, { userId: 7 })).ok, false);
  f.state.viewer = { userId: 6, agentId: "another-owned-agent" };
  assert.equal((await access.loadSidebarChatRequest(f.request("ai/chat/cancel"), f.session.id, { userId: 6 })).ok, false);
});

test("failed audience lookup never falls back to unchecked broadcast recipients", async () => {
  const f = fixture();
  const broadcaster = load("src/lib/agents/chatBroadcast.ts", {
    "@/lib/agents/chatAccess": { chatParticipantUserIds: async () => { throw new Error("database unavailable"); } },
    "@/lib/realtime/server": { broadcast: async () => { f.broadcasts.push("leaked"); }, userChannel: (id) => `user-${id}` },
  });
  await broadcaster.broadcastChatSession(f.session.id, [7]);
  assert.deepEqual(f.broadcasts, []);
});

for (const name of ["roster", "open"]) test(`${name}: no previous conversation cannot bypass private audience`, async () => {
  const f = fixture();
  f.state.sessionExists = false;
  f.state.viewer.userId = 7;
  const refused = await f.call(name, true);
  if (name === "roster") assert.deepEqual((await refused.json()).agents, []);
  else assert.equal(refused.status, 404);
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.sessionExists, false);
  f.state.viewer.userId = 6;
  const allowed = await f.call(name, true);
  assert.equal(allowed.status, 200);
  if (name === "roster") assert.equal((await allowed.json()).agents[0].sessionId, null);
  else assert.equal(f.state.sessionExists, true);
});

test("removing home-team grants cannot restore former teammates' history or broadcasts", async () => {
  const f = fixture({ shared: false });
  f.agent.members = [];
  f.session.teamId = null;
  f.state.viewer.userId = 7;
  assert.equal((await f.call("history")).status, 404);
  f.state.viewer.userId = 6;
  assert.equal((await f.call("history")).status, 200);
  await f.loadModule("src/lib/agents/chatBroadcast.ts").broadcastChatSession(f.session.id, [7]);
  assert.deepEqual(f.broadcasts, ["user-6"]);
});

for (const link of ["teamId", "projectId", "taskId"]) test(`marked agent credential scope checks ${link}, not just private audience`, async () => {
  const f = fixture();
  f.state.token.teamScope = { teamId: "team-a", accessBinding: "owner:account:0" };
  assert.equal((await f.call("agentRead")).status, 200);
  f.session[link] = link === "teamId" ? "team-b" : link === "projectId" ? 25 : 250;
  assert.equal((await f.call("agentRead")).status, 404);
  assert.deepEqual(f.writes, []);
});

function runServiceFixture(options = {}) {
  const f = fixture(options);
  f.session.userId = options.marked === false ? 6 : 7;
  f.session.agentRuns = [];
  f.session.messages[0].createdAt = new Date(0);
  f.session.messages[0].isDelivered = true;
  f.prisma.chatMessage.createMany = async () => ({ count: 1 });
  f.prisma.$queryRaw = async () => [{ id: f.session.id, userId: f.session.userId }];
  const service = f.loadModule("src/lib/agentRuns/service.ts", { "./persistence": {} });
  const principal = { userId: f.session.userId, agentId: null, displayName: "Legacy creator", source: "browser" };
  return { ...f, service, principal };
}

for (const marked of [true, false]) {
  for (const shared of [true, false]) {
    for (const operation of ["stop", "sweep"]) test(`run service ${operation}: marked=${marked}, shared=${shared} authorizes broadcast recipients`, async () => {
      const f = runServiceFixture({ marked, shared });
      if (operation === "stop") assert.equal(await f.service.stopAgentChatTurn(f.principal, f.session.id), true);
      else assert.equal(await f.service.sweepExpiredAgentChatTurns(), 1);
      assert.deepEqual(f.broadcasts.sort(), !marked && shared ? ["user-6", "user-7", "user-8"] : ["user-6"]);
    });
  }
}

test("run service stop awaits private audience lookup before completing", async () => {
  const f = runServiceFixture();
  let releaseLookup, startLookup, finished = false;
  const lookupBlocked = new Promise((resolve) => { releaseLookup = resolve; });
  const lookupStarted = new Promise((resolve) => { startLookup = resolve; });
  const findFirst = f.prisma.chatSession.findFirst;
  f.prisma.chatSession.findFirst = async (args) => {
    if (args.select.agent?.select.crossTeamHomeTeamId) {
      startLookup();
      await lookupBlocked;
    }
    return findFirst(args);
  };
  const stopped = f.service.stopAgentChatTurn(f.principal, f.session.id).then(() => { finished = true; });
  try {
    await Promise.race([lookupStarted, stopped]);
    assert.equal(finished, false, "a completed response cannot abandon pending audience authorization");
    assert.deepEqual(f.broadcasts, []);
  } finally {
    releaseLookup();
    await stopped;
  }
  assert.deepEqual(f.broadcasts, ["user-6"]);
});

test("run service remaining direct broadcasts expose agent identity only", () => {
  const ts = require("typescript");
  const file = require.resolve("../src/lib/agentRuns/service.ts");
  const source = ts.createSourceFile(file, require("node:fs").readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const payloads = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "broadcast") {
      const payload = node.arguments[2];
      assert.ok(ts.isObjectLiteralExpression(payload), "direct broadcast payload must be inspectable");
      payloads.push(payload.properties.map((property) => property.name.getText(source)));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(payloads, [["agentId"], ["agentId"]]);
});
