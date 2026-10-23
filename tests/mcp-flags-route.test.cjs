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

stubModule("src/lib/auth/agentScope.ts", require("./helpers/agent-board-scope.cjs").enforcedScope);

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
let lockQueries;
let batchFlagOn;
let commentLockLost;
let storedFlag;
let defaultMode;
let comments;
let commentFails;
let ticketWritable;
let ticketQueries;
let errorReports;
let reportingFails;
const originalWatchAgentId = process.env.FLAG_RELEASE_WATCH_AGENT_ID;
class FeatureFlagInputError extends Error {}
class FeatureFlagApprovalError extends Error {}
const key = "htpr-3533-google-calendar";
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
  FeatureFlagApprovalError,
  defaultFeatureFlagMode: () => defaultMode,
  isFeatureEnabled: async (flagKey, userId) => {
    if (flagKey === "htpr-7665-agent-read-role-guard") return true;
    assert.equal(flagKey, "htpr-7364-batch-flag-approval");
    assert.equal(userId, 6);
    return batchFlagOn;
  },
  isFeatureFlagOwnerUserId: async (userId) => { calls.push("owner"); return owner && userId === 6; },
  listFeatureFlagModes: async (options) => { calls.push("list"); assert.deepEqual(options, { includeTicketTitles: true, includeLastChange: true, principal: { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope } }); return rows; },
  setFeatureFlagMode: async (...args) => {
    if (writeError) throw writeError;
    assert.equal(typeof args[3], "function");
    await args[3](tx);
    calls.push("write");
    writes.push(args.slice(0, 3));
    return {
      key: args[0], mode: args[1],
      lastChange: previousMode === undefined ? null : { oldMode: previousMode, newMode: args[1], actorName: "Runner 3", reason: args[2].reason, createdAt: new Date() },
    };
  },
});
const tx = {
  featureFlag: { findUnique: async () => storedFlag },
  $queryRaw: async (strings, commentId, taskId, projectId) => {
    const sql = strings.join("?");
    const commentLock = lockQueries.length % 2 === 0;
    assert.equal(sql, commentLock
      ? 'SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ? AND t.id = ? AND t."projectId" = ? FOR UPDATE'
      : 'SELECT id FROM "Reaction" WHERE "commentId" = ? FOR UPDATE');
    assert.equal(commentId, 123);
    assert.equal(taskId, commentLock ? 900 : undefined);
    assert.equal(projectId, commentLock ? 4060 : undefined);
    lockQueries.push({ sql, commentId });
    calls.push(commentLock ? "comment-lock" : "reaction-lock");
    return approvalComment && !(commentLock && commentLockLost) ? [{ id: commentId }] : [];
  },
  comment: {
    findFirst: async (query) => {
      if (query.select.taskId) return approvalComment && approvalComment.id === query.where.id && approvalComment.task.projectId === query.where.task.projectId && approvalComment.task.uniqueIndex === query.where.task.uniqueIndex && approvalComment.task.status !== "Deleted" ? { taskId: 900 } : null;
      assert.deepEqual(calls.slice(-2), ["comment-lock", "reaction-lock"]);
      assert.equal(lockQueries.length, 2 * (approvalQueries.length + 1));
      calls.push("approval");
      approvalQueries.push(query);
      const reaction = query.where.reactions.some;
      assert.deepEqual(query.select, { commentText: true, text: true });
      assert.equal(query.where.id, 123);
      assert.equal(query.where.editedAt, null);
      assert.deepEqual({ ...query.where.task, project: undefined }, { projectId: 4060, uniqueIndex: 215, status: { not: "Deleted" }, project: undefined });
      assert.deepEqual(query.where.task.project, { OR: [{ members: { some: { agentId: "runner-3", status: "Accepted", agent: { userId: 6, revokedAt: null } } } }] });
      assert.deepEqual({ ...reaction, createdAt: undefined }, {
        userId: 6, agentId: null, agentDisplayName: null, isDeleted: false,
        unified: { startsWith: "1f44d" }, createdAt: undefined,
      });
      assert.ok(reaction.createdAt.gte instanceof Date);
      assert.ok(Math.abs(Date.now() - reaction.createdAt.gte - 7 * 24 * 60 * 60 * 1000) < 1000);
      if (!approvalComment || approvalComment.id !== query.where.id
        || (query.where.editedAt === null && approvalComment.editedAt !== null)
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
};
stubModule("src/lib/prisma.ts", {
  default: {
    task: { findFirst: async (query) => {
      ticketQueries.push(query);
      assert.deepEqual(query, { where: { projectId: 15, uniqueIndex: 3533, status: { not: "Deleted" }, project: ctx.teamScope ? { AND: [{ OR: [{ members: { some: { agentId: "runner-3", status: "Accepted", agent: { userId: 6, revokedAt: null } } } }] }, { teamId: ctx.teamScope.teamId }] } : { OR: [{ members: { some: { agentId: "runner-3", status: "Accepted", agent: { userId: 6, revokedAt: null } } } }] } }, select: { id: true, userId: true } });
      return ticketWritable ? { id: 42, userId: 6 } : null;
    } },
    user: { findUniqueOrThrow: async () => ({ id: 6, displayName: "Valentin", email: "owner@test" }) },
    agent: {
      findUnique: async () => ({ permissions: { role: ctx.agentRole } }),
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
stubModule("src/utils/controllers/comments/createCommentService.ts", { createCommentService: async (input) => {
  if (commentFails) throw new Error("comment unavailable");
  comments.push(input);
  return { id: 1 };
} });
stubModule("src/lib/errors/reportError.ts", { reportError: async (report) => {
  errorReports.push(report);
  if (reportingFails) throw new Error("reporting unavailable");
} });
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
  process.env.FLAG_RELEASE_WATCH_AGENT_ID = "runner-3";
  errorReports = []; reportingFails = false;
  ctx = { user: { id: 6, email: "valentin.yeo@gmail.com" }, agentId: "runner-3", agentRole: "write" };
  storedFlag = { mode: "EVERYONE", releasedAt: new Date(Date.now() - 40 * 60_000) };
  defaultMode = "OWNER_AND_QA"; comments = []; commentFails = false; ticketWritable = true; ticketQueries = [];
  owner = true; limited = null; writes = []; calls = []; broadcasts = 0;
  broadcastFails = false; writeError = null; previousMode = "OWNER_AND_QA";
  approvalQueries = []; lockQueries = []; batchFlagOn = false; commentLockLost = false;
  approvalComment = {
    id: 123, task: { projectId: 4060, uniqueIndex: 215, status: "Normal" },
    commentText: `Question: Switch ${key} to Off?`, text: null, editedAt: null,
    reactions: [{ userId: 6, agentId: null, agentDisplayName: null, unified: "1f44d", isDeleted: false, createdAt: new Date() }],
  };
});

test.afterEach(() => {
  if (originalWatchAgentId === undefined) delete process.env.FLAG_RELEASE_WATCH_AGENT_ID;
  else process.env.FLAG_RELEASE_WATCH_AGENT_ID = originalWatchAgentId;
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
  assert.deepEqual(calls, ["rate-limit", "auth", "owner", "agent", "comment-lock", "reaction-lock", "approval", "write"]);
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

test("PATCH accepts an HTML-only comment from the API with the mention span", async () => {
  approvalComment.commentText = "";
  approvalComment.text = `<p><strong><span data-type=\"mention\" class=\"mention\" data-id=\"Valentin Yeo\" data-label=\"name-6\">Valentin Yeo</span> Question: Switch ${key} to Off?</strong></p>`;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
});

test("PATCH refuses an HTML-only comment holding a negated request", async () => {
  approvalComment.commentText = "";
  approvalComment.text = `<p><span data-type=\"mention\" class=\"mention\" data-id=\"Valentin Yeo\" data-label=\"name-6\">Valentin Yeo</span> Question: Do not Switch ${key} to Off?</p>`;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 403);
});

test("PATCH accepts the request after the @Valentin Yeo mention", async () => {
  approvalComment.commentText = `@Valentin Yeo Question: Switch ${key} to Off?`;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
});

test("PATCH accepts thumbs up with a skin tone and visible text", async () => {
  approvalComment.commentText = null;
  approvalComment.text = `Question: Switch ${key} to Off?`;
  approvalComment.reactions[0].unified = "1f44d-1f3fd";
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
  assert.equal(approvalQueries.length, 1);
});

for (const rejected of ["missing key", "wrong mode", "refusal naming both modes", "two requests", "prefix key", "no question mark", "negated request", "quoted request", "extra text after", "empty comment", "visible text differs from commentText", "no reaction", "agent reaction", "deleted agent reaction", "non-thumbs emoji", "old reaction", "other user reaction", "deleted reaction", "unknown comment", "different comment", "wrong project", "wrong ticket", "deleted ticket"]) {
  test(`PATCH refuses approval from ${rejected}`, async () => {
    const reaction = approvalComment.reactions[0];
    if (rejected === "missing key") approvalComment.commentText = "Question: Switch another-flag to Off?";
    if (rejected === "wrong mode") approvalComment.commentText = `Question: Switch ${key} to Everyone?`;
    if (rejected === "refusal naming both modes") approvalComment.commentText = `Keep ${key} Off, not Everyone`;
    if (rejected === "two requests") approvalComment.commentText = `Question: Switch ${key} to Off? Or Switch ${key} to Everyone?`;
    if (rejected === "prefix key") approvalComment.commentText = `Question: Switch ${key}-extra to Off?`;
    if (rejected === "negated request") approvalComment.commentText = `Question: Do not Switch ${key} to Off?`;
    if (rejected === "quoted request") approvalComment.commentText = `He said "Question: Switch ${key} to Off?" earlier`;
    if (rejected === "extra text after") approvalComment.commentText = `Question: Switch ${key} to Off? No, keep it.`;
    if (rejected === "no question mark") approvalComment.commentText = `Switch ${key} to Off`;
    if (rejected === "empty comment") approvalComment.commentText = null;
    if (rejected === "visible text differs from commentText") {
      approvalComment.text = "Unrelated comment";
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
      status: 403, body: { error: "Valentin must thumbs-up that comment within 7 days, the comment must be unedited, and the whole comment must be: Question: Switch <flag-key> to <mode>?" },
    });
    assert.equal(writes.length, 0);
    assert.equal(broadcasts, 0);
    const early = ["unknown comment", "different comment", "wrong project", "wrong ticket", "deleted ticket"].includes(rejected);
    assert.deepEqual(calls, early ? ["rate-limit", "auth", "owner", "agent"] : ["rate-limit", "auth", "owner", "agent", "comment-lock", "reaction-lock", "approval"]);
    assert.equal(approvalQueries.length, early ? 0 : 1);
  });
}

for (const edited of ["long ago", "before thumbs up", "at thumbs up", "after thumbs up"]) {
  test(`PATCH refuses an edited comment ${edited} even with a valid thumbs up`, async () => {
    const createdAt = approvalComment.reactions[0].createdAt;
    approvalComment.editedAt = edited === "long ago" ? new Date(0)
      : new Date(createdAt.getTime() + (edited === "before thumbs up" ? -1000 : edited === "after thumbs up" ? 1000 : 0));
    assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason }))), {
      status: 403, body: { error: "Valentin must thumbs-up that comment within 7 days, the comment must be unedited, and the whole comment must be: Question: Switch <flag-key> to <mode>?" },
    });
    assert.equal(approvalQueries[0].where.editedAt, null);
    assert.equal(writes.length, 0);
    assert.equal(broadcasts, 0);
  });
}

