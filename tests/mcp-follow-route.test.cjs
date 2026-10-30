const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8217-agent-follow-reminder";

function fixture(options = {}) {
  const calls = [], flags = [], guarded = [];
  const auth = options.noAuth ? null : { user: { id: 7 }, agentId: "agent-owner", agentRole: "write" };
  const mocks = {
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      assert.equal(userId, 7);
      return options.flagEnabled !== false;
    } },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async (ctx) => {
      guarded.push(ctx.agentId);
      return null;
    } },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => auth,
      mcpRouteUnauthorizedResponse: async () => new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 }),
      withMcpRouteMutationLease: async (_client, _actor, run) => run(),
    },
    "@/lib/prisma": { default: {} },
    "@/lib/tasks/taskTracking": { setTaskTracking: async (input) => {
      calls.push(input);
      if (options.missingTask) return { status: 404, body: { message: "Task not found" } };
      return { status: 200, body: { taskId: input.taskId, action: input.action, following: input.action === "follow", starred: false, remindAt: input.remindAt ?? null, reminderId: null } };
    } },
  };
  const { POST } = load("src/app/api/mcp/tasks/follow/route.ts", mocks);
  const post = (body, raw = false) => POST(new Request("http://mcp.test/api/mcp/tasks/follow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  }));
  return { post, calls, flags, guarded };
}

test("an agent follows a ticket and the door answers with the read-back state", async () => {
  const f = fixture();
  const body = await (await f.post({ action: "follow", taskId: 42 })).json();
  assert.equal(body.success, true);
  assert.equal(body.following, true);
  assert.deepEqual(f.calls.map(({ action, taskId }) => ({ action, taskId })), [{ action: "follow", taskId: 42 }]);
  assert.equal(f.calls[0].currentUser.id, 7);
  assert.equal(f.calls[0].agentId, "agent-owner");
  assert.deepEqual(f.flags, [{ key: FLAG, userId: 7 }]);
  assert.deepEqual(f.guarded, ["agent-owner"]);
});

test("unfollow, star, unstar, remind and read each reach the same write door", async () => {
  const f = fixture();
  for (const body of [
    { action: "unfollow", taskId: 42 },
    { action: "star", taskId: 42 },
    { action: "unstar", taskId: 42 },
    { action: "remind", taskId: 42, remindAt: "2026-11-02T09:00:00Z" },
    { action: "read", taskId: 42 },
  ]) {
    const response = await f.post(body);
    assert.equal(response.status, 200, body.action);
  }
  assert.deepEqual(f.calls.map((call) => call.action), ["unfollow", "star", "unstar", "remind", "read"]);
  assert.equal(f.calls[3].remindAt, "2026-11-02T09:00:00Z");
});

test("a read never needs the write role and never asks for a mutation lease", async () => {
  const f = fixture();
  await f.post({ action: "read", taskId: 42 });
  assert.deepEqual(f.guarded, []);
});

test("the agent flag off refuses the door before any write", async () => {
  const f = fixture({ flagEnabled: false });
  const response = await f.post({ action: "follow", taskId: 42 });
  assert.equal(response.status, 404);
  assert.deepEqual(f.calls, []);
});

test("an unknown action, a bad task id and remind without a date are refused with 400", async () => {
  const f = fixture();
  for (const body of [
    { action: "pin", taskId: 42 },
    { action: "follow", taskId: "42" },
    { action: "remind", taskId: 42 },
    { action: "follow", taskId: 0 },
  ]) {
    const response = await f.post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(f.calls, []);
});

test("an unreadable body answers 400 without writing", async () => {
  const f = fixture();
  const response = await f.post("{bad", true);
  assert.equal(response.status, 400);
  assert.deepEqual(f.calls, []);
});

test("a task the agent cannot reach answers 404 with a plain message", async () => {
  const f = fixture({ missingTask: true });
  const response = await f.post({ action: "follow", taskId: 42 });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Task not found");
});
