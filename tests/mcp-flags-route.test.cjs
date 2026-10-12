const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let ctx;
let owner;
let limited;
let writes;
let calls;
let broadcasts;
let broadcastFails;
let writeError;
let previousMode;
let approvalComment;
let approvalQueries;
class FeatureFlagInputError extends Error {}
const key = "htpr-6136-figma-connect";
const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
const rows = [{ key, mode: "OWNER_AND_QA" }, { key: "legacy-rollout", mode: "OFF" }];
stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => { calls.push("rate-limit"); return limited; },
  validateMcpAuth: async (_request, options) => {
    calls.push("auth");
    assert.deepEqual(options, { deferManagementPermissionCheck: true });
    return ctx;
  },
});
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
  FeatureFlagInputError,
  defaultFeatureFlagMode: () => "OWNER_AND_QA",
  isFeatureFlagOwnerUserId: async (userId) => { calls.push("owner"); return owner && userId === 6; },
  listFeatureFlagModes: async (options) => { calls.push("list"); assert.deepEqual(options, { includeTicketTitles: true, includeLastChange: true }); return rows; },
  setFeatureFlagMode: async (...args) => {
    writes.push(args);
    if (writeError) throw writeError;
    return {
      key: args[0], mode: args[1],
      lastChange: previousMode === undefined ? null : { oldMode: previousMode, newMode: args[1], actorName: "Runner 3", reason: args[2].reason, createdAt: new Date() },
    };
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    comment: {
      findFirst: async (query) => {
        calls.push("approval");
        approvalQueries.push(query);
        assert.deepEqual(query.select, { commentText: true, text: true });
        assert.equal(query.where.id, 123);
        assert.deepEqual(query.where.task, { projectId: 4060, uniqueIndex: 215, status: { not: "Deleted" } });
        const reaction = query.where.reactions.some;
        assert.deepEqual({ ...reaction, createdAt: undefined }, {
          userId: 6, agentId: null, agentDisplayName: null, isDeleted: false,
          unified: { startsWith: "1f44d" }, createdAt: undefined,
        });
        assert.ok(reaction.createdAt.gte instanceof Date);
        assert.ok(Math.abs(Date.now() - reaction.createdAt.gte - 7 * 24 * 60 * 60 * 1000) < 1000);
        if (!approvalComment || approvalComment.id !== query.where.id
          || approvalComment.task.projectId !== query.where.task.projectId
          || approvalComment.task.uniqueIndex !== query.where.task.uniqueIndex
          || approvalComment.task.status === query.where.task.status.not) return null;
        const approved = approvalComment.reactions.some(row => row.userId === reaction.userId
          && row.agentId === reaction.agentId && row.agentDisplayName === reaction.agentDisplayName
          && row.isDeleted === reaction.isDeleted && row.unified.startsWith(reaction.unified.startsWith)
          && row.createdAt >= reaction.createdAt.gte);
        return approved ? { commentText: approvalComment.commentText, text: approvalComment.text } : null;
      },
    },
    agent: {
      findUniqueOrThrow: async (query) => {
        assert.deepEqual(query, { where: { id: "runner-3" }, select: { displayName: true } });
        calls.push("agent");
        return { displayName: "Runner 3" };
      },
    },
  },
});
stubModule("src/lib/realtime/server.ts", {
  broadcastFeatureFlagsChange: async () => {
    broadcasts++;
    if (broadcastFails) throw new Error("broadcast unavailable");
  },
});
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { GET, PATCH } = jiti(path.join(root, "src/app/api/mcp/flags/route.ts"));
function request(method = "GET", body, query = "", contentType = "application/json") {
  return new NextRequest(`https://app.hypertask.ai/api/mcp/flags${query}`, {
    method,
    headers: { authorization: "Bearer test-credential", "content-type": contentType },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function result(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { status: response.status, body: await response.json() };
}
test.beforeEach(() => {
  ctx = { user: { id: 6, email: "valentin.yeo@gmail.com" }, agentId: "runner-3" };
  owner = true; limited = null; writes = []; calls = []; broadcasts = 0;
  broadcastFails = false; writeError = null; previousMode = "OWNER_AND_QA";
  approvalQueries = [];
  approvalComment = {
    id: 123, task: { projectId: 4060, uniqueIndex: 215, status: "Normal" },
    commentText: `Question: Switch ${key} to Off?`, text: null,
    reactions: [{ userId: 6, agentId: null, agentDisplayName: null, unified: "1f44d", isDeleted: false, createdAt: new Date() }],
  };
});

for (const method of ["GET", "PATCH"]) {
  const execute = method === "GET" ? GET : PATCH;
  test(`${method} returns 401 without auth and never reads flags`, async () => {
    ctx = null;
    const response = await execute(request(method, method === "PATCH" ? { key, mode: "OFF", reason } : undefined));
    assert.deepEqual(await result(response), { status: 401, body: { error: "Unauthorized" } });
    assert.deepEqual(calls, ["rate-limit", "auth"]);
    assert.equal(writes.length, 0);
  });
  for (const rejected of ["plain user", "management key", "non-owner agent", "mismatched owner identity"]) {
    test(`${method} refuses ${rejected}`, async () => {
      if (rejected === "plain user") ctx.agentId = null;
      if (rejected === "management key") ctx.management = { keyId: "htmk_test", permissions: {} };
      if (rejected === "non-owner agent") ctx.user.id = 7;
      if (rejected === "mismatched owner identity") owner = false;
      assert.equal((await result(await execute(request(method)))).status, 403);
      assert.equal(calls.includes("list"), false);
      assert.equal(calls.includes("agent"), false);
      assert.equal(writes.length, 0);
    });
  }
  test(`${method} checks rate limit before authentication`, async () => {
    limited = NextResponse.json({ error: "Too many requests" }, { status: 429 });
    assert.equal((await result(await execute(request(method)))).status, 429);
    assert.deepEqual(calls, ["rate-limit"]);
  });
}

test("GET returns all flags or a single flag and 404 for an unknown key", async () => {
  assert.deepEqual(await result(await GET(request())), { status: 200, body: { flags: rows } });
  assert.deepEqual(await result(await GET(request("GET", undefined, `?key=${key}`))), { status: 200, body: { flag: rows[0] } });
  assert.equal((await result(await GET(request("GET", undefined, "?key=missing")))).status, 404);
});

for (const badReason of [
  "https://app.hypertask.ai/detail/project-4060/215",
  "https://app.hypertask.ai/page/approval#comment-123",
  "https://evil.test/detail/project-4060/215#comment-123",
  "https://app.hypertask.ai.evil.test/detail/project-4060/215#comment-123",
  "https://app.hypertask.ai@evil.test/detail/project-4060/215#comment-123",
  `${reason}junk`, `${reason}?extra=1`, `${reason}/extra`, `${reason}#extra`,
  "https://app.hypertask.ai/detail/project-4060/215?extra=1#comment-123",
  "https://app.hypertask.ai/detail/project-4060/215#comment-0",
  "https://app.hypertask.ai/detail/project-4060/215#comment-1000000000",
  undefined, null, "", "not a URL", "http://app.hypertask.ai/detail/project-4060/215", "https://evil.test/detail/approval", "https://app.hypertask.ai.evil.test/page/approval", "https://app.hypertask.ai@evil.test/page/approval", "https://app.hypertask.ai/admin/flags", "https://app.hypertask.ai/page/approval", "https://app.hypertask.ai/detail/project-4060/215/extra", "https://app.hypertask.ai/detail/project-4060/2147483648", "https://app.hypertask.ai/detail/../admin/flags", "https://app.hypertask.ai/page/" + "a".repeat(500)]) {
  test(`PATCH rejects invalid reason ${JSON.stringify(badReason)}`, async () => {
    assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason: badReason }))), {
      status: 400, body: { error: "Reason must link to the approved ticket comment (#comment-<id>)" },
    });
    assert.equal(writes.length, 0);
    assert.equal(approvalQueries.length, 0);
    assert.equal(calls.includes("agent"), false);
  });
}
for (const body of [null, [], { key, reason }, { key, mode: "off", reason }, { key: 123, mode: "OFF", reason }]) {
  test(`PATCH rejects invalid body ${JSON.stringify(body)}`, async () => {
    assert.equal((await result(await PATCH(request("PATCH", JSON.stringify(body))))).status, 400);
    assert.equal(writes.length, 0);
  });
}

