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

class FeatureFlagInputError extends Error {}
class FeatureFlagApprovalError extends Error {}
const LEASE_FLAG = "yper4-801-manager-lease-flag-switch";
const key = "htpr-3533-google-calendar";
const reason = "https://app.hypertask.ai/detail/project-4060/215#comment-123";
const approvalRequired = "Needs a clear yes from Valentin within 7 days: his thumbs up on the switch question, his own comment on the ticket after exactly one switch question, or HT Product Lead's in-chat record of his exact words. Questions name the switch: Switch <flag-key> to <mode>";

let ctx;
let agentName;
let leaseFlagOn;
let flagReads;
let grants;
let setCalls;
let lookups;
let registryBroken;
let readOnly;
let duringLock;

function fakeTx() {
  return {
    $queryRaw: async () => { lookups.push("lock"); return []; },
    $executeRaw: async () => { lookups.push("advisory"); duringLock?.(); return 0; },
    comment: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    managerLeaseGrant: {
      findUnique: async ({ where }) => {
        if (registryBroken) throw new Error("registry unavailable");
        return grants.find((row) => row.tokenHash === where.tokenHash) ?? null;
      },
      findFirst: async ({ where }) => grants.find((row) => row.releasedAt === null && row.replacedAt === null && row.expiresAt > where.expiresAt.gt) ?? null,
      updateMany: async ({ data }) => {
        for (const row of grants) if (row.releasedAt === null && row.replacedAt === null) Object.assign(row, data);
      },
      create: async ({ data }) => { grants.push({ id: grants.length + 1, releasedAt: null, replacedAt: null, renewedAt: null, ...data }); },
      update: async ({ where, data }) => Object.assign(grants.find((row) => row.tokenHash === where.tokenHash), data),
    },
  };
}

stubModule("src/lib/auth/agentScope.ts", {
  agentScopeEnforced: () => true,
  recordAgentBoardScopeMiss: () => {},
  prepareAgentScope: async () => {},
  withAgentScopeRequest: (_request, run) => run(),
});
stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateMcpAuth: async () => ctx,
});
stubModule("src/lib/mcp/agents/readRoleGuard.ts", { requireAgentWriteRole: async () => (readOnly ? NextResponse.json({ error: "write role required" }, { status: 403 }) : null) });
stubModule("src/lib/mcp/routeWrapper.ts", { wrapMcpRoute: (callback) => callback });
stubModule("src/lib/realtime/server.ts", { broadcastFeatureFlagsChange: async () => {} });
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
  FeatureFlagInputError,
  FeatureFlagApprovalError,
  defaultFeatureFlagMode: () => "OWNER_AND_QA",
  isFeatureEnabled: async (flagKey) => {
    flagReads.push(flagKey);
    return flagKey === LEASE_FLAG ? leaseFlagOn : false;
  },
  isFeatureFlagOwnerUserId: async (userId) => userId === 6,
  listFeatureFlagModes: async () => [],
  setFeatureFlagMode: async (...args) => {
    await args[3](fakeTx());
    setCalls.push(args.slice(0, 3));
    return { key: args[0], mode: args[1], lastChange: null };
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    agent: { findUniqueOrThrow: async () => ({ displayName: agentName }) },
    $transaction: async (callback) => callback(fakeTx()),
  },
});

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { PATCH } = jiti(path.join(root, "src/app/api/mcp/flags/route.ts"));
const leases = jiti(path.join(root, "src/app/api/mcp/manager-leases/route.ts"));
const { hashManagerGrant, isManagerClassAgentName, MANAGER_GRANT_HEADER } = jiti(path.join(root, "src/lib/flags/managerLease.ts"));

