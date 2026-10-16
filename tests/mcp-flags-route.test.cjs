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
let lockQueries;
let approvalLink;
class FeatureFlagInputError extends Error {}
class FeatureFlagApprovalError extends Error {}
const key = "htpr-6136-figma-connect";
const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
const APPROVAL_ERROR = "Valentin must thumbs-up that comment within 7 days, the comment must be unedited, and the whole comment must be: Question: Switch <flag-key> to <mode>?"
  + " To switch to Everyone, an unedited comment on the flag's own ticket that asks for Everyone with no hold-back words also counts when Valentin wrote it himself,"
  + " or when it quotes him (Valentin, YYYY-MM-DD: \"...\") and he gave it a thumbs up within 7 days.";
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
  FEATURE_FLAG_TICKET_PROJECT_ID: 15,
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
  FeatureFlagInputError,
  FeatureFlagApprovalError,
  defaultFeatureFlagMode: () => "OWNER_AND_QA",
  isFeatureFlagOwnerUserId: async (userId) => { calls.push("owner"); return owner && userId === 6; },
  listFeatureFlagModes: async (options) => { calls.push("list"); assert.deepEqual(options, { includeTicketTitles: true, includeLastChange: true }); return rows; },
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
  $queryRaw: async (strings, commentId) => {
    const sql = strings.join("?");
    const commentLock = lockQueries.length % 2 === 0;
    assert.equal(sql, commentLock
      ? 'SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ? FOR UPDATE'
      : 'SELECT id FROM "Reaction" WHERE "commentId" = ? FOR UPDATE');
    assert.equal(commentId, 123);
    lockQueries.push({ sql, commentId });
    calls.push(commentLock ? "comment-lock" : "reaction-lock");
    return approvalComment ? [{ id: commentId }] : [];
  },
  comment: {
    findFirst: async (query) => {
      assert.deepEqual(calls.slice(-2), ["comment-lock", "reaction-lock"]);
      assert.equal(lockQueries.length, 2 * (approvalQueries.length + 1));
      calls.push("approval");
      approvalQueries.push(query);
      const reaction = query.select.reactions.where;
      assert.deepEqual({ ...query.select, reactions: undefined }, {
        creatorId: true, agentId: true, agentDisplayName: true, commentText: true, text: true, reactions: undefined,
      });
      assert.deepEqual(query.select.reactions.select, { id: true });
      assert.equal(query.select.reactions.take, 1);
      assert.equal(query.where.reactions, undefined);
      assert.equal(query.where.id, 123);
      assert.equal(query.where.editedAt, null);
      assert.deepEqual(query.where.task, { projectId: approvalLink.projectId, uniqueIndex: approvalLink.ticketNumber, status: { not: "Deleted" } });
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
      const reactions = approvalComment.reactions.filter(row => row.userId === reaction.userId
        && row.agentId === reaction.agentId && row.agentDisplayName === reaction.agentDisplayName
        && row.isDeleted === reaction.isDeleted && row.unified.startsWith(reaction.unified.startsWith)
        && row.createdAt >= reaction.createdAt.gte).slice(0, 1).map((_, id) => ({ id }));
      const { creatorId, agentId, agentDisplayName, commentText, text } = approvalComment;
      return { creatorId, agentId, agentDisplayName, commentText, text, reactions };
    },
  },
};
stubModule("src/lib/prisma.ts", {
  default: {
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
  approvalQueries = []; lockQueries = [];
  approvalLink = { projectId: 4060, ticketNumber: 215 };
  approvalComment = {
    id: 123, task: { projectId: 4060, uniqueIndex: 215, status: "Normal" },
    creatorId: 6, agentId: "ht-product-lead", agentDisplayName: "HT Product Lead",
    commentText: `Question: Switch ${key} to Off?`, text: null, editedAt: null,
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
      status: 403, body: { error: APPROVAL_ERROR },
    });
    assert.equal(writes.length, 0);
    assert.equal(broadcasts, 0);
    assert.deepEqual(calls, ["rate-limit", "auth", "owner", "agent", "comment-lock", "reaction-lock", "approval"]);
    assert.equal(approvalQueries.length, 1);
  });
}

