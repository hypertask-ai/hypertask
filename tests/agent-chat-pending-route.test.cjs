const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const root = path.resolve(__dirname, "..");
let authContext = {
  agentId: "agent-polling",
  user: { id: 6, displayName: "Valentin" },
};
let rows = [];
let queryArgs = null;
const heartbeats = [];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/prisma.ts", {
  default: {
    agent: {
      updateMany: async (args) => {
        heartbeats.push(args);
        return { count: 1 };
      },
    },
    $queryRaw: async (...args) => {
      queryArgs = args;
      return rows;
    },
  },
});
stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateMcpAuth: async () => authContext,
});

const route = createJiti(
  path.join(root, "tests/agent-chat-pending-route-entry.cjs"),
  { alias: { "@": path.join(root, "src") }, interopDefault: true },
)(path.join(root, "src/app/api/mcp/chat/pending/route.ts"));

const request = () =>
  new Request("https://app.hypertask.ai/api/mcp/chat/pending", {
    headers: { authorization: "Bearer agent-token" },
  });

test("pending chat returns unanswered messages in the daemon contract", async () => {
  rows = [
    {
      id: "message-1",
      sessionId: "session-1",
      text: "Are you there?",
      userName: "Valentin",
    },
  ];

  const response = await route.GET(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, messages: rows });
  assert.deepEqual(heartbeats[0].where, {
    id: "agent-polling",
    revokedAt: null,
  });
  assert.ok(heartbeats[0].data.heartbeatAt instanceof Date);
  assert.equal(queryArgs[1], "agent-polling");
  const sql = queryArgs[0].join("?");
  assert.match(sql, /session\."agentId" =/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /reply\."replyToMessageId" = message\."id"/);
});

test("pending chat rejects a user token", async () => {
  authContext = { agentId: null, user: { id: 6, displayName: "Valentin" } };

  const response = await route.GET(request());
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.success, false);
  assert.match(body.error, /agent token/i);
});