test("PATCH accepts an unedited comment with a valid owner thumbs up", async () => {
  assert.equal(approvalComment.editedAt, null);
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
  assert.equal(approvalQueries[0].where.editedAt, null);
  assert.equal(writes.length, 1);
  assert.equal(broadcasts, 1);
});

test("PATCH checks the visible text before legacy commentText", async () => {
  approvalComment.commentText = "Unrelated legacy comment";
  approvalComment.text = `<p>Question: Switch ${key} to Off?</p>`;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
});

test("PATCH locks the comment and task, then reactions before reading approval and writing the flag", async () => {
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
  assert.deepEqual(lockQueries, [
    { sql: 'SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ? AND t.id = ? AND t."projectId" = ? FOR UPDATE', commentId: 123 },
    { sql: 'SELECT id FROM "Reaction" WHERE "commentId" = ? FOR UPDATE', commentId: 123 },
  ]);
  assert.deepEqual(calls.slice(-4), ["comment-lock", "reaction-lock", "approval", "write"]);
});

const batchHtml = `<p>@Valentin Yeo Question: Switch other-flag to Everyone?</p><p>Switch ${key} to Owner + QA?</p><p>Switch third-flag to Off?</p>`;

for (const flagOn of [false, true]) {
  test(`PATCH still allows the one-comment thumbs up with the batch flag ${flagOn ? "on" : "off"}`, async () => {
    batchFlagOn = flagOn;
    assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 200);
    assert.equal(writes.length, 1);
  });
}

