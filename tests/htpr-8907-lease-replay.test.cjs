const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

class FeatureFlagApprovalError extends Error {}
const lease = loadModule("src/lib/flags/managerLease.ts", {
  "@/lib/flags": { FeatureFlagApprovalError },
});

const token = "A".repeat(43);
const otherToken = "B".repeat(43);
const hash = createHash("sha256").update(token).digest("hex");
const otherHash = createHash("sha256").update(otherToken).digest("hex");

function world() {
  return { grants: [], operations: [], failWrite: false };
}

function txFor(state) {
  return {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    managerLeaseGrant: {
      findUnique: async ({ where }) => state.grants.find((row) => row.tokenHash === where.tokenHash) ?? null,
      findFirst: async ({ where }) => state.grants.find((row) => row.releasedAt === null && row.replacedAt === null && row.expiresAt > where.expiresAt.gt) ?? null,
      updateMany: async ({ data }) => {
        for (const row of state.grants) if (row.releasedAt === null && row.replacedAt === null) Object.assign(row, data);
      },
      create: async ({ data }) => {
        state.grants.push({ releasedAt: null, replacedAt: null, renewedAt: null, endedReason: null, ...data });
      },
      update: async ({ where, data }) => Object.assign(state.grants.find((row) => row.tokenHash === where.tokenHash), data),
    },
    managerLeaseOperation: {
      findUnique: async ({ where }) => {
        const key = where.agentId_operationId;
        return state.operations.find((row) => row.agentId === key.agentId && row.operationId === key.operationId) ?? null;
      },
      create: async ({ data }) => {
        if (state.failWrite) throw new Error("operation write failed");
        state.operations.push({ ...data });
      },
    },
  };
}

async function apply(state, input) {
  const snapGrants = state.grants.map((row) => ({ ...row }));
  const snapOps = state.operations.map((row) => ({ ...row }));
  try {
    return await lease.applyManagerLeaseAction(txFor(state), input);
  } catch (error) {
    state.grants.splice(0, state.grants.length, ...snapGrants.map((row) => ({ ...row })));
    state.operations.splice(0, state.operations.length, ...snapOps.map((row) => ({ ...row })));
    throw error;
  }
}

test("lost replies confirm the same ownership and a replaced manager is refused", async () => {
  const state = world();
  const taken = await apply(state, {
    agentId: "manager-1", action: "take", operationId: "take-operation-0001",
    session: "ht-product-lead", grantHash: hash, ttlMinutes: 30,
  });
  const replay = await apply(state, {
    agentId: "manager-1", action: "take", operationId: "take-operation-0001",
    session: "ht-product-lead", grantHash: hash, ttlMinutes: 30,
  });
  assert.equal(replay.expiresAt.toISOString(), taken.expiresAt.toISOString());
  assert.equal(state.grants.length, 1);
  assert.equal(JSON.stringify(state).includes(token), false);

  const blocked = await apply(state, {
    agentId: "manager-1", action: "take", operationId: "take-blocked-000001",
    session: "other", grantHash: otherHash, ttlMinutes: 30,
  }).then(() => { throw new Error("blocked take reported success"); }, (error) => error);
  assert.equal(blocked.status, 409);
  assert.equal(await lease.readManagerLeaseOperation(txFor(state), { agentId: "manager-1", operationId: "take-blocked-000001" }), null);

  await assert.rejects(
    () => apply(state, { agentId: "other-agent", action: "renew", operationId: "other-agent-renew01", grantHash: hash }),
    (error) => error.status === 403,
  );

  const renewed = await apply(state, { agentId: "manager-1", action: "renew", operationId: "renew-operation-001", grantHash: hash });
  const renewedAt = state.grants[0].renewedAt;
  const renewedAgain = await apply(state, { agentId: "manager-1", action: "renew", operationId: "renew-operation-001", grantHash: hash });
  assert.equal(renewedAgain.expiresAt.toISOString(), renewed.expiresAt.toISOString());
  assert.equal(state.grants[0].renewedAt, renewedAt);

  state.failWrite = true;
  const before = state.grants[0].expiresAt;
  await assert.rejects(
    () => apply(state, { agentId: "manager-1", action: "renew", operationId: "renew-write-fail001", grantHash: hash }),
    (error) => error.message === "operation write failed",
  );
  assert.equal(state.grants[0].renewedAt, renewedAt);
  assert.equal(state.grants[0].expiresAt, before);
  assert.equal(await lease.readManagerLeaseOperation(txFor(state), { agentId: "manager-1", operationId: "renew-write-fail001" }), null);
  state.failWrite = false;

  const released = await apply(state, { agentId: "manager-1", action: "release", operationId: "release-operation01", grantHash: hash });
  assert.equal(released.expiresAt, null);
  const releasedAgain = await apply(state, { agentId: "manager-1", action: "release", operationId: "release-operation02", grantHash: hash });
  assert.equal(releasedAgain.expiresAt, null);
  await assert.rejects(
    () => apply(state, { agentId: "manager-1", action: "handoff", operationId: "handoff-after-rel01", grantHash: hash }),
    (error) => error.status === 409,
  );

  const holder = world();
  holder.grants.push({
    agentId: "manager-1", session: "ht-product-lead", tokenHash: hash, ttlMinutes: 30,
    expiresAt: new Date(Date.now() + 60_000), renewedAt: null, replacedAt: null, releasedAt: null, endedReason: null,
  });
  await lease.requireCurrentManagerGrant(txFor(holder), { agentId: "manager-1", grant: token });
  await assert.rejects(
    () => lease.requireCurrentManagerGrant(txFor(holder), { agentId: "manager-1", grant: null }),
    (error) => error instanceof FeatureFlagApprovalError && /no grant sent/.test(error.message),
  );
  holder.grants[0].replacedAt = new Date();
  await assert.rejects(
    () => lease.requireCurrentManagerGrant(txFor(holder), { agentId: "manager-1", grant: token }),
    (error) => error instanceof FeatureFlagApprovalError && /was replaced/.test(error.message),
  );

  process.stdout.write("lease replay proof passed\n");
});
