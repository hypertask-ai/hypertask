const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7518-agent-sidebar-chats";
let viewer, enabled, shared, agent, board, session, writes, messages, participants;
const stub = (file, exports) => {
  const id = path.join(root, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
function matches(row, where) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((item) => matches(row, item));
    if (key === "OR") return value.some((item) => matches(row, item));
    if (key === "__visibleTo") return row.userId === value || (row.visibility === "TEAM" && value === 7);
    const actual = row[key];
    if (value === null || typeof value !== "object") return actual === value;
    if ("some" in value) return (actual ?? []).some((item) => matches(item, value.some));
    if ("in" in value) return value.in.includes(actual);
    if ("not" in value) return actual !== value.not;
    return matches(actual, value);
  });
}
const chatMessage = {
  findMany: async () => [...messages].reverse(), count: async () => 0,
  findFirst: async ({ where }) => messages.find((row) => matches(row, where)) ?? null,
  create: async ({ data }) => {
    const row = { id: `message-${messages.length}`, createdAt: new Date(), ...data };
    messages.push(row); writes.push("message"); return row;
  },
  update: async ({ where, data }) => Object.assign(messages.find((row) => row.id === where.id), data),
};
const prisma = {
  project: { findFirst: async ({ where }) => matches(board, where) ? board : null },
  agent: {
    findFirst: async ({ where }) => matches(agent, where) ? agent : null,
    findMany: async ({ where }) => matches(agent, where) ? [agent] : [],
  },
  member_Team: { findMany: async ({ where }) => [6, 7].includes(where.userId) ? [{ teamId: "team-a" }] : [] },
  chatSession: {
    findFirst: async ({ where }) => matches(session, where) ? session : null,
    findUnique: async () => session,
    upsert: async () => { writes.push("open"); return session; },
    update: async () => session,
    updateMany: async () => { throw new Error("Sidebar must not rewrite canonical team scope"); },
  },
  chatSessionParticipant: {
    upsert: async () => ({ draft: null, lastReadAt: new Date(), joinedAt: new Date() }),
    findMany: async () => [],
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => { participants = data; writes.push("draft"); },
    findUnique: async () => participants,
  },
  agentWebhookSubscription: { findUnique: async () => null },
  user: { findUnique: async () => ({ displayName: "Owner" }) },
  chatMessage,
  $queryRaw: async () => [{ heartbeatAt: new Date() }],
  $transaction: async (fn) => fn(prisma),
};
stub("src/lib/agents/runtimeState.ts", {
  readAgentRuntimeSnapshot: async () => null,
  filterRuntimeSnapshotToBoards: (snapshot) => snapshot,
  classifyRuntimeHealth: () => "offline",
});
stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => viewer });
stub("src/lib/flags.ts", {
  SHARED_AGENT_CHAT_FLAG: "shared", AGENT_CHAT_BRIEF_FLAG: "brief", AGENT_CHAT_TICKET_CONFIRM_FLAG: "confirm",
  isFeatureEnabled: async (key) => key === FLAG ? enabled : key === "shared" ? shared : false,
});
stub("src/lib/agents/visibility.ts", { accessibleAgentWhere: (userId) => ({ __visibleTo: userId }) });
stub("src/utils/controllers/projects/getAllIncludes.ts", {
  getProjectWhere: (userId, actingAgentId) => {
    assert.equal(actingAgentId, undefined);
    return { OR: [{ ownerId: userId }, { members: { some: { userId, agentId: null } } }] };
  },
});
stub("src/utils/controllers/agents/boardMembers.ts", { getAgentTeamIds: async () => new Map([["agent-1", "team-a"]]) });
stub("src/lib/api/rateLimit.ts", { checkRestRateLimit: async () => null });
stub("src/lib/mcp/auth.ts", { checkMcpRateLimit: async () => null });
const { browserMutationIsSameOrigin } = require("./task-route-loader.cjs").load("src/lib/agentRuns/service.ts", {
  "@/lib/auth/agentScope": {}, "@prisma/client": {}, "@/lib/auth/getSessionUser": {},
  "@/lib/agentWebhooks/outbox": {}, "@/lib/flags": {}, "@/lib/agentStatus/boardRefresh": {},
  "@/lib/agents/chatBroadcast": {}, "@/lib/mcp/auth": {}, "@/lib/prisma": {},
  "./model": {}, "./persistence": {}, "@/utils/helperFunctions/toStoredHtml": {},
  "@/utils/controllers/projects/getAllIncludes": {}, "@/lib/realtime/server": {},
});
stub("src/lib/agentRuns/service.ts", {
  browserMutationIsSameOrigin,
  authenticateAgentRunRequest: async () => viewer ? { userId: viewer.userId, agentId: viewer.agentId ?? null, source: "browser" } : null,
  stopAgentChatTurn: async () => { writes.push("stop"); return true; },
  readAgentChatTurn: async () => null,
});
stub("src/lib/agents/chatBroadcast.ts", { broadcastChatSession: async () => null });
stub("src/lib/agents/chatBrief.ts", { buildAgentChatBrief: async () => null });
stub("src/lib/agents/agentChatActivity.ts", { listAgentChatActivity: async () => { throw new Error("No activity in embedded messages"); } });
stub("src/lib/agentWebhooks/outbox.ts", {
  persistAgentRunTriggerWebhooks: async () => [], publishAgentWebhookDeliveries: async () => null,
});
const load = (file) => createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, file));
const access = load("src/lib/agents/chatAccess.ts");
const routes = {
  roster: load("src/app/api/agent-sidebar-chats/route.ts"),
  read: load("src/app/api/agent-chat/[sessionId]/route.ts"),
  send: load("src/app/api/agent-chat/[sessionId]/messages/route.ts"),
  draft: load("src/app/api/agent-chat/[sessionId]/participant/route.ts"),
  stop: load("src/app/api/agent-chat/[sessionId]/stop/route.ts"),
};
function reset() {
  viewer = { userId: 6, source: "legacy" }; enabled = true; shared = true; writes = []; messages = []; participants = {};
  board = { id: 15, ownerId: 6, teamId: "team-a", status: "Normal", members: [{ userId: 7, agentId: null, status: "Accepted" }] };
  agent = { id: "agent-1", userId: 6, displayName: "Runner", photoURL: null, visibility: "TEAM", runtimeType: "EXTERNAL", revokedAt: null, archivedAt: null,
    heartbeatAt: new Date(), agentWebhookSubscription: null, members: [{ projectId: 15, status: "Accepted", project: board }] };
  session = { id: "session-1", userId: 6, agentId: agent.id, agent, teamId: "team-a" };
}
async function operation(name, sidebar = true) {
  const method = name === "roster" || name === "read" ? "GET" : name === "draft" ? "PATCH" : "POST";
  const req = new Request(`https://app.hypertask.ai/api/agent-sidebar-chats?projectId=15`, {
    method, headers: { "Content-Type": "application/json", Origin: "https://app.hypertask.ai", ...(sidebar ? { "x-hypertask-sidebar-project": "15" } : {}) },
    ...(method !== "GET" ? { body: JSON.stringify(name === "open" ? { projectId: 15, agentId: "agent-1" } : name === "draft" ? { draft: "private draft" } : { text: "hello" }) } : {}),
  });
  req.nextUrl = new URL(req.url);
  return (name === "open" ? routes.roster : routes[name])[method](req, { params: Promise.resolve({ sessionId: "session-1" }) });
}
const operations = ["roster", "open", "read", "send", "stop", "draft"];
for (const name of operations) {
  for (const userId of [6, 7]) test(`${name}: still allowed ${userId === 6 ? "owner" : "authorized TEAM participant"}`, async () => {
    reset(); viewer.userId = userId;
    const response = await operation(name);
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  });
  test(`${name}: still allowed PRIVATE owner with all parked flags Off`, async () => {
    reset(); agent.visibility = "PRIVATE"; shared = false;
    assert.equal((await operation(name)).status, 200);
  });
  const denied = {
    outsider: () => { viewer.userId = 42; },
    "invited human": () => { viewer.userId = 7; board.members[0].status = "Pending"; },
    "PRIVATE for TEAM reader": () => { viewer.userId = 7; agent.visibility = "PRIVATE"; },
    "wrong board": () => { agent.members[0].projectId = 16; },
    "pending agent grant": () => { agent.members[0].status = "Pending"; },
    "removed agent grant": () => { agent.members = []; },
    "removed human grant": () => { viewer.userId = 7; board.members = []; },
    "archived agent": () => { agent.archivedAt = new Date(); },
    "revoked agent": () => { agent.revokedAt = new Date(); },
    "archived board": () => { board.status = "Archive"; },
    "wrong agent cookie": () => { viewer.agentId = "another-agent"; },
    "own agent cookie": () => { viewer.agentId = "agent-1"; },
    "agent bearer without human session": () => { viewer = null; },
    "flag Off": () => { enabled = false; },
    "canonical team mismatch": () => { viewer.userId = 7; session.teamId = "team-old"; },
    "shared conversation policy Off": () => { viewer.userId = 7; shared = false; },
  };
  for (const [scenario, change] of Object.entries(denied)) test(`${name}: now refused ${scenario}`, async () => {
    reset(); change();
    const response = await operation(name);
    if (name === "roster" && response.status === 200) assert.deepEqual((await response.json()).agents, []);
    else assert.ok([401, 403, 404].includes(response.status), `${scenario}: ${response.status} ${JSON.stringify(await response.json())}`);
    assert.equal(writes.length, 0, "Refusal cannot mutate a thread or participant");
  });
}
for (const name of ["read", "send", "stop", "draft"]) test(`${name}: flag Off preserves legacy owner calls without sidebar context`, async () => {
  reset(); enabled = false;
  assert.equal((await operation(name, false)).status, 200);
});
test("an own agent token still reads its thread and refuses another agent's thread", async () => {
  reset();
  assert.equal((await access.loadAgentTokenChatSession({ sessionId: session.id, agentId: agent.id, select: {} })).ok, true);
  const wrong = await access.loadAgentTokenChatSession({ sessionId: session.id, agentId: "other-agent", select: {} });
  assert.equal(wrong.ok, false); assert.equal(wrong.status, 403);
});
test("malformed sidebar context cannot silently fall back to legacy access", async () => {
  reset();
  assert.equal(access.sidebarChatProjectId(new Headers({ "x-hypertask-sidebar-project": "bad" })), 0);
  const result = await access.loadUserAgentChatSession({ sessionId: session.id, userId: 6, sidebarProjectId: 0, select: {} });
  assert.equal(result.ok, false);
});

