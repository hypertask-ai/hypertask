const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const response = { json: (body, options) => ({ status: options?.status ?? 200, body }) };
const boardScope = { OR: [{ ownerId: 985 }, { members: { some: { userId: 985, status: "Accepted" } } }] };
const flags = { isFeatureEnabled: () => assert.fail("retired room flag queried") };

test("room listing keeps session authentication and board scope without a flag lookup", async () => {
  let session = null;
  const queries = [];
  const { GET } = load("src/app/api/agent-rooms/route.ts", {
    "next/server": { NextResponse: response },
    "@/lib/prisma": { project: { findMany: async (query) => {
      queries.push(query);
      return [{ id: 7049, title: "QA board", agentRoom: { id: "room-1" }, members: [] }];
    } } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
    "@/lib/flags": flags,
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (id) => {
      assert.equal(id, 985);
      return boardScope;
    } },
  });
  const request = { headers: new Headers() };
  assert.equal((await GET(request)).status, 404);
  assert.equal(queries.length, 0);
  session = { userId: 985 };
  assert.deepEqual((await GET(request)).body, {
    success: true, rooms: [{ id: "room-1", projectId: 7049, name: "QA board", agents: [] }],
  });
  assert.deepEqual(queries[0].where, { status: "Normal", ...boardScope });
});

test("room access retains board membership and rejects missing or revoked agents", async () => {
  let agent = null;
  const queries = [];
  const access = load("src/lib/agents/roomAccess.ts", {
    "@/lib/prisma": {
      agent: { findFirst: async (query) => {
        assert.deepEqual(query.where, { id: "agent-1", revokedAt: null, archivedAt: null });
        return agent;
      } },
      agentRoom: { findFirst: async (query) => { queries.push(query); return { id: "room-1" }; } },
    },
    "@/lib/flags": flags,
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => boardScope },
  });
  assert.deepEqual(await access.loadUserAgentRoom("room-1", 985), { id: "room-1" });
  assert.deepEqual(queries.pop().where, { id: "room-1", project: { status: "Normal", ...boardScope } });
  assert.equal(await access.loadAgentTokenRoom("room-1", "agent-1"), null);
  assert.equal(queries.length, 0);
  agent = { id: "agent-1", userId: 985 };
  assert.deepEqual(await access.loadAgentTokenRoom("room-1", "agent-1", { userId: 985, teamScope: "team-1" }), { id: "room-1" });
  assert.deepEqual(queries.pop().where.project, {
    ...boardScope, status: "Normal", members: { some: {
      agentId: "agent-1", status: "Accepted", agent: { revokedAt: null, archivedAt: null },
    } },
  });
});

test("MCP pending dispatch keeps authentication, agent-only access and scoped deliveries", async () => {
  let context = null;
  const queries = [];
  const { GET } = load("src/app/api/mcp/chat/rooms/pending/route.ts", {
    "next/server": { NextResponse: response },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => context,
    },
    "@/lib/prisma": { agentRoomDelivery: { findMany: async (query) => {
      queries.push(query);
      return [{ message: { id: "message-1", roomId: "room-1", content: "Read only", botTurnDepth: 1, authorAgent: { displayName: "QA agent" } } }];
    } } },
    "@/lib/flags": flags,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => boardScope },
  });
  assert.equal((await GET({})).status, 401);
  context = { user: { id: 985 } };
  assert.equal((await GET({})).status, 403);
  assert.equal(queries.length, 0);
  context = { user: { id: 985 }, agentId: "agent-1", teamScope: "team-1" };
  assert.deepEqual((await GET({})).body, { success: true, messages: [{
    id: "message-1", roomId: "room-1", text: "Read only", userName: "QA agent", ticketNumber: null, botTurnDepth: 1,
  }] });
  assert.equal(queries[0].where.agentId, "agent-1");
  assert.equal(queries[0].where.handledAt, null);
  assert.deepEqual(queries[0].where.message.room.project, {
    ...boardScope, status: "Normal", members: { some: {
      agentId: "agent-1", status: "Accepted", agent: { revokedAt: null, archivedAt: null },
    } },
  });
  assert.equal(queries[0].take, 50);
});
