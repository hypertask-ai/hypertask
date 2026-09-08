const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;
let flagEnabled = true;
let agentRow = { id: "agent-1", userId: 6, revokedAt: null };
let sessionRow = { id: "session-1", userId: 6, agentId: "agent-1" };
let messageRows = [];
let broadcastCalls = [];

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function load(relativePath) {
  return createJiti(
    path.join(root, `manager-loop-chat-activity-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

function makePrisma() {
  return {
    agent: {
      findFirst: async ({ where }) =>
        agentRow && where.id === agentRow.id && where.revokedAt === null
          ? agentRow
          : null,
    },
    chatSession: {
      findFirst: async ({ where }) =>
        sessionRow &&
        where.userId === sessionRow.userId &&
        where.agentId === sessionRow.agentId
          ? { ...sessionRow }
          : null,
      createMany: async ({ data }) => {
        const wantsOwnerThread = data.some(
          (row) => row.userId === 6 && row.agentId === "agent-1"
        );
        if (!wantsOwnerThread || sessionRow) {
          return { count: 0 };
        }
        sessionRow = { id: "session-1", userId: 6, agentId: "agent-1" };
        return { count: 1 };
      },
      update: async () => ({}),
    },
    chatMessage: {
      createMany: async ({ data }) => {
        const row = data[0];
        if (messageRows.some((existing) => existing.id === row.id)) {
          return { count: 0 };
        }
        messageRows.push({ ...row });
        return { count: 1 };
      },
      findUnique: async ({ where: { id } }) =>
        messageRows.find((row) => row.id === id) || null,
    },
  };
}

async function loadRoute() {
  const prisma = makePrisma();
  stub("src/lib/prisma.ts", { default: prisma });
  stub("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => ({
      agentId: agentTokenIsAgent ? "agent-1" : null,
    }),
  });
  stub("src/lib/flags.ts", {
    MANAGER_LOOP_ACTIVITY_FLAG: "htpr-6243-manager-loop-activity",
    isFeatureEnabled: async (key, userId) => {
      assert.equal(key, "htpr-6243-manager-loop-activity");
      assert.equal(userId, 6);
      return flagEnabled;
    },
  });
  stub("src/lib/agents/chatBroadcast.ts", {
    broadcastChatSession: async (sessionId) => {
      broadcastCalls.push(sessionId);
    },
  });
  return load("src/app/api/mcp/chat/activity/route.ts");
}

let agentTokenIsAgent = true;

function resetState() {
  flagEnabled = true;
  agentTokenIsAgent = true;
  agentRow = { id: "agent-1", userId: 6, revokedAt: null };
  sessionRow = { id: "session-1", userId: 6, agentId: "agent-1" };
  messageRows.length = 0;
  broadcastCalls.length = 0;
}

function makeRequest(body) {
  return new Request("http://localhost/api/mcp/chat/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

test("happy path stores one agent-authored activity message and broadcasts", async () => {
  resetState();
  const { POST } = await loadRoute();
  const response = await POST(
    makeRequest({ text: "Manager loop 07:20 UTC — quiet tick", clientMessageId: "20260908T072000Z" })
  );
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(body.duplicate, false);
  assert.equal(messageRows.length, 1);
  assert.equal(messageRows[0].sessionId, "session-1");
  assert.equal(messageRows[0].role, "assistant");
  assert.equal(messageRows[0].authorAgentId, "agent-1");
  assert.equal(messageRows[0].authorUserId, undefined);
  assert.equal(messageRows[0].isDelivered, true);
  assert.match(messageRows[0].id, /^loop-activity-agent-1-20260908T072000Z$/);
  assert.deepEqual(broadcastCalls, ["session-1"]);
});

test("replay with the same clientMessageId stores nothing new but repairs the broadcast", async () => {
  resetState();
  const { POST } = await loadRoute();
  const first = await json(
    await POST(
      makeRequest({ text: "Manager loop 07:20 UTC — quiet tick", clientMessageId: "20260908T072000Z" })
    )
  );
  assert.equal(first.duplicate, false);
  const body = await json(
    await POST(
      makeRequest({ text: "Manager loop 07:20 UTC — quiet tick", clientMessageId: "20260908T072000Z" })
    )
  );
  assert.equal(body.success, true);
  assert.equal(body.duplicate, true);
  assert.equal(messageRows.length, 1);
  // The replay repairs side effects: the session is refreshed and broadcast again.
  assert.deepEqual(broadcastCalls, ["session-1", "session-1"]);
});

test("flag off stores nothing", async () => {
  resetState();
  flagEnabled = false;
  const { POST } = await loadRoute();
  const response = await POST(
    makeRequest({ text: "Manager loop", clientMessageId: "20260908T074000Z" })
  );
  assert.equal(response.status, 403);
  assert.equal(messageRows.length, 0);
  flagEnabled = true;
});

test("non-agent token is rejected", async () => {
  resetState();
  agentTokenIsAgent = false;
  const { POST } = await loadRoute();
  const response = await POST(
    makeRequest({ text: "Manager loop", clientMessageId: "20260908T074100Z" })
  );
  assert.equal(response.status, 403);
  agentTokenIsAgent = true;
});

test("missing session is created for the agent owner", async () => {
  resetState();
  sessionRow = null;
  const { POST } = await loadRoute();
  const response = await POST(
    makeRequest({ text: "Manager loop", clientMessageId: "20260908T074200Z" })
  );
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(messageRows.at(-1).sessionId, "session-1");
  sessionRow = { id: "session-1", userId: 6, agentId: "agent-1" };
});

test("bad client id and empty text are refused before any write", async () => {
  resetState();
  const { POST } = await loadRoute();
  assert.equal(
    (await POST(makeRequest({ text: "x", clientMessageId: "short" }))).status,
    400
  );
  assert.equal(
    (await POST(makeRequest({ text: "   ", clientMessageId: "20260908T074300Z" }))).status,
    400
  );
  assert.equal(messageRows.length, 0);
});