test("PATCH still allows a batch thumbs up for each listed flag when the batch flag is on", async () => {
  batchFlagOn = true;
  approvalComment.commentText = "";
  approvalComment.text = batchHtml;
  const response = await result(await PATCH(request("PATCH", { key, mode: "OWNER_AND_QA", reason })));
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [[key, "OWNER_AND_QA", { userId: 6, agentId: "runner-3", agentName: "Runner 3", reason, source: "api" }]]);
});

for (const [name, setup, body] of [
  ["a batch comment while the batch flag is off", () => { batchFlagOn = false; }, { key, mode: "OWNER_AND_QA", reason }],
  ["a mode the batch comment does not list for that flag", () => {}, { key, mode: "EVERYONE", reason }],
  ["a flag the batch comment does not list", () => {}, { key: "htpr-1-unlisted", mode: "OFF", reason }],
  ["a batch comment naming the flag twice", () => {
    approvalComment.text = `<p>Question: Switch ${key} to Owner + QA?</p><p>Switch ${key} to Everyone?</p>`;
  }, { key, mode: "EVERYONE", reason }],
  ["a batch comment with any other text", () => {
    approvalComment.text = `${batchHtml}<p>and also make it faster</p>`;
  }, { key, mode: "OWNER_AND_QA", reason }],
  ["an edited batch comment", () => { approvalComment.editedAt = new Date(); }, { key, mode: "OWNER_AND_QA", reason }],
  ["a batch comment without Valentin's own thumbs up", () => {
    approvalComment.reactions[0].agentId = "runner-3";
  }, { key, mode: "OWNER_AND_QA", reason }],
]) {
  test(`PATCH refuses ${name}`, async () => {
    batchFlagOn = true;
    approvalComment.commentText = "";
    approvalComment.text = batchHtml;
    setup();
    const response = await result(await PATCH(request("PATCH", body)));
    assert.equal(response.status, 403);
    assert.equal(writes.length, 0);
  });
}