test("PATCH enforces JSON, malformed JSON and the admin body limit", async () => {
  assert.equal((await result(await PATCH(request("PATCH", "{}", "", "text/plain")))).status, 415);
  assert.equal((await result(await PATCH(request("PATCH", "{")))).status, 400);
  assert.equal((await result(await PATCH(request("PATCH", " ".repeat(1025))))).status, 413);
  assert.equal(writes.length, 0);
});

test("PATCH passes the authenticated actor, returns previous mode and broadcasts", async () => {
  const response = await result(await PATCH(request("PATCH", { key, mode: "OFF", reason, userId: 7, agentName: "Fake" })));
  assert.equal(response.status, 200);
  assert.equal(response.body.flag.mode, "OFF");
  assert.equal(response.body.previousMode, "OWNER_AND_QA");
  assert.deepEqual(writes, [[key, "OFF", { userId: 6, agentId: "runner-3", agentName: "Runner 3", reason, source: "api" }]]);
  assert.equal(broadcasts, 1);
  assert.deepEqual(calls, ["rate-limit", "auth", "owner", "approval", "agent"]);
});

test("PATCH handles an unstored default or unchanged mode", async () => {
  previousMode = null;
  const changed = await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })));
  assert.equal(changed.status, 200);
  assert.equal(changed.body.previousMode, "OWNER_AND_QA");
  previousMode = undefined;
  const unchanged = await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })));
  assert.equal(unchanged.body.previousMode, "OFF");
});