const token = "A".repeat(43);
const otherToken = "B".repeat(43);
function liveGrant(overrides = {}) {
  return {
    id: 1, agentId: "manager-1", session: "ht-product-lead", tokenHash: hashManagerGrant(token), ttlMinutes: 30,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000), renewedAt: null, replacedAt: null, releasedAt: null,
    ...overrides,
  };
}
function patch(headers = {}) {
  return PATCH(new NextRequest("https://app.hypertask.ai/api/mcp/flags", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ key, mode: "OWNER_AND_QA", reason }),
  }));
}
function post(body, headers = {}) {
  return leases.POST(new NextRequest("https://app.hypertask.ai/api/mcp/manager-leases", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}
async function refusalText(response) {
  assert.equal(response.status, 403);
  return (await response.json()).error;
}

test.beforeEach(() => {
  ctx = { user: { id: 6 }, agentId: "manager-1", management: false, teamScope: undefined };
  agentName = "HT Product Lead";
  leaseFlagOn = true;
  flagReads = [];
  grants = [liveGrant()];
  setCalls = [];
  lookups = [];
  registryBroken = false;
  readOnly = false;
  duringLock = null;
});

test("class of manager agents comes from the stored agent name", () => {
  for (const name of ["HT Product Lead", "HT Design Lead", "HT Finance", "Mini Boss CEO"]) assert.equal(isManagerClassAgentName(name), true, name);
  for (const name of ["Runner 2", "CEO Runner 1", "Hax Runner 3", "Valentins Claude Code CLI", "HT Product Lead Helper", "ht product lead"]) assert.equal(isManagerClassAgentName(name), false, name);
});

test("a manager holding the current grant still reaches the existing approval checks", async () => {
  const text = await refusalText(await patch({ [MANAGER_GRANT_HEADER]: token }));
  assert.equal(text, approvalRequired);
  assert.deepEqual(flagReads.includes(LEASE_FLAG), true);
});

test("a manager without a grant header is refused before any approval check", async () => {
  assert.match(await refusalText(await patch()), /no grant sent/);
  assert.deepEqual(setCalls, []);
});

test("a replaced, released, expired, unknown or other-agent grant is refused", async () => {
  const cases = [
    [liveGrant({ replacedAt: new Date() }), token, /was replaced/],
    [liveGrant({ releasedAt: new Date() }), token, /was released/],
    [liveGrant({ expiresAt: new Date(Date.now() - 1000) }), token, /expired/],
    [liveGrant(), otherToken, /unknown/],
    [liveGrant({ agentId: "someone-else" }), token, /unknown/],
    [liveGrant(), "short", /malformed/],
  ];
  for (const [row, sent, expected] of cases) {
    grants = [row];
    assert.match(await refusalText(await patch({ [MANAGER_GRANT_HEADER]: sent })), expected);
  }
});

test("a reused name never restores the previous grant", async () => {
  grants = [liveGrant({ replacedAt: new Date(), session: "ht-product-lead" }),
    liveGrant({ id: 2, tokenHash: hashManagerGrant(otherToken), session: "ht-product-lead" })];
  assert.match(await refusalText(await patch({ [MANAGER_GRANT_HEADER]: token })), /was replaced/);
  assert.equal(await refusalText(await patch({ [MANAGER_GRANT_HEADER]: otherToken })), approvalRequired);
});

test("an unreadable registry fails closed and changes nothing", async () => {
  registryBroken = true;
  const response = await patch({ [MANAGER_GRANT_HEADER]: token });
  assert.equal(response.status, 500);
  assert.deepEqual(setCalls, []);
});

test("runners are not asked for a grant and never read the lease flag", async () => {
  agentName = "Runner 2";
  grants = [];
  assert.equal(await refusalText(await patch()), approvalRequired);
  assert.equal(flagReads.includes(LEASE_FLAG), false);
});

test("with the lease flag off a manager keeps today's behaviour", async () => {
  leaseFlagOn = false;
  grants = [];
  assert.equal(await refusalText(await patch()), approvalRequired);
});

test("registry take, renew, handoff and takeover keep one live holder", async () => {
  grants = [];
  const hash = hashManagerGrant(token);
  const taken = await post({ action: "take", session: "ht-product-lead", grantHash: hash, ttlMinutes: 30 });
  assert.equal(taken.status, 200);
  assert.equal(grants.length, 1);
  assert.equal(JSON.stringify(grants).includes(token), false);

  const second = await post({ action: "take", session: "ht-design-lead", grantHash: hashManagerGrant(otherToken), ttlMinutes: 30 });
  assert.equal(second.status, 409);
  assert.equal(grants.length, 1);

  const renewed = await post({ action: "renew", grant: token });
  assert.equal(renewed.status, 200);
  assert.notEqual(grants[0].renewedAt, null);

  const stale = await post({ action: "renew", grant: otherToken });
  assert.equal(stale.status, 403);

  const handoff = await post({ action: "handoff", grant: token });
  assert.equal(handoff.status, 200);
  assert.equal(grants[0].endedReason, "handoff");

  const afterHandoff = await post({ action: "take", session: "ht-design-lead", grantHash: hashManagerGrant(otherToken), ttlMinutes: 30 });
  assert.equal(afterHandoff.status, 200);
  assert.equal(grants.length, 2);
  assert.equal((await post({ action: "renew", grant: token })).status, 403);
  assert.equal((await post({ action: "release", grant: token })).status, 403);
  assert.equal((await post({ action: "release", grant: otherToken })).status, 200);
});

test("an expired holder cannot renew, release or hand off, and a takeover replaces it", async () => {
  grants = [liveGrant({ expiresAt: new Date(Date.now() - 1000) })];
  for (const action of ["renew", "release", "handoff"]) assert.equal((await post({ action, grant: token })).status, 403, action);
  const takeover = await post({ action: "take", session: "ht-design-lead", grantHash: hashManagerGrant(otherToken), ttlMinutes: 30 });
  assert.equal(takeover.status, 200);
  assert.notEqual(grants[0].replacedAt, null);
});

test("a grant that expires while a renewal waits for the lock is refused", async () => {
  const live = grants[0].expiresAt;
  duringLock = () => { grants[0].expiresAt = new Date(Date.now() - 1000); };
  assert.equal((await post({ action: "renew", grant: token })).status, 403);
  duringLock = null;
  grants[0].expiresAt = live;
  assert.equal((await post({ action: "renew", grant: token })).status, 200);
});

test("read-only agents cannot take, renew, release or hand off the lease", async () => {
  readOnly = true;
  for (const body of [{ action: "take", session: "ht-product-lead", grantHash: hashManagerGrant(token), ttlMinutes: 30 }, { action: "renew", grant: token }]) {
    const response = await post(body);
    assert.equal(response.status, 403, body.action);
  }
  assert.equal(grants[0].renewedAt, null);
});

test("registry refuses non managers and malformed requests", async () => {
  agentName = "Runner 2";
  assert.equal((await post({ action: "take", session: "x", grantHash: hashManagerGrant(token), ttlMinutes: 30 })).status, 403);
  agentName = "HT Product Lead";
  assert.equal((await post({ action: "take", session: "x", grantHash: "nothex", ttlMinutes: 30 })).status, 400);
  assert.equal((await post({ action: "take", session: "x", grantHash: hashManagerGrant(token), ttlMinutes: 9999 })).status, 400);
  assert.equal((await post({ action: "renew" })).status, 400);
  assert.equal((await post({ action: "nope" })).status, 400);
  assert.equal(NextResponse.json({}).status, 200);
});
