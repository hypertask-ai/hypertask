const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { NextRequest, NextResponse } = require("next/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const loadDefinitions = createJiti(__filename, { interopDefault: true });
const definitions = [...loadDefinitions(path.join(root, "src/lib/flags/definitions.ts")).FEATURE_FLAG_DEFINITIONS];
for (const highRisk of ["money", "access", "data-deletion", "customer-email"]) {
  if (!definitions.some((flag) => flag.releaseRisk?.highRisk === highRisk)) {
    definitions.push({ key: `review-${highRisk}`, kind: "feature", defaultMode: "OWNER_ONLY", releaseRisk: { risk: "new", highRisk, reason: "Test fixture" } });
  }
}
definitions.push({ key: "review-default-off", kind: "feature", defaultMode: "OFF", releaseRisk: { risk: "small", reason: "Test fixture" } });
const small = definitions.find((flag) => flag.releaseRisk && !flag.releaseRisk.highRisk && flag.kind !== "bugfix");
const bugfix = definitions.find((flag) => flag.releaseRisk && !flag.releaseRisk.highRisk && flag.kind === "bugfix");
assert.ok(small);
assert.ok(bugfix);
const key = small.key;
const failure = "https://qa.example.test/failure";
const evidence = {
  key, mode: "EVERYONE", aiReviewUrl: "https://github.com/hypertask-ai/hypertask/pull/123",
  independentReview: "Independently checked the change", liveQaUrl: "https://qa.example.test/pass", inboxCycle: "passed",
};
let ctx;
let limited;
let roleRefusal;
let persistedRole;
let reviews;
let stored;
let changes;
let locks;
let policy;
let broadcasts;
let writeFails;
let consumeFails;
let ownerEmail;
let legacyAllowed;
let legacyKey;
let legacyMode;
let transactionTail = Promise.resolve();
let wrapped;
const prisma = {
  user: { findUnique: async () => ({ email: ownerEmail }) },
  agent: {
    findUniqueOrThrow: async ({ where }) => ({ displayName: where.id }),
    findUnique: async () => ({ permissions: { role: persistedRole } }),
  },
  task: { findMany: async () => [] },
  featureFlag: {
    findUnique: async ({ where }) => stored.get(where.key) ?? null,
    upsert: async ({ where, create, update }) => {
      if (writeFails) throw new Error("flag write failed");
      const row = { ...(stored.get(where.key) ?? create), ...update, key: where.key, updatedAt: new Date() };
      stored.set(where.key, row);
      locks.push("flag-write");
      return row;
    },
  },
  featureFlagChange: {
    create: async ({ data }) => {
      const row = { id: changes.length + 1, ...data, createdAt: new Date(), user: { email: ownerEmail } };
      changes.push(row);
      locks.push("change-write");
      return row;
    },
  },
  featureFlagReview: {
    create: async ({ data }) => {
      const row = { id: reviews.size + 1, ...data, createdAt: new Date(), usedAt: null, usedByChangeId: null };
      reviews.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }) => reviews.get(where.id) ?? null,
    update: async ({ where, data }) => {
      if (consumeFails) throw new Error("review write failed");
      assert.equal(locks.at(-1), "change-write");
      Object.assign(reviews.get(where.id), data);
      locks.push("review-used");
      return reviews.get(where.id);
    },
  },
  $executeRaw: async (strings, namespace, target) => {
    assert.match(strings.join("?"), /pg_advisory_xact_lock/);
    if (namespace === 6193) {
      assert.equal(typeof target, "string");
      locks.push("flag-lock");
    } else {
      assert.equal(namespace, 1_309_542_515);
      assert.equal(target, 302454);
      locks.push("policy-advisory-lock");
    }
    return 0;
  },
  $queryRaw: async (strings, id) => {
    const sql = strings.join("?");
    assert.match(sql, /FOR UPDATE$/);
    if (sql.includes('"FeatureFlagReview"')) {
      assert.equal(locks.at(-1), "flag-lock");
      locks.push("review-lock");
      return reviews.has(id) ? [{ id }] : [];
    }
    if (id === 123) return [{ id }];
    assert.equal(id, 302454);
    if (sql.includes('"Comment"')) {
      assert.equal(locks.at(-1), "policy-advisory-lock");
      assert.match(sql, /JOIN "Task"/);
      locks.push("policy-comment-lock");
      return policy ? [{ id }] : [];
    }
    assert.equal(sql, 'SELECT id FROM "Reaction" WHERE "commentId" = ? FOR UPDATE');
    assert.equal(locks.at(-1), "policy-comment-lock");
    locks.push("policy-reaction-lock");
    return [];
  },
  comment: {
    findFirst: async (query) => {
      if (query.where.id === 123) {
        if (!legacyAllowed) return null;
        if (query.select.taskId && !query.select.id) return { taskId: 900 };
        const reaction = query.select.reactions.where;
        assert.deepEqual({ ...reaction, createdAt: undefined }, {
          userId: 6, agentId: null, agentDisplayName: null, isDeleted: false,
          unified: { startsWith: "1f44d" }, createdAt: undefined,
        });
        const createdAt = new Date();
        assert.ok(createdAt >= reaction.createdAt.gte);
        return {
          id: 123, taskId: 900, creatorId: 6, agentId: "agent-b", agentDisplayName: null,
          text: `Question: Switch ${legacyKey} to ${legacyMode}?`, commentText: null,
          createdAt, editedAt: null, editedByUserId: null, editedByAgentId: null,
          reactions: [{ createdAt }],
        };
      }
      assert.equal(locks.at(-1), "policy-reaction-lock");
      assert.deepEqual(query, {
        where: {
          id: 302454, editedAt: null, task: { status: { not: "Deleted" } },
          reactions: { some: { userId: 6, agentId: null, agentDisplayName: null, isDeleted: false, unified: { startsWith: "1f44d" } } },
        }, select: { id: true },
      });
      locks.push("policy-check");
      if (!policy || policy.editedAt || policy.status === "Deleted") return null;
      return policy.reactions.some((reaction) => reaction.userId === 6 && reaction.agentId === null
        && reaction.agentDisplayName === null && !reaction.isDeleted && reaction.unified.startsWith("1f44d")) ? { id: 302454 } : null;
    },
    findMany: async (query) => {
      assert.equal(query.where.taskId, 900);
      assert.equal(query.where.creatorId, 6);
      assert.equal(query.where.agentId, null);
      assert.equal(query.where.agentDisplayName, null);
      return [];
    },
  },
};
prisma.$transaction = async (callback) => {
  const preceding = transactionTail;
  let release;
  transactionTail = new Promise((resolve) => { release = resolve; });
  await preceding;
  const snapshot = structuredClone({ reviews, stored, changes });
  try {
    return await callback(prisma);
  } catch (error) {
    ({ reviews, stored, changes } = snapshot);
    throw error;
  } finally {
    release();
  }
};
stubModule("src/lib/prisma.ts", { default: prisma });
stubModule("src/lib/flags/definitions.ts", { FEATURE_FLAG_DEFINITIONS: definitions });
stubModule("src/lib/flags/releaseRisk.ts", {
  FEATURE_FLAG_RELEASE_RISKS: Object.fromEntries(definitions.filter((flag) => flag.releaseRisk).map((flag) => [flag.key, flag.releaseRisk])),
});
stubModule("src/lib/auth/agentScope.ts", {
  agentScopeEnforced: () => true,
  recordAgentBoardScopeMiss: () => {},
  prepareAgentScope: async () => {},
  withAgentScopeRequest: (_request, run) => run(),
});
stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => limited?.clone() ?? null,
  validateMcpAuth: async (_request, options) => {
    assert.deepEqual(options, { deferManagementPermissionCheck: true });
    return ctx;
  },
});
stubModule("src/lib/mcp/agents/readRoleGuard.ts", { requireAgentWriteRole: async () => roleRefusal?.clone() ?? null });
stubModule("src/lib/mcp/routeWrapper.ts", { wrapMcpRoute: (callback) => { wrapped++; return callback; } });
stubModule("src/lib/realtime/server.ts", { broadcastFeatureFlagsChange: async () => { broadcasts++; } });
delete process.env.REDIS_URL;
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const flags = jiti(path.join(root, "src/lib/flags.ts"));
const { PATCH } = jiti(path.join(root, "src/app/api/mcp/flags/route.ts"));
const { POST } = jiti(path.join(root, "src/app/api/mcp/flags/reviews/route.ts"));
function request(method, body, contentType = "application/json") {
  return new NextRequest("https://local.test/api/mcp/flags", {
    method, headers: { authorization: "Bearer test-credential", "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function result(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { status: response.status, body: await response.json() };
}
async function record(body = evidence) {
  return result(await POST(request("POST", body)));
}
async function switchFlag(body = { key, mode: "EVERYONE", review: 1 }) {
  return result(await PATCH(request("PATCH", body)));
}
async function seedReview(overrides = {}) {
  assert.equal((await record()).status, 201);
  Object.assign(reviews.get(1), overrides);
  ctx.agentId = "agent-a";
}
function assertNoChange() {
  assert.equal(changes.length, 0);
  assert.equal(broadcasts, 0);
  assert.ok([...reviews.values()].every((review) => review.usedAt === null && review.usedByChangeId === null));
}
test.beforeEach(() => {
  ctx = { user: { id: 6 }, agentId: "agent-b", agentRole: "write" };
  limited = null; roleRefusal = null; persistedRole = "write"; ownerEmail = "valentin.yeo@gmail.com";
  reviews = new Map(); stored = new Map([[key, { key, mode: "OWNER_AND_QA" }]]); changes = [];
  locks = []; broadcasts = 0; writeFails = false; consumeFails = false; legacyAllowed = true; legacyKey = key; legacyMode = "Off"; wrapped = 0;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  policy = { editedAt: null, status: "Normal", reactions: [{ userId: 6, agentId: null, agentDisplayName: null, isDeleted: false, unified: "1f44d", createdAt: new Date(0) }] };
});

test("agent B records immutable evidence and agent A switches, consuming the review with the change atomically", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "deployed-sha";
  const recorded = await record({ ...evidence, reviewerAgentId: "forged", reviewerUserId: 7, usedAt: new Date(), inboxCyclePassed: false, deployedSha: "forged" });
  assert.equal(recorded.status, 201);
  const review = reviews.get(1);
  assert.equal(review.reviewerAgentId, "agent-b");
  assert.equal(review.reviewerUserId, 6);
  assert.equal(review.deployedSha, "deployed-sha");
  assert.equal(review.inboxCyclePassed, true);
  assert.equal(review.usedAt, null);
  assert.equal(review.independentReview, evidence.independentReview);
  assert.equal(review.aiReviewUrl, evidence.aiReviewUrl);
  assert.equal(review.liveQaUrl, evidence.liveQaUrl);
  ctx.agentId = "agent-a";
  process.env.VERCEL_GIT_COMMIT_SHA = "another-deploy";
  const switched = await switchFlag();
  assert.equal(switched.status, 200);
  assert.equal(switched.body.previousMode, "OWNER_AND_QA");
  assert.equal(switched.body.flag.mode, "EVERYONE");
  assert.equal(changes[0].reason, "flag-review:1");
  assert.equal(changes[0].agentId, "agent-a");
  assert.equal(review.usedByChangeId, changes[0].id);
  assert.ok(review.usedAt instanceof Date);
  assert.equal(broadcasts, 1);
  assert.equal(wrapped, 2);
  assert.deepEqual(locks, ["flag-lock", "review-lock", "policy-advisory-lock", "policy-comment-lock", "policy-reaction-lock", "policy-check", "change-write", "review-used", "flag-write"]);
});

test("record stores null deployed SHA when unset", async () => {
  assert.equal((await record()).status, 201);
  assert.equal(reviews.get(1).deployedSha, null);
});
test("same-agent switch is refused with different agent in the error", async () => {
  await seedReview(); ctx.agentId = "agent-b";
  const response = await switchFlag();
  assert.equal(response.status, 403);
  assert.match(response.body.error, /different agent/);
  assertNoChange();
});
test("a used review cannot be reused even after the flag is switched back", async () => {
  await seedReview(); assert.equal((await switchFlag()).status, 200);
  stored.get(key).mode = "OWNER_AND_QA";
  assert.equal((await switchFlag()).status, 403);
  assert.equal(changes.length, 1);
});
test("competing switches consume a review only once", async () => {
  await seedReview();
  const responses = await Promise.all([switchFlag(), switchFlag()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(changes.length, 1);
});
for (const [name, overrides] of [
  ["older than 24 hours", { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 10000) }],
  ["another key", { key: "another-key" }], ["another mode", { mode: "OFF" }],
  ["another user", { reviewerUserId: 7 }],
]) {
  test(`review for ${name} is refused`, async () => {
    await seedReview(overrides);
    assert.equal((await switchFlag()).status, 403);
    assertNoChange();
  });
}
test("unknown review is refused", async () => {
  assert.equal((await switchFlag()).status, 403); assertNoChange();
});
for (const mode of ["OFF", "OWNER_ONLY", "OWNER_AND_QA"]) {
  test(`review cannot be recorded or used for ${mode}`, async () => {
    assert.equal((await record({ ...evidence, mode })).status, 403);
    await seedReview();
    assert.equal((await switchFlag({ key, mode, review: 1 })).status, 403);
    assertNoChange();
  });
}
for (const pathKind of ["review", "failure"]) {
  for (const scenario of ["removed", "agent", "deleted-agent", "deleted-reaction", "wrong-user", "wrong-emoji", "edited-comment", "deleted-task", "missing-comment"]) {
    test(`${pathKind} ${pathKind === "review" ? "refuses" : "ignores"} policy ${scenario}`, async () => {
      await seedReview();
      const reaction = policy.reactions[0];
      if (scenario === "removed") policy.reactions = [];
      if (scenario === "agent") reaction.agentId = "agent-a";
      if (scenario === "deleted-agent") reaction.agentDisplayName = "Deleted agent";
      if (scenario === "deleted-reaction") reaction.isDeleted = true;
      if (scenario === "wrong-user") reaction.userId = 7;
      if (scenario === "wrong-emoji") reaction.unified = "2764";
      if (scenario === "edited-comment") policy.editedAt = new Date();
      if (scenario === "deleted-task") policy.status = "Deleted";
      if (scenario === "missing-comment") policy = null;
      if (pathKind === "failure") stored.get(key).mode = "EVERYONE";
      const response = await switchFlag(pathKind === "review" ? undefined : { key, mode: "OWNER_AND_QA", failure });
      assert.equal(response.status, pathKind === "review" ? 403 : 200);
      if (pathKind === "review") assertNoChange();
      else { assert.equal(changes.length, 1); assert.equal(changes[0].newMode, "OWNER_AND_QA"); }
    });
  }
  test(`${pathKind} refuses stored and unstored default no-ops`, async () => {
    await seedReview();
    const mode = pathKind === "review" ? "EVERYONE" : "OWNER_AND_QA";
    stored.get(key).mode = mode;
    const body = pathKind === "review" ? { key, mode, review: 1 } : { key, mode, failure };
    assert.equal((await switchFlag(body)).status, 403);
    const defaultFlag = definitions.find((flag) => flags.defaultFeatureFlagMode(flag.key) === mode
      && (pathKind === "review" || (flag.releaseRisk && !flag.releaseRisk.highRisk && flag.kind !== "bugfix")));
    assert.ok(defaultFlag);
    reviews.get(1).key = defaultFlag.key;
    assert.equal((await switchFlag({ ...body, key: defaultFlag.key })).status, 403);
    assertNoChange();
  });
  test(`${pathKind} still allows old human policy thumbs-up with a skin tone`, async () => {
    await seedReview(); policy.reactions[0].unified = "1f44d-1f3fd";
    if (pathKind === "failure") stored.get(key).mode = "EVERYONE";
    assert.equal((await switchFlag(pathKind === "review" ? undefined : { key, mode: "OWNER_AND_QA", failure })).status, 200);
  });
}

test("failure-Owner + QA on a classified non-bugfix flag succeeds with audit evidence", async () => {
  stored.get(key).mode = "EVERYONE";
  const response = await switchFlag({ key, mode: "OWNER_AND_QA", failure });
  assert.equal(response.status, 200);
  assert.equal(response.body.previousMode, "EVERYONE");
  assert.equal(response.body.flag.mode, "OWNER_AND_QA");
  assert.equal(stored.get(key).mode, "OWNER_AND_QA");
  assert.equal(changes[0].reason, `live-qa-failed:${failure}`);
  assert.equal(changes[0].agentId, "agent-b");
  assert.equal(broadcasts, 1);
  assert.equal(reviews.size, 0);
  assert.deepEqual(locks, ["flag-lock", "change-write", "flag-write"]);
});
for (const flag of [
  ...["money", "access", "data-deletion", "customer-email"].map((category) => definitions.find((flag) => flag.releaseRisk?.highRisk === category)),
  bugfix, { key: "legacy-unclassified" },
]) {
  test(`failure-Owner + QA holds ${flag.key} down without approval and records exactly one audit`, async () => {
    policy = null;
    stored.set(flag.key, { key: flag.key, mode: "EVERYONE" });
    const response = await switchFlag({ key: flag.key, mode: "OWNER_AND_QA", failure });
    assert.equal(response.status, 200);
    assert.equal(response.body.previousMode, "EVERYONE");
    assert.equal(stored.get(flag.key).mode, "OWNER_AND_QA");
    assert.equal(changes.length, 1);
    assert.equal(changes[0].key, flag.key);
    assert.equal(changes[0].oldMode, "EVERYONE");
    assert.equal(changes[0].newMode, "OWNER_AND_QA");
    assert.equal(changes[0].userId, 6);
    assert.equal(changes[0].agentId, "agent-b");
    assert.equal(changes[0].agentName, "agent-b");
    assert.equal(changes[0].source, "api");
    assert.equal(changes[0].reason, `live-qa-failed:${failure}`);
    assert.deepEqual(locks, ["flag-lock", "change-write", "flag-write"]);
  });
}
for (const flagKey of ["unknown-flag", "htpr-6091-feature-flags"]) {
  test(`failure-Owner + QA refuses unknown or retired ${flagKey}`, async () => {
    assert.equal((await switchFlag({ key: flagKey, mode: "OWNER_AND_QA", failure })).status, 400);
    assertNoChange();
    assert.equal(stored.has(flagKey), false);
  });
}
for (const mode of ["EVERYONE", "OWNER_ONLY", "OFF"]) {
  test(`failure cannot switch ${mode}`, async () => {
    assert.equal((await switchFlag({ key, mode, failure })).status, 403); assertNoChange();
  });
}
test("failure-Owner + QA refuses to widen an Owner Only flag", async () => {
  stored.get(key).mode = "OWNER_ONLY";
  assert.equal((await switchFlag({ key, mode: "OWNER_AND_QA", failure })).status, 403);
  assert.equal(stored.get(key).mode, "OWNER_ONLY");
  assertNoChange();
});

for (const reason of [`live-qa-failed:${failure}`, "https://app.hypertask.ai/detail/project-15/8232#comment-1"]) {
  test(`failure-Owner + QA never re-enables an Off flag, even when its last change was ${reason.slice(0, 24)}`, async () => {
    stored.get(key).mode = "OFF";
    changes.push({ key, reason, oldMode: "OWNER_ONLY", newMode: "OFF" });
    assert.equal((await switchFlag({ key, mode: "OWNER_AND_QA", failure })).status, 403);
    assert.equal(stored.get(key).mode, "OFF");
    assert.equal(changes.length, 1);
    assert.equal(broadcasts, 0);
  });
}

test("failure-Owner + QA refuses a flag already held and leaves history empty", async () => {
  assert.equal((await switchFlag({ key, mode: "OWNER_AND_QA", failure })).status, 403);
  assertNoChange();
});
for (const reason of ["Emergency safety stop", "http://qa.test/failure", "x".repeat(300)]) {
  test(`failure-Owner + QA accepts a nonblank reason: ${reason.slice(0, 30)}`, async () => {
    policy = null;
    stored.get(key).mode = "EVERYONE";
    assert.equal((await switchFlag({ key, mode: "OWNER_AND_QA", failure: reason })).status, 200);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].reason, `live-qa-failed:${reason}`);
  });
}
for (const role of ["read", "write", "admin"]) {
  for (const fromContext of [true, false]) {
    test(`failure-Owner + QA unconditionally enforces ${role} from ${fromContext ? "auth context" : "persisted permissions"}`, async () => {
      ctx.agentRole = fromContext ? role : undefined;
      persistedRole = role;
      roleRefusal = null;
      policy = null;
      stored.get(key).mode = "EVERYONE";
      const response = await switchFlag({ key, mode: "OWNER_AND_QA", failure });
      assert.equal(response.status, role === "read" ? 403 : 200);
      if (role === "read") { assert.equal(response.body.code, "insufficient_scope"); assertNoChange(); }
      else assert.equal(changes.length, 1);
    });
  }
}
test("competing failure-Owner + QA requests create one audit under serialized transactions", async () => {
  stored.get(key).mode = "EVERYONE";
  const responses = await Promise.all([switchFlag({ key, mode: "OWNER_AND_QA", failure }), switchFlag({ key, mode: "OWNER_AND_QA", failure })]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(changes.length, 1);
  assert.equal(broadcasts, 1);
});
test("failure-Owner + QA rolls back the audit when the flag write fails", async (t) => {
  t.mock.method(console, "error", () => {});
  writeFails = true;
  stored.get(key).mode = "EVERYONE";
  assert.equal((await switchFlag({ key, mode: "OWNER_AND_QA", failure })).status, 500);
  assert.equal(stored.get(key).mode, "EVERYONE");
  assertNoChange();
});
for (const body of [
  { key, mode: "EVERYONE" }, { key, mode: "EVERYONE", review: 1, reason: "x" },
  { key, mode: "OFF", review: 1, failure }, { key, mode: "OFF", reason: "x", failure },
  ...[null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((review) => ({ key, mode: "EVERYONE", review })),
  ...["", " ", "\t\n", "x".repeat(301), null, 42, {}, []].map((url) => ({ key, mode: "OFF", failure: url })),
]) {
  test(`invalid switch evidence ${JSON.stringify(body)} is refused`, async () => {
    assert.equal((await switchFlag(body)).status, 400); assertNoChange();
  });
}
for (const [name, setup] of [
  ["other user's agent", () => { ctx.user.id = 7; }],
  ["no agent", () => { ctx.agentId = null; }],
  ["management key", () => { ctx.management = { keyId: "test" }; }],
  ["mismatched owner email", () => { ownerEmail = "other@test.invalid"; }],
  ["no auth", () => { ctx = null; }],
  ["read role", () => { roleRefusal = NextResponse.json({ error: "write required" }, { status: 403, headers: { "cache-control": "private, no-store" } }); }],
]) {
  test(`record and switch refuse ${name}`, async () => {
    setup();
    const expected = ctx ? 403 : 401;
    assert.equal((await record()).status, expected);
    assert.equal((await switchFlag()).status, expected);
    assert.equal((await switchFlag({ key, mode: "OFF", failure })).status, expected);
    assert.equal(reviews.size, 0); assertNoChange();
  });
}
test("rate limit applies before auth to record and switch", async () => {
  ctx = null; limited = NextResponse.json({ error: "rate limited" }, { status: 429 });
  assert.equal((await record()).status, 429); assert.equal((await switchFlag()).status, 429);
  assert.equal((await switchFlag({ key, mode: "OFF", failure })).status, 429); assertNoChange();
});
for (const [name, fields] of [
  ["unknown flag", { key: "unknown-flag" }], ["retired flag", { key: "htpr-6091-feature-flags" }],
  ["invalid key", { key: "Bad Flag" }], ["empty independent", { independentReview: "  " }],
  ["long independent", { independentReview: "x".repeat(301) }], ["missing independent", { independentReview: undefined }],
  ["failed inbox", { inboxCycle: "failed" }], ["missing inbox", { inboxCycle: undefined }],
  ["HTTP live QA", { liveQaUrl: "http://qa.test/pass" }], ["bad live QA", { liveQaUrl: "not a URL" }],
  ["long live QA", { liveQaUrl: "https://qa.test/" + "x".repeat(300) }],
  ["HTTP AI review", { aiReviewUrl: "http://github.com/hypertask-ai/hypertask/pull/1" }],
  ["other repo", { aiReviewUrl: "https://github.com/other/repo/pull/1" }],
  ["PR suffix", { aiReviewUrl: `${evidence.aiReviewUrl}/extra` }], ["missing AI review", { aiReviewUrl: undefined }],
  ["long AI review", { aiReviewUrl: "https://github.com/hypertask-ai/hypertask/pull/" + "1".repeat(300) }],
]) {
  test(`record refuses ${name}`, async () => {
    assert.equal((await record({ ...evidence, ...fields })).status, 400); assert.equal(reviews.size, 0);
  });
}
test("record validates body, JSON, content type and size", async () => {
  for (const body of ["null", "[]", "1", "{"]) assert.equal((await record(body)).status, 400);
  assert.equal((await result(await POST(request("POST", evidence, "text/plain")))).status, 415);
  assert.equal((await record(" ".repeat(2049))).status, 413);
  assert.equal(reviews.size, 0);
});
test("record still allows maximum-length evidence and a known stored legacy flag", async () => {
  const legacy = "legacy-rollout"; stored.set(legacy, { key: legacy, mode: "OFF" });
  assert.equal((await record({ ...evidence, key: legacy, independentReview: "x".repeat(300), liveQaUrl: "https://qa.test/".padEnd(300, "x") })).status, 201);
});
for (const category of ["money", "access", "data-deletion", "customer-email"]) {
  test(`review refuses high-risk ${category}`, async () => {
    const high = definitions.find((flag) => flag.releaseRisk?.highRisk === category);
    stored.set(high.key, { key: high.key, mode: "OWNER_AND_QA" });
    await seedReview({ key: high.key });
    const response = await switchFlag({ key: high.key, mode: "EVERYONE", review: 1 });
    assert.equal(response.status, 403); assert.match(response.body.error, /high-risk/); assertNoChange();
  });
}
test("Question plus human thumbs-up still allows a high-risk flag to switch Everyone on", async () => {
  const high = definitions.find((flag) => flag.releaseRisk?.highRisk);
  stored.set(high.key, { key: high.key, mode: "OWNER_AND_QA" }); policy = null; legacyKey = high.key; legacyMode = "Everyone";
  const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
  assert.equal((await switchFlag({ key: high.key, mode: "EVERYONE", reason })).status, 200);
});
test("Question plus human thumbs-up still allows Off without policy approval", async () => {
  policy = null;
  const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
  assert.equal((await switchFlag({ key, mode: "OFF", reason })).status, 200);
  assert.equal(changes[0].reason, reason);
  assert.equal(locks.includes("policy-advisory-lock"), false);
});
for (const flagKey of [definitions.find((flag) => flag.releaseRisk?.highRisk).key, bugfix.key, "htpr-7036-ctrlk-column-delete-keeps-cards"]) {
  test(`Question path still allows Off for ${flagKey} without review policy approval`, async () => {
    policy = null; legacyKey = flagKey;
    stored.set(flagKey, { key: flagKey, mode: "EVERYONE" });
    const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
    assert.equal((await switchFlag({ key: flagKey, mode: "OFF", reason })).status, 200);
    assert.equal(changes[0].reason, reason);
  });
}
test("review is still valid just inside the 24-hour window", async () => {
  await seedReview({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 60000) });
  assert.equal((await switchFlag()).status, 200);
});
for (const failurePoint of ["flag", "review"]) {
  test(`${failurePoint} write failure rolls back flag, audit and review consumption`, async (t) => {
    t.mock.method(console, "error", () => {});
    await seedReview();
    if (failurePoint === "flag") writeFails = true; else consumeFails = true;
    assert.equal((await switchFlag()).status, 500);
    assert.equal(stored.get(key).mode, "OWNER_AND_QA"); assertNoChange();
  });
}
test("ht-flag shell regressions and new review/failure commands pass offline", async () => {
  const result = await promisify(execFile)("bash", [path.join(root, ".claude/skills/ship/scripts/ht-flag.test.sh")], {
    encoding: "utf8", timeout: 60000,
  });
  assert.match(result.stdout, /ht-flag tests passed/);
});