test("PATCH returns input errors and tolerates a failed realtime broadcast", async (t) => {
  t.mock.method(console, "warn", () => {});
  writeError = new FeatureFlagInputError("Unknown feature flag");
  assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason }))), { status: 400, body: { error: "Unknown feature flag" } });
  assert.equal(broadcasts, 0);
  writeError = null; broadcastFails = true;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
});

test("PATCH hides internal errors", async (t) => {
  t.mock.method(console, "error", () => {});
  writeError = new Error("database unavailable");
  assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason }))), { status: 500, body: { error: "Unable to update feature flag" } });
});

for (const [mode, label] of [["OFF", "Off"], ["EVERYONE", "Everyone"], ["OWNER_AND_QA", "Owner + QA"], ["OWNER_ONLY", "Only me"]]) {
  test(`PATCH accepts owner thumbs up on a comment naming the flag and ${label}`, async () => {
    approvalComment.commentText = `Question: Switch ${key} to ${label}?`;
    assert.equal((await result(await PATCH(request("PATCH", { key, mode, reason })))).status, 200);
    assert.equal(approvalQueries.length, 1);
  });
}

test("PATCH accepts thumbs up with a skin tone and falls back to text", async () => {
  approvalComment.commentText = null;
  approvalComment.text = `Question: Switch ${key} to Off?`;
  approvalComment.reactions[0].unified = "1f44d-1f3fd";
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
  assert.equal(approvalQueries.length, 1);
});

for (const rejected of ["missing key", "wrong mode", "empty comment", "text overridden by commentText", "no reaction", "agent reaction", "deleted agent reaction", "non-thumbs emoji", "old reaction", "other user reaction", "deleted reaction", "unknown comment", "different comment", "wrong project", "wrong ticket", "deleted ticket"]) {
  test(`PATCH refuses approval from ${rejected}`, async () => {
    const reaction = approvalComment.reactions[0];
    if (rejected === "missing key") approvalComment.commentText = "Question: Switch another-flag to Off?";
    if (rejected === "wrong mode") approvalComment.commentText = `Question: Switch ${key} to Everyone?`;
    if (rejected === "empty comment") approvalComment.commentText = null;
    if (rejected === "text overridden by commentText") {
      approvalComment.text = approvalComment.commentText;
      approvalComment.commentText = "Unrelated comment";
    }
    if (rejected === "no reaction") approvalComment.reactions = [];
    if (rejected === "agent reaction") reaction.agentId = "runner-3";
    if (rejected === "deleted agent reaction") reaction.agentDisplayName = "Deleted agent";
    if (rejected === "non-thumbs emoji") reaction.unified = "2764-fe0f";
    if (rejected === "old reaction") reaction.createdAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000);
    if (rejected === "other user reaction") reaction.userId = 7;
    if (rejected === "deleted reaction") reaction.isDeleted = true;
    if (rejected === "different comment") approvalComment.id = 124;
    if (rejected === "wrong project") approvalComment.task.projectId = 15;
    if (rejected === "wrong ticket") approvalComment.task.uniqueIndex = 216;
    if (rejected === "deleted ticket") approvalComment.task.status = "Deleted";
    if (rejected === "unknown comment") approvalComment = null;
    assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason }))), {
      status: 403, body: { error: "Valentin must thumbs-up that comment within 7 days, and it must name the flag key and the target mode" },
    });
    assert.equal(writes.length, 0);
    assert.equal(broadcasts, 0);
    assert.deepEqual(calls, ["rate-limit", "auth", "owner", "approval"]);
    assert.equal(approvalQueries.length, 1);
  });
}