test("PATCH stops before reaction locks when the verified comment/task binding changed", async () => {
  commentLockLost = true;
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 403);
  assert.equal(lockQueries.length, 1);
  assert.equal(approvalQueries.length, 0);
  assert.equal(writes.length, 0);
});

const watchBody = () => ({ key, mode: "OFF", reason: "https://app.hypertask.ai/detail/project-15/3533", watch: { before: 4, after: 11, windowMinutes: 40, releasedAt: storedFlag?.releasedAt?.toISOString() ?? new Date(Date.now() - 40 * 60_000).toISOString() } });

test("release watch switches a recent Everyone flag Off and comments as the scoped caller", async () => {
  previousMode = "EVERYONE";
  ctx.teamScope = { teamId: "team-1", accessBinding: "binding-1" };
  const response = await result(await PATCH(request("PATCH", watchBody())));
  assert.equal(response.status, 200);
  assert.equal(response.body.previousMode, "EVERYONE");
  assert.equal(response.body.flag.mode, "OFF");
  assert.equal(response.body.notified, true);
  assert.equal(errorReports.length, 0);
  assert.equal(approvalQueries.length, 0);
  assert.equal(writes.length, 1);
  assert.match(writes[0][2].reason, /^release watch: errors 4 -> 11 in 40 min; https:\/\/app.hypertask.ai\/detail\/project-15\/3533$/);
  assert.equal(comments.length, 1);
  assert.deepEqual({ ...comments[0], text: undefined }, { text: undefined, creatorId: 6, agentId: "runner-3", teamScope: ctx.teamScope, taskId: 42, ownerId: 6, currentUser: { id: 6, displayName: "Valentin", email: "owner@test" } });
  assert.match(comments[0].text, /Switched htpr-3533-google-calendar Off/);
  assert.match(comments[0].text, /4 before \/ 11 after, each over 40 minutes/);
  assert.match(comments[0].text, /data-id="Valentin Yeo" data-label="name-6"/);
  assert.equal(broadcasts, 1);
});