test("sidebar open compares the browser origin with the actual Host, not Next's normalized loopback name", async () => {
  const { NextRequest } = require("next/server");
  for (const base of ["http://127.0.0.1:3100", "http://localhost:3100", "https://app.hypertask.ai"]) {
    const differentPort = new URL(base);
    differentPort.port = "3101";
    for (const origin of [base, "https://attacker.example", "null", undefined, differentPort.origin]) {
      reset();
      const request = new NextRequest(`${base}/api/agent-sidebar-chats`, {
        method: "POST", body: JSON.stringify({ projectId: 15, agentId: "agent-1" }),
        headers: { Host: new URL(base).host, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      });
      if (base.includes("127.0.0.1")) assert.equal(request.nextUrl.hostname, "localhost", "positive control must exercise Next's normalization");
      const response = await routes.roster.POST(request);
      const accepted = origin === base;
      assert.equal(response.status, accepted ? 200 : 403, `${base} from ${origin}: ${JSON.stringify(await response.json())}`);
      assert.deepEqual(writes, accepted ? ["open"] : [], "origin rejection must precede any conversation writes");
    }
  }
  reset();
  const crossLoopback = new NextRequest("http://127.0.0.1:3100/api/agent-sidebar-chats", {
    method: "POST", body: JSON.stringify({ projectId: 15, agentId: "agent-1" }),
    headers: { Host: "127.0.0.1:3100", Origin: "http://localhost:3100", "Content-Type": "application/json" },
  });
  assert.equal((await routes.roster.POST(crossLoopback)).status, 403, "localhost and 127.0.0.1 are distinct browser origins");
  assert.deepEqual(writes, []);
});
