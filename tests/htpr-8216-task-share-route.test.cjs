const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { load } = require("./task-route-loader.cjs");

function fixture(options = {}) {
  const calls = [], flags = [];
  const auth = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => auth,
      mcpRouteUnauthorizedResponse: async () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
      withMcpRouteMutationLease: async (_client, _actor, run) => run(),
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/mcp/listParams": { findIdParamOutOfRange: () => null, idOutOfRangeMessage: () => "" },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => auth.user },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      assert.equal(key, "htpr-8216-agent-task-share");
      assert.equal(userId, auth.user.id);
      return options.flagEnabled !== false;
    } },
    "@/lib/prisma": { default: {} },
    "@/lib/tasks/taskSharing": {
      shareTaskWithLink: async ({ taskId }) => {
        calls.push({ door: "share", taskId });
        return { status: 200, body: { taskId, ticketNumber: "HTPR-42", isPublic: true, link: "https://app.hypertask.ai/share?id=share-1", shareType: "Anyone" } };
      },
      readTaskShare: async ({ taskId }) => {
        calls.push({ door: "read", taskId });
        return { status: 200, body: { taskId, ticketNumber: "HTPR-42", isPublic: false, link: null, shareType: null } };
      },
    },
  };
  const { GET, POST } = load("src/lib/mcp/operations/tasks/share/operation.ts", mocks);
  return {
    calls,
    flags,
    get: (taskId) => GET(new NextRequest(`http://mcp.test/api/mcp/tasks/share?taskId=${taskId}`, { method: "GET" })),
    post: (body) => POST(new NextRequest("http://mcp.test/api/mcp/tasks/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })),
  };
}

test("the share door returns the public link", async () => {
  const f = fixture();
  const response = await f.post({ taskId: 42 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.share.link, "https://app.hypertask.ai/share?id=share-1");
  assert.equal(body.share.isPublic, true);
  assert.deepEqual(f.calls, [{ door: "share", taskId: 42 }]);
});

test("the read door says whether the ticket is public", async () => {
  const f = fixture();
  const response = await f.get(42);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.share.isPublic, false);
  assert.equal(body.share.link, null);
  assert.deepEqual(f.calls, [{ door: "read", taskId: 42 }]);
});

test("flag off: both doors refuse before any share write or read", async () => {
  const f = fixture({ flagEnabled: false });
  const write = await f.post({ taskId: 42 });
  assert.equal(write.status, 404);
  assert.equal((await write.json()).error, "Ticket sharing is not enabled");
  const read = await f.get(42);
  assert.equal(read.status, 404);
  assert.equal((await read.json()).error, "Ticket sharing is not enabled");
  assert.deepEqual(f.calls, []);
});

test("a missing or non-integer taskId is refused", async () => {
  const f = fixture();
  const missing = await f.get("abc");
  assert.equal(missing.status, 400);
  const bad = await f.post({ taskId: "42" });
  assert.equal(bad.status, 400);
  assert.deepEqual(f.calls, []);
});