for (const [name, invalidate] of [
  ["another owner-owned agent", () => { process.env.FLAG_RELEASE_WATCH_AGENT_ID = "dedicated-watch-agent"; }],
  ["unset watch identity", () => { delete process.env.FLAG_RELEASE_WATCH_AGENT_ID; }],
  ["empty watch identity", () => { process.env.FLAG_RELEASE_WATCH_AGENT_ID = ""; }],
  ["no stored Everyone row", () => { storedFlag = null; }],
  ["null stored Everyone release time", () => { storedFlag.releasedAt = null; }],
  ["stale stored Everyone release", () => { storedFlag.releasedAt = new Date(Date.now() - 71 * 60_000); }],
]) {
  test(`release watch refuses ${name} even with caller-supplied fresh time and spike`, async () => {
    const body = watchBody();
    defaultMode = "EVERYONE";
    invalidate();
    assert.ok((await result(await PATCH(request("PATCH", body)))).status >= 400);
    assert.equal(writes.length, 0);
    assert.equal(comments.length, 0);
  });

  test(`release watch still allows dedicated identity with matching stored fresh Everyone release (control for ${name})`, async () => {
    defaultMode = "EVERYONE";
    const response = await result(await PATCH(request("PATCH", watchBody())));
    assert.equal(response.status, 200);
    assert.equal(response.body.flag.mode, "OFF");
    assert.equal(response.body.notified, true);
    assert.equal(writes.length, 1);
    assert.equal(comments.length, 1);
    assert.equal(approvalQueries.length, 0);
  });
}

for (const watchAgentId of [undefined, "another-watch-agent"]) {
  test(`normal thumbs-up approval remains allowed with watch identity ${watchAgentId}`, async () => {
    if (watchAgentId === undefined) delete process.env.FLAG_RELEASE_WATCH_AGENT_ID;
    else process.env.FLAG_RELEASE_WATCH_AGENT_ID = watchAgentId;
    const body = { ...watchBody(), reason };
    const response = await result(await PATCH(request("PATCH", body)));
    assert.equal(response.status, 200);
    assert.equal(response.body.flag.mode, "OFF");
    assert.equal(approvalQueries.length, 1);
    assert.equal(writes.length, 1);
    assert.equal(comments.length, 0);
  });
}

