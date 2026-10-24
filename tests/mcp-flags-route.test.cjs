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

stubModule("src/lib/auth/agentScope.ts", {
  agentScopeEnforced: () => true,
  recordAgentBoardScopeMiss: () => {},
  prepareAgentScope: async () => {},
  withAgentScopeRequest: (_request, run) => run(),
});

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
let plainYesFlagOn;
let commentLockLost;
let storedFlag;
let defaultMode;
let comments;
let commentFails;
let ticketWritable;
let ticketQueries;
let errorReports;
let reportingFails;
let releaseEnrollments;
const originalWatchAgentId = process.env.FLAG_RELEASE_WATCH_AGENT_ID;
let ticketComments;
let leadAgent;
let candidateLocks;
let editOnCandidateLock;
let approvalLogs;
const week = 7 * 24 * 60 * 60 * 1000;
const approvalRequired = "Needs a clear yes from Valentin within 7 days: his thumbs up on the switch question, his own comment on the ticket after exactly one switch question, or HT Product Lead's in-chat record of his exact words. Questions name the switch: Switch <flag-key> to <mode>";
const ambiguousQuestion = "Ambiguous or missing question: Valentin's yes must follow exactly one switch question; ask him to thumbs-up the one he means";
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
    assert.equal(userId, 6);
    if (flagKey === "htpr-7364-batch-flag-approval") return batchFlagOn;
    assert.equal(flagKey, "htpr-7727-plain-yes-flag-approval");
    return plainYesFlagOn;
  },
  isFeatureFlagOwnerUserId: async (userId) => { calls.push("owner"); return owner && userId === 6; },
  listFeatureFlagModes: async (options) => { calls.push("list"); assert.deepEqual(options, { includeTicketTitles: true, includeLastChange: true, principal: { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope } }); return rows; },
  recordDefaultFeatureFlagReleases: async () => { releaseEnrollments++; },
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
function matches(row, where) {
  return Object.entries(where).every(([field, value]) => {
    if (field === "OR") return value.some((part) => matches(row, part));
    if (field === "AND") return value.every((part) => matches(row, part));
    if (value instanceof Date) return row[field].getTime() === value.getTime();
    if (value && typeof value === "object") {
      return Object.entries(value).every(([operator, operand]) => {
        if (operator === "in") return operand.includes(row[field]);
        if (operator === "gt") return row[field] > operand;
        if (operator === "gte") return row[field] >= operand;
        if (operator === "lt") return row[field] < operand;
        throw new Error(`Unexpected filter ${operator}`);
      });
    }
    return row[field] === value;
  });
}
function commentsMatching(query) {
  const rows = [approvalComment, ...ticketComments].filter((row) => row && matches(row, query.where));
  const order = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
  return rows.sort((a, b) => {
    for (const part of order) {
      for (const [field, direction] of Object.entries(part)) {
        const difference = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
        if (difference) return direction === "desc" ? -difference : difference;
      }
    }
    return 0;
  });
}
const tx = {
  featureFlag: { findUnique: async () => storedFlag },
  $queryRaw: async (strings, commentId, taskId, projectId) => {
    const sql = strings.join("?");
    if (sql === 'SELECT id FROM "Comment" WHERE id = ? ORDER BY id FOR UPDATE') {
      candidateLocks.push(commentId);
      if (editOnCandidateLock) editOnCandidateLock(commentId);
      return ticketComments.filter((row) => row.id === commentId).map(({ id }) => ({ id }));
    }
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
  agent: {
    findUnique: async (query) => {
      assert.deepEqual(query, { where: { id: "9b0f3a93-5e88-4093-b558-cad1c229bc51" }, select: { userId: true, revokedAt: true } });
      return leadAgent;
    },
  },
  comment: {
    findMany: async (query) => commentsMatching(query),
    findFirst: async (query) => {
      if (query.where.taskId !== undefined) return commentsMatching(query)[0] ?? null;
      if (query.select.taskId && !query.select.id) return approvalComment && approvalComment.id === query.where.id && approvalComment.task.projectId === query.where.task.projectId && approvalComment.task.uniqueIndex === query.where.task.uniqueIndex && approvalComment.task.status !== "Deleted" ? { taskId: 900 } : null;
      assert.deepEqual(calls.slice(-2), ["comment-lock", "reaction-lock"]);
      assert.equal(lockQueries.length, 2 * (approvalQueries.length + 1));
      calls.push("approval");
      approvalQueries.push(query);
      const reaction = query.select.reactions.where;
      assert.deepEqual(query.select.reactions.select, { createdAt: true });
      assert.deepEqual(query.select.reactions.orderBy, { createdAt: "desc" });
      assert.equal(query.select.reactions.take, 1);
      assert.deepEqual({ ...query.select, reactions: undefined }, {
        id: true, text: true, commentText: true, creatorId: true, agentId: true,
        agentDisplayName: true, editedAt: true, editedByUserId: true, editedByAgentId: true,
        createdAt: true, taskId: true, reactions: undefined,
      });
      assert.equal(query.where.id, 123);
      assert.equal(query.where.editedAt, null);
      assert.deepEqual({ ...query.where.task, project: undefined }, { projectId: 4060, uniqueIndex: 215, status: { not: "Deleted" }, project: undefined });
      assert.deepEqual(query.where.task.project, { OR: [{ members: { some: { agentId: "runner-3", status: "Accepted", agent: { userId: 6, revokedAt: null } } } }] });
      assert.deepEqual({ ...reaction, createdAt: undefined }, {
        userId: 6, agentId: null, agentDisplayName: null, isDeleted: false,
        unified: { startsWith: "1f44d" }, createdAt: undefined,
      });
      assert.ok(reaction.createdAt.gte instanceof Date);
      assert.ok(Math.abs(Date.now() - reaction.createdAt.gte - week) < 1000);
      if (!approvalComment || approvalComment.id !== query.where.id
        || (query.where.editedAt === null && approvalComment.editedAt !== null)
        || approvalComment.task.projectId !== query.where.task.projectId
        || approvalComment.task.uniqueIndex !== query.where.task.uniqueIndex
        || approvalComment.task.status === query.where.task.status.not) return null;
      const reactions = approvalComment.reactions.filter(row => row.userId === reaction.userId
        && row.agentId === reaction.agentId && row.agentDisplayName === reaction.agentDisplayName
        && row.isDeleted === reaction.isDeleted && row.unified.startsWith(reaction.unified.startsWith)
        && row.createdAt >= reaction.createdAt.gte)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 1)
        .map(({ createdAt }) => ({ createdAt }));
      return { ...approvalComment, reactions };
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
const { GET, POST, PATCH } = jiti(path.join(root, "src/app/api/mcp/flags/route.ts"));
const { FLAG_CHAT_RECORD_AGENT_ID } = jiti(path.join(root, "src/lib/flags/approvalWords.ts"));
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
test.beforeEach((t) => {
  process.env.FLAG_RELEASE_WATCH_AGENT_ID = "runner-3";
  errorReports = []; reportingFails = false; releaseEnrollments = 0;
  storedFlag = { mode: "EVERYONE", releasedAt: new Date(Date.now() - 40 * 60_000) };
  defaultMode = "OWNER_AND_QA"; comments = []; commentFails = false; ticketWritable = true; ticketQueries = [];
  approvalLogs = [];
  t.mock.method(console, "info", (...args) => approvalLogs.push(args));
  ticketComments = []; candidateLocks = []; editOnCandidateLock = null;
  leadAgent = { userId: 6, revokedAt: null };
  ctx = { user: { id: 6, email: "valentin.yeo@gmail.com" }, agentId: "runner-3", agentRole: "write" };
  owner = true; limited = null; writes = []; calls = []; broadcasts = 0;
  broadcastFails = false; writeError = null; previousMode = "OWNER_AND_QA";
  approvalQueries = []; lockQueries = []; batchFlagOn = false; plainYesFlagOn = true; commentLockLost = false;
  approvalComment = {
    id: 123, taskId: 900, creatorId: 6, agentId: "runner-3", agentDisplayName: null,
    createdAt: new Date(), editedByUserId: null, editedByAgentId: null,
    task: { projectId: 4060, uniqueIndex: 215, status: "Normal" },
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

for (const [name, text] of [
  ["no question mark", `Switch ${key} to Off`],
  ["plain extra text after", `Question: Switch ${key} to Off? Thanks`],
]) {
  test(`PATCH accepts approval from ${name}`, async () => {
    approvalComment.commentText = text;
    await assertAllowed("thumbs-up", key, "OFF", [123]);
  });
}

for (const rejected of ["refusal after switch", "missing key", "wrong mode", "refusal naming both modes", "two requests", "prefix key", "negated request", "quoted request", "empty comment", "visible text differs from commentText", "no reaction", "agent reaction", "deleted agent reaction", "non-thumbs emoji", "old reaction", "other user reaction", "deleted reaction", "unknown comment", "different comment", "wrong project", "wrong ticket", "deleted ticket"]) {
  test(`PATCH refuses approval from ${rejected}`, async () => {
    const reaction = approvalComment.reactions[0];
    if (rejected === "refusal after switch") approvalComment.commentText = `Question: Switch ${key} to Off? No, keep it.`;
    if (rejected === "missing key") approvalComment.commentText = "Question: Switch another-flag to Off?";
    if (rejected === "wrong mode") approvalComment.commentText = `Question: Switch ${key} to Everyone?`;
    if (rejected === "refusal naming both modes") approvalComment.commentText = `Keep ${key} Off, not Everyone`;
    if (rejected === "two requests") approvalComment.commentText = `Question: Switch ${key} to Off? Or Switch ${key} to Everyone?`;
    if (rejected === "prefix key") approvalComment.commentText = `Question: Switch ${key}-extra to Off?`;
    if (rejected === "negated request") approvalComment.commentText = `Question: Do not Switch ${key} to Off?`;
    if (rejected === "quoted request") approvalComment.commentText = `He said "Question: Switch ${key} to Off?" earlier`;
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
      status: 403, body: { error: approvalRequired },
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
      status: 403, body: { error: approvalRequired },
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

test("PATCH accepts a batch comment with any other text", async () => {
  batchFlagOn = true;
  approvalComment.commentText = "";
  approvalComment.text = `${batchHtml}<p>and also make it faster</p>`;
  await assertAllowed("thumbs-up", key, "OWNER_AND_QA", [123]);
});

for (const [name, setup, body] of [
  ["a batch comment while the batch flag is off", () => { batchFlagOn = false; }, { key, mode: "OWNER_AND_QA", reason }],
  ["a mode the batch comment does not list for that flag", () => {}, { key, mode: "EVERYONE", reason }],
  ["a flag the batch comment does not list", () => {}, { key: "htpr-1-unlisted", mode: "OFF", reason }],
  ["a batch comment naming the flag twice", () => {
    approvalComment.text = `<p>Question: Switch ${key} to Owner + QA?</p><p>Switch ${key} to Everyone?</p>`;
  }, { key, mode: "EVERYONE", reason }],
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

test("release enrollment accepts only the dedicated write agent and ignores caller metadata", async () => {
  const response = await result(await POST(request("POST", { releasedAt: new Date().toISOString(), key, mode: "EVERYONE" })));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.flags, rows);
  assert.equal(releaseEnrollments, 1);
  assert.equal(writes.length, 0);
});

for (const [name, invalidate] of [
  ["unset watch identity", () => { delete process.env.FLAG_RELEASE_WATCH_AGENT_ID; }],
  ["other agent", () => { ctx.agentId = "another-agent"; }],
  ["read role", () => { ctx.agentRole = "read"; }],
  ["management key", () => { ctx.management = { keyId: "key" }; }],
  ["non-owner", () => { owner = false; }],
]) test(`release enrollment refuses ${name}`, async () => {
  invalidate();
  assert.equal((await POST(request("POST"))).status, 403);
  assert.equal(releaseEnrollments, 0);
  assert.equal(writes.length, 0);
});

for (const evidence of [{ review: 123 }, { failure: "https://example.test/qa" }]) {
  test(`release watch cannot mix ${Object.keys(evidence)[0]} evidence`, async () => {
    const response = await result(await PATCH(request("PATCH", { ...watchBody(), ...evidence })));
    assert.equal(response.status, 400);
    assert.equal(writes.length, 0);
  });
}

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
function ticketComment(id, text, overrides = {}) {
  return {
    id, taskId: 900, text, commentText: "", creatorId: 6, agentId: "runner-3", agentDisplayName: null,
    editedAt: null, editedByUserId: null, editedByAgentId: null,
    createdAt: new Date(approvalComment.createdAt.getTime() - 1000), ...overrides,
  };
}
function ticketYes(text = "Yes") {
  Object.assign(approvalComment, { text, commentText: "", agentId: null, reactions: [] });
  ticketComments = [ticketComment(100, `Question: Switch ${key} to Everyone?`)];
}
function chatRecord(text = `Valentin said in chat (${new Date().toISOString().slice(0, 10)}): "yes, ship it"`) {
  ticketYes(text);
  approvalComment.agentId = FLAG_CHAT_RECORD_AGENT_ID;
  approvalComment.agentDisplayName = "HT Product Lead";
}
async function assertAllowed(kind, requestedKey = key, mode = "EVERYONE", questionCommentIds = [100]) {
  const response = await result(await PATCH(request("PATCH", { key: requestedKey, mode, reason })));
  assert.equal(response.status, 200);
  assert.equal(response.body.flag.mode, mode);
  assert.equal(writes.at(-1)[0], requestedKey);
  assert.deepEqual(approvalLogs.at(-1), ["[feature-flags] approval", JSON.stringify({
    key: requestedKey, mode, kind, approvalCommentId: 123, questionCommentIds, verdict: "yes", classifier: "v1",
  })]);
  assert.equal(approvalLogs.length, writes.length);
}
async function assertRefused(message = approvalRequired, mode = "EVERYONE") {
  assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode, reason }))), {
    status: 403, body: { error: message },
  });
  assert.equal(writes.length, 0);
  assert.equal(broadcasts, 0);
  assert.equal(approvalLogs.length, 0);
}

test("PATCH accepts the 6371 replica: recommendation, switch question, human Yes", async () => {
  const mobileKey = "htpr-6371-mobile-search";
  ticketYes();
  ticketComments[0].text = `Question: Switch ${mobileKey} to Everyone?`;
  ticketComments.unshift(ticketComment(99, "Recommendation: the mobile search is ready", {
    createdAt: new Date(approvalComment.createdAt.getTime() - 2000),
  }));
  await assertAllowed("ticket-yes", mobileKey);
  assert.deepEqual(candidateLocks, [100]);
});

for (const answer of ["works, release it", "ship it"]) {
  test(`PATCH accepts human ${JSON.stringify(answer)} after one switch question`, async () => {
    ticketYes(answer);
    await assertAllowed("ticket-yes");
  });
}

test("PATCH accepts thumbs-up on a free-wording switch question", async () => {
  approvalComment.text = `@Valentin Yeo can I switch ${key}? Switch ${key} to Everyone`;
  await assertAllowed("thumbs-up", key, "EVERYONE", [123]);
});

test("PATCH refuses a conditional switch question even with a thumbs-up", async () => {
  approvalComment.text = `Switch ${key} to Everyone only if I approve tomorrow`;
  await assertRefused();
});

test("PATCH accepts the lead in-chat record of yes, ship it", async () => {
  chatRecord();
  await assertAllowed("chat-record");
});

test("PATCH accepts a lead in-chat record with a trailing period", async () => {
  chatRecord();
  approvalComment.text += ".";
  await assertAllowed("chat-record");
});

test("PATCH accepts a dated chat record after a leading mention", async () => {
  chatRecord();
  approvalComment.text = `@Valentin Yeo ${approvalComment.text}`;
  await assertAllowed("chat-record");
});

test("PATCH accepts the lead in-chat record naming its own switch without an earlier question", async () => {
  chatRecord(`Valentin said in chat (${new Date().toISOString().slice(0, 10)}): "yes, ship it". Switch ${key} to Off`);
  ticketComments = [];
  await assertAllowed("chat-record", key, "OFF", [123]);
  assert.deepEqual(candidateLocks, []);
});

test("PATCH accepts a lead in-chat record followed only by punctuation-separated batch switch clauses", async () => {
  chatRecord(`Valentin said in chat (${new Date().toISOString().slice(0, 10)}): "yes, ship it". Switch ${key} to Only me?; Switch other-flag to Owner + QA!`);
  batchFlagOn = true;
  ticketComments = [];
  await assertAllowed("chat-record", key, "OWNER_ONLY", [123]);
  await assertAllowed("chat-record", "other-flag", "OWNER_AND_QA", [123]);
});

test("PATCH refuses the lead in-chat record naming its own switch when the quote is no", async () => {
  chatRecord(`Valentin said in chat (${new Date().toISOString().slice(0, 10)}): "no". Switch ${key} to Off`);
  ticketComments = [];
  await assertRefused(approvalRequired, "OFF");
});

for (const kind of ["ticket-yes", "chat-record", "thumbs-up"]) {
  test(`PATCH with plain-yes flag off ${kind === "thumbs-up" ? "accepts" : "refuses"} ${kind}`, async () => {
    plainYesFlagOn = false;
    if (kind === "ticket-yes") ticketYes();
    else if (kind === "chat-record") chatRecord();
    else approvalComment.text = `Question: Switch ${key} to Everyone?`;
    if (kind === "thumbs-up") await assertAllowed("thumbs-up", key, "EVERYONE", [123]);
    else await assertRefused();
  });
}

for (const [name, text] of [
  ["free wording", `@Valentin Yeo can I switch ${key}? Switch ${key} to Everyone`],
  ["trailing thanks", `Question: Switch ${key} to Everyone? Thanks`],
  ["lowercase wording", `question: switch ${key} to everyone?`],
  ["normalized fullwidth wording", `Ｑuestion: Switch ${key} to Everyone?`],
]) {
  test(`PATCH with plain-yes flag off refuses thumbs-up on ${name}`, async () => {
    plainYesFlagOn = false;
    approvalComment.text = text;
    await assertRefused();
  });
}

for (const batchOn of [false, true]) {
  test(`PATCH with plain-yes flag off ${batchOn ? "accepts" : "refuses"} strict batch thumbs-up with batch flag ${batchOn ? "on" : "off"}`, async () => {
    plainYesFlagOn = false;
    batchFlagOn = batchOn;
    approvalComment.text = `<p>@Valentin Yeo Question: Switch ${key} to Everyone?</p>\n<p>Switch other-flag to Off?</p>`;
    if (batchOn) await assertAllowed("thumbs-up", key, "EVERYONE", [123]);
    else await assertRefused();
  });
}

test("PATCH accepts both batch keys after one question comment and one human yes", async () => {
  ticketYes();
  batchFlagOn = true;
  ticketComments[0].text += "\nSwitch other-flag to Off?";
  await assertAllowed("ticket-yes");
  await assertAllowed("ticket-yes", "other-flag", "OFF");
  assert.equal(writes.length, 2);
});

for (const [name, setup] of [
  ["another user's yes", () => { approvalComment.creatorId = 7; }],
  ["agent-authored owner yes", () => { approvalComment.agentId = "runner-3"; }],
  ["display-name-only agent yes", () => { approvalComment.agentDisplayName = "Deleted agent"; }],
  ["yes with editedAt", () => { approvalComment.editedAt = new Date(); }],
  ["yes with editedByAgentId", () => { approvalComment.editedByAgentId = "runner-3"; }],
  ["yes with editedByUserId", () => { approvalComment.editedByUserId = 6; }],
  ["yes older than seven days", () => {
    approvalComment.createdAt = new Date(Date.now() - week - 1000);
    ticketComments[0].createdAt = new Date(approvalComment.createdAt.getTime() - 1000);
  }],
]) {
  test(`PATCH refuses ${name}`, async () => {
    ticketYes();
    setup();
    await assertRefused();
  });
}

for (const answer of ["yes but not on phone", "yes?", "maybe", "the release failed", "hmm"]) {
  test(`PATCH refuses human answer ${JSON.stringify(answer)}`, async () => {
    ticketYes(answer);
    await assertRefused();
  });
}

test("PATCH refuses a long human no with the said-no message", async () => {
  ticketYes("No this theme is horrible and needs a lot more work");
  await assertRefused("Valentin said no on comment 123; no switch");
});

for (const [name, setup] of [
  ["yes posted before the question", () => { ticketComments[0].createdAt = new Date(approvalComment.createdAt.getTime() + 1000); }],
  ["question older than seven days before yes", () => { ticketComments[0].createdAt = new Date(approvalComment.createdAt.getTime() - week - 1000); }],
  ["two separate question comments", () => { ticketComments.push(ticketComment(101, "Switch other-flag to Off?")); }],
  ["zero switch questions", () => { ticketComments = []; }],
  ["question before the previous human comment", () => {
    ticketComments.push(ticketComment(101, "hmm", { agentId: null, createdAt: new Date(approvalComment.createdAt.getTime() - 500) }));
  }],
  ["question before an edited previous human comment", () => {
    ticketComments.push(ticketComment(101, "Earlier answer", { agentId: null, editedAt: new Date(), createdAt: new Date(approvalComment.createdAt.getTime() - 500) }));
  }],
  ["negated question with a yes", () => { ticketComments[0].text = `Do not switch ${key} to Everyone`; }],
]) {
  test(`PATCH refuses ${name} as ambiguous or missing`, async () => {
    ticketYes();
    setup();
    await assertRefused(ambiguousQuestion);
  });
}

for (const path of ["yes", "thumbs-up"]) {
  test(`PATCH refuses a later human no withdrawing ${path}`, async () => {
    if (path === "yes") ticketYes();
    else approvalComment.text = `Switch ${key} to Everyone`;
    ticketComments.push(ticketComment(124, "no", { agentId: null, createdAt: new Date(approvalComment.createdAt.getTime() + 1000) }));
    await assertRefused("Valentin said no after that approval (comment 124)");
  });
}

test("PATCH accepts a fresh thumbs-up after a human no using the newest qualifying reaction", async () => {
  const now = Date.now();
  approvalComment.text = `Switch ${key} to Everyone`;
  approvalComment.createdAt = new Date(now - 4000);
  const reaction = approvalComment.reactions[0];
  reaction.createdAt = new Date(now - 3000);
  ticketComments.push(ticketComment(124, "no", { agentId: null, createdAt: new Date(now - 2000) }));
  approvalComment.reactions.push({ ...reaction, createdAt: new Date(now - 1000) });
  approvalComment.reactions.push({ ...reaction, agentId: "impostor", createdAt: new Date(now) });
  await assertAllowed("thumbs-up", key, "EVERYONE", [123]);
});

test("PATCH refuses a human no after the newest qualifying thumbs-up", async () => {
  const now = Date.now();
  approvalComment.text = `Switch ${key} to Everyone`;
  approvalComment.createdAt = new Date(now - 4000);
  const reaction = approvalComment.reactions[0];
  reaction.createdAt = new Date(now - 3000);
  approvalComment.reactions.push({ ...reaction, createdAt: new Date(now - 2000) });
  ticketComments.push(ticketComment(124, "no", { agentId: null, createdAt: new Date(now - 1000) }));
  approvalComment.reactions.push({ ...reaction, agentId: "impostor", createdAt: new Date(now) });
  await assertRefused("Valentin said no after that approval (comment 124)");
});

test("PATCH refuses a chat record posted after a human no on its recorded UTC date", async (t) => {
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  chatRecord(`Valentin said in chat (2026-10-24): "yes, ship it". Switch ${key} to Everyone`);
  approvalComment.createdAt = new Date(now - 1000);
  ticketComments = [ticketComment(122, "no", { agentId: null, createdAt: new Date("2026-10-24T00:00:00.000Z") })];
  await assertRefused("Valentin said no after that approval (comment 122)");
});

test("PATCH accepts a chat record when the human no predates its recorded UTC date", async (t) => {
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  chatRecord(`Valentin said in chat (2026-10-24): "yes, ship it". Switch ${key} to Everyone`);
  approvalComment.createdAt = new Date(now - 1000);
  ticketComments = [ticketComment(122, "no", { agentId: null, createdAt: new Date("2026-10-23T23:59:59.999Z") })];
  await assertAllowed("chat-record", key, "EVERYONE", [123]);
});

test("PATCH refuses a later edited human no withdrawing yes", async () => {
  ticketYes();
  ticketComments.push(ticketComment(124, "no", {
    agentId: null, editedAt: new Date(), editedByUserId: 6,
    createdAt: new Date(approvalComment.createdAt.getTime() + 1000),
  }));
  await assertRefused("Valentin said no after that approval (comment 124)");
});

for (const [name, setup] of [
  ["chat record by another agent with the lead display name", () => { approvalComment.agentId = "impostor"; }],
  ["chat record by a revoked lead", () => { leadAgent.revokedAt = new Date(); }],
  ["negated chat record", () => { approvalComment.text = 'Valentin did not say in chat: "yes, ship it"'; }],
  ["chat record missing date", () => { approvalComment.text = 'Valentin said in chat: "yes, ship it"'; }],
  ["chat record with stale 2020-01-01 date", () => { approvalComment.text = 'Valentin said in chat (2020-01-01): "yes, ship it"'; }],
  ["chat record with future date", () => { approvalComment.text = `Valentin said in chat (${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}): "yes, ship it"`; }],
  ["chat record with unparseable date", () => { approvalComment.text = 'Valentin said in chat (2026-99-99): "yes, ship it"'; }],
  ["chat record with text before the prefix", () => { approvalComment.text = `Earlier discussion: ${approvalComment.text}`; }],
  ["chat record without in chat", () => { approvalComment.text = `Valentin said (${new Date().toISOString().slice(0, 10)}): "yes, ship it"`; }],
  ["chat record quoting no", () => { approvalComment.text = `Valentin said in chat (${new Date().toISOString().slice(0, 10)}): "no"`; }],
  ["chat record with trailing denial", () => { approvalComment.text += ", but not for this flag."; }],
  ["chat record with unrelated trailing text", () => { approvalComment.text += ". Thanks"; }],
  ["chat record with denial after a switch clause", () => { approvalComment.text += `. Switch ${key} to Everyone, but not for this flag.`; }],
  ["chat record with unrelated text before a switch clause", () => { approvalComment.text += `. Please Switch ${key} to Everyone`; }],
  ["chat record with two quoted spans", () => { approvalComment.text += ' "yes"'; }],
  ["chat record with an unmatched extra quote", () => { approvalComment.text += ' "'; }],
  ["chat record from a lead owned by another user", () => { leadAgent.userId = 7; }],
  ["chat record from a missing lead", () => { leadAgent = null; }],
]) {
  test(`PATCH refuses ${name}`, async () => {
    chatRecord();
    setup();
    await assertRefused();
  });
}

test("PATCH refuses a rolled-over chat record date within the freshness window", async (t) => {
  const now = Date.parse("2026-03-02T12:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  chatRecord('Valentin said in chat (2026-02-30): "yes, ship it"');
  approvalComment.createdAt = new Date(now);
  ticketComments[0].createdAt = new Date(now - 1000);
  await assertRefused();
});

test("PATCH refuses yes when the requested mode differs from the question", async () => {
  ticketYes();
  await assertRefused(approvalRequired, "OFF");
});

for (const field of ["editedAt", "editedByUserId", "editedByAgentId"]) {
  test(`PATCH refuses a yes for a question with ${field}`, async () => {
    ticketYes();
    ticketComments[0][field] = field === "editedAt" ? new Date() : field === "editedByUserId" ? 6 : "runner-3";
    await assertRefused();
  });
}

test("PATCH refuses a batch question plus yes with the batch flag off", async () => {
  ticketYes();
  ticketComments[0].text += "\nSwitch other-flag to Off?";
  await assertRefused();
});

test("PATCH re-reads a candidate after locking and refuses an edit during the lock", async () => {
  ticketYes();
  editOnCandidateLock = () => { ticketComments[0].editedByAgentId = "runner-3"; };
  await assertRefused();
  assert.deepEqual(candidateLocks, [100]);
});

test("PATCH orders equal-time questions before approval by id", async () => {
  ticketYes();
  ticketComments[0].createdAt = approvalComment.createdAt;
  await assertAllowed("ticket-yes");
});

test("PATCH treats a higher-id equal-time human no as withdrawal", async () => {
  ticketYes();
  ticketComments.push(ticketComment(124, "no", { agentId: null, createdAt: approvalComment.createdAt }));
  await assertRefused("Valentin said no after that approval (comment 124)");
});