for (const edited of ["long ago", "before thumbs up", "at thumbs up", "after thumbs up"]) {
  test(`PATCH refuses an edited comment ${edited} even with a valid thumbs up`, async () => {
    const createdAt = approvalComment.reactions[0].createdAt;
    approvalComment.editedAt = edited === "long ago" ? new Date(0)
      : new Date(createdAt.getTime() + (edited === "before thumbs up" ? -1000 : edited === "after thumbs up" ? 1000 : 0));
    assert.deepEqual(await result(await PATCH(request("PATCH", { key, mode: "OFF", reason }))), {
      status: 403, body: { error: APPROVAL_ERROR },
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
    { sql: 'SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ? FOR UPDATE', commentId: 123 },
    { sql: 'SELECT id FROM "Reaction" WHERE "commentId" = ? FOR UPDATE', commentId: 123 },
  ]);
  assert.deepEqual(calls.slice(-4), ["comment-lock", "reaction-lock", "approval", "write"]);
});

const everyoneKey = "htpr-7278-requested-work";
const everyoneReason = "https://app.hypertask.ai/detail/project-15/7278#comment-123";
function startOnEveryone(overrides = {}) {
  approvalLink = { projectId: 15, ticketNumber: 7278 };
  Object.assign(approvalComment, {
    task: { projectId: 15, uniqueIndex: 7278, status: "Normal" },
    creatorId: 6, agentId: null, agentDisplayName: null, reactions: [],
    commentText: "Please build this and put it live for everyone.", text: null,
  }, overrides);
}
async function patchEveryone(mode = "EVERYONE", reasonLink = everyoneReason) {
  return result(await PATCH(request("PATCH", { key: everyoneKey, mode, reason: reasonLink })));
}

test("PATCH starts a flag on Everyone from a comment Valentin wrote himself on the flag's ticket", async () => {
  startOnEveryone();
  assert.equal((await patchEveryone()).status, 200);
  assert.deepEqual(writes, [[everyoneKey, "EVERYONE", { userId: 6, agentId: "runner-3", agentName: "Runner 3", reason: everyoneReason, source: "api" }]]);
});

test("PATCH starts a flag on Everyone from a comment quoting Valentin with his thumbs up", async () => {
  startOnEveryone({
    agentId: "ht-product-lead", agentDisplayName: "HT Product Lead",
    commentText: "", text: '<p>Valentin, 2026-10-16, in chat: “ship it live for everyone, it is urgent”</p>',
    reactions: [{ userId: 6, agentId: null, agentDisplayName: null, unified: "1f44d", isDeleted: false, createdAt: new Date() }],
  });
  assert.equal((await patchEveryone()).status, 200);
  assert.equal(writes.length, 1);
});

test("PATCH still accepts the Question thumbs up for Everyone on the flag's ticket", async () => {
  startOnEveryone({
    agentId: "runner-3", agentDisplayName: "Runner 3", commentText: `Question: Switch ${everyoneKey} to Everyone?`,
    reactions: [{ userId: 6, agentId: null, agentDisplayName: null, unified: "1f44d", isDeleted: false, createdAt: new Date() }],
  });
  assert.equal((await patchEveryone()).status, 200);
});

for (const rejected of [
  "agent comment on Valentin's account", "deleted agent comment", "another user's comment", "missing comment",
  "edited comment", "quote without his thumbs up", "quote with an agent thumbs up", "agent comment without a quote",
  "another ticket", "another board", "a mode other than Everyone", "a deleted ticket",
  "his unrelated comment", "his refusal", "his refusal with a curly apostrophe", "his hold for later",
  "a quoted refusal with his thumbs up", "a quote keeping it to Owner + QA",
]) {
  test(`PATCH refuses starting on Everyone from ${rejected}`, async () => {
    startOnEveryone();
    let mode = "EVERYONE";
    let reasonLink = everyoneReason;
    const quote = { agentId: "ht-product-lead", agentDisplayName: "HT Product Lead", commentText: 'Valentin, 2026-10-16: "ship it to everyone"' };
    const thumbsUp = { userId: 6, agentId: null, agentDisplayName: null, unified: "1f44d", isDeleted: false, createdAt: new Date() };
    if (rejected === "agent comment on Valentin's account") approvalComment.agentId = "ht-product-lead";
    if (rejected === "deleted agent comment") approvalComment.agentDisplayName = "Deleted agent";
    if (rejected === "another user's comment") approvalComment.creatorId = 7;
    if (rejected === "missing comment") approvalComment = null;
    if (rejected === "edited comment") approvalComment.editedAt = new Date();
    if (rejected === "quote without his thumbs up") Object.assign(approvalComment, quote);
    if (rejected === "quote with an agent thumbs up") Object.assign(approvalComment, quote, { reactions: [{ ...thumbsUp, agentId: "runner-3" }] });
    if (rejected === "agent comment without a quote") Object.assign(approvalComment, quote, { commentText: "Valentin wants this live for everyone", reactions: [thumbsUp] });
    if (rejected === "another ticket") {
      approvalComment.task.uniqueIndex = 7279; approvalLink.ticketNumber = 7279;
      reasonLink = "https://app.hypertask.ai/detail/project-15/7279#comment-123";
    }
    if (rejected === "another board") {
      approvalComment.task.projectId = 4060; approvalLink.projectId = 4060;
      reasonLink = "https://app.hypertask.ai/detail/project-4060/7278#comment-123";
    }
    if (rejected === "a mode other than Everyone") mode = "OWNER_AND_QA";
    if (rejected === "a deleted ticket") approvalComment.task.status = "Deleted";
    if (rejected === "his unrelated comment") approvalComment.commentText = "Looks good, thanks";
    if (rejected === "his refusal") approvalComment.commentText = "Do not release this to everyone";
    if (rejected === "his refusal with a curly apostrophe") approvalComment.commentText = "Don\u2019t put this live for everyone";
    if (rejected === "his hold for later") approvalComment.commentText = "Everyone can get it later";
    if (rejected === "a quoted refusal with his thumbs up") Object.assign(approvalComment, quote, { commentText: 'Valentin, 2026-10-16: "keep it private, everyone gets it next week"', reactions: [thumbsUp] });
    if (rejected === "a quote keeping it to Owner + QA") Object.assign(approvalComment, quote, { commentText: 'Valentin, 2026-10-16: "everyone on the team, so Owner + QA for now"', reactions: [thumbsUp] });
    assert.deepEqual(await patchEveryone(mode, reasonLink), { status: 403, body: { error: APPROVAL_ERROR } });
    assert.equal(writes.length, 0);
    assert.equal(broadcasts, 0);
  });
}