for (const [name, change] of [
  ["under ten errors", body => { body.watch.after = 9; }],
  ["exactly double", body => { body.watch.before = 6; body.watch.after = 12; }],
  ["negative count", body => { body.watch.before = -1; }],
  ["fractional count", body => { body.watch.after = 11.5; }],
  ["string count", body => { body.watch.before = "4"; }],
  ["old release", body => { body.watch.releasedAt = new Date(Date.now() - 120 * 60_000).toISOString(); }],
  ["future release", body => { body.watch.releasedAt = new Date(Date.now() + 60_000).toISOString(); }],
  ["missing release time", body => { delete body.watch.releasedAt; }],
  ["invalid release time", body => { body.watch.releasedAt = "invalid"; }],
  ["release changed since discovery", () => { storedFlag.releasedAt = new Date(Date.now() - 35 * 60_000); }],
  ["stored Off", () => { storedFlag.mode = "OFF"; }],
  ["stored protected mode", () => { storedFlag.mode = "OWNER_AND_QA"; }],
  ["unstored protected default", () => { storedFlag = null; }],
  ["timestamp-less protected default", () => { storedFlag.releasedAt = null; }],
  ["target Everyone", body => { body.mode = "EVERYONE"; }],
  ["management key", () => { ctx.management = { keyId: "htmk_test" }; }],
  ["non-owner agent", () => { ctx.user.id = 7; }],
  ["missing watch", body => { delete body.watch; }],
  ["wrong ticket", body => { body.reason = "https://app.hypertask.ai/detail/project-15/123"; }],
  ["short window", body => { body.watch.windowMinutes = 29; }],
  ["long window", body => { body.watch.windowMinutes = 61; }],
  ["fractional window", body => { body.watch.windowMinutes = 40.5; }],
  ["window inconsistent with release", body => { body.watch.windowMinutes = 30; }],
  ["unwritable ticket", () => { ticketWritable = false; }],
]) test(`release watch refuses ${name}`, async () => {
  const body = watchBody(); change(body);
  assert.ok((await result(await PATCH(request("PATCH", body)))).status >= 400);
  assert.equal(writes.length, 0);
  assert.equal(comments.length, 0);
});

test("release watch refuses read-role agents before any flag or ticket write", async () => {
  ctx.agentRole = "read";
  const response = await PATCH(request("PATCH", watchBody()));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "insufficient_scope");
  assert.equal(writes.length, 0);
  assert.equal(ticketQueries.length, 0);
});

for (const minutes of [30, 60]) test(`release watch accepts the ${minutes}-minute boundary and minimum spike`, async () => {
  storedFlag.releasedAt = new Date(Date.now() - minutes * 60_000);
  const body = watchBody(); body.watch.windowMinutes = minutes; body.watch.after = 10;
  assert.equal((await result(await PATCH(request("PATCH", body)))).status, 200);
  assert.equal(comments.length, 1);
});

test("missing watch still requires Valentin's original thumbs up", async () => {
  approvalComment.reactions = [];
  assert.equal((await result(await PATCH(request("PATCH", { key, mode: "OFF", reason })))).status, 403);
  assert.equal(writes.length, 0);
  assert.equal(comments.length, 0);
});

for (const reporterFails of [false, true]) {
  test(`failed watch comment returns successful Off with notified:false even when reporting ${reporterFails ? "fails" : "succeeds"}`, async (t) => {
    t.mock.method(console, "error", () => {});
    commentFails = true;
    reportingFails = reporterFails;
    const response = await result(await PATCH(request("PATCH", watchBody())));
    assert.equal(response.status, 200);
    assert.equal(response.body.flag.mode, "OFF");
    assert.equal(response.body.notified, false);
    assert.equal(writes.length, 1);
    assert.equal(broadcasts, 1);
    assert.equal(comments.length, 0);
    assert.equal(errorReports.length, 1);
    assert.equal(errorReports[0].message, `Release watch switched ${key} Off but failed to notify Valentin`);
    assert.equal(errorReports[0].source, "server");
    assert.equal(errorReports[0].url, watchBody().reason);
    assert.match(errorReports[0].stack, /comment unavailable/);
    assert.deepEqual(errorReports[0].extra, { flagKey: key, agentId: "runner-3" });
  });
}
