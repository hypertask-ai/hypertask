const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const INTERNAL_TEAM_ID = "08f79efd-770e-4e32-9728-65e6d29ec893";
const PRO_PRICE = "price_1QjJeDIhmcH60VcciHzZ3mTJ";

function internalTeam(overrides = {}) {
  return {
    id: INTERNAL_TEAM_ID,
    activeSubscriptionPlanId: null,
    compedUntil: null,
    compedPlan: null,
    subscriptionPlan: [],
    ...overrides,
  };
}

const savedPro = {
  activeSubscriptionPlanId: "sub_internal_pro",
  subscriptionPlan: [
    { subscriptionId: "sub_internal_pro", subscriptionStatus: "active", priceId: PRO_PRICE },
  ],
};

const FLAG = "htpr-7852-internal-team-saved-plan";
const OWNER = 6;

function flagStub(enabled, seen = []) {
  return {
    FEATURE_FLAG_OWNER_USER_ID: OWNER,
    isFeatureEnabled: async (key, userId) => {
      seen.push([key, userId]);
      return key === FLAG && enabled;
    },
  };
}

function loadPlanGate(teamRow, enabled = true, seen = []) {
  return loadModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/flags": flagStub(enabled, seen),
    "@/lib/prisma": {
      default: {
        project: { findUnique: async () => ({ team: teamRow }) },
        team: { findUnique: async () => teamRow },
      },
    },
  });
}

const FUTURE = () => new Date(Date.now() + 86_400_000);
const canceledPro = {
  activeSubscriptionPlanId: "sub_internal_pro",
  subscriptionPlan: [
    { subscriptionId: "sub_internal_pro", subscriptionStatus: "canceled", priceId: PRO_PRICE },
  ],
};

function loadQuota(teams, enabled, seen = []) {
  return loadModule("src/utils/controllers/projects/boardQuota.ts", {
    "@/lib/prisma": { default: { team: { findMany: async () => teams } } },
    "@/lib/flags": {
      FEATURE_FLAG_OWNER_USER_ID: OWNER,
      isFeatureEnabled: async (key, userId) => {
        seen.push([key, userId]);
        return key === FLAG && enabled;
      },
    },
  });
}

test("flag off: the internal team id still grants Pro in every plan resolution", async () => {
  const team = internalTeam();
  const { storePlanIdForTeam, storePlanIdForProject } = loadPlanGate(team, false);
  const { deriveCurrentBoardBilling, deriveTeamBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(storePlanIdForTeam(team), "Pro");
  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Pro");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
  assert.equal(deriveTeamBilling(team).storePlanId, "Pro");
  assert.equal(deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }).storePlanId, "Pro");
});

test("flag off: a canceled saved plan on the internal team is still forced to Pro", async () => {
  const team = internalTeam(canceledPro);
  const { storePlanIdForProject } = loadPlanGate(team, false);

  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
});

test("flag off: the internal team still counts as paid for board admission", async () => {
  const { hasPaidPlan } = loadQuota([{ id: INTERNAL_TEAM_ID, compedUntil: null, subscriptionPlan: [] }], false);

  assert.equal(await hasPaidPlan(1), true);
});

test("flag on: the internal team keeps Pro from its saved subscription", async () => {
  const team = internalTeam(savedPro);
  const seen = [];
  const { storePlanIdForTeam, storePlanIdForProject } = loadPlanGate(team, true, seen);
  const { deriveCurrentBoardBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(storePlanIdForTeam(team, true), "Pro");
  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Pro");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
  assert.deepEqual(seen[0], [FLAG, OWNER]);
  const billing = deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }, true);
  assert.equal(billing.storePlanId, "Pro");
  assert.equal(billing.billingInterval, "month");
});

test("flag on: the internal team keeps Pro from a comp", async () => {
  const team = internalTeam({ compedUntil: FUTURE(), compedPlan: "Pro" });
  const { storePlanIdForTeam, storePlanIdForProject } = loadPlanGate(team, true);

  assert.equal(storePlanIdForTeam(team, true), "Pro");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
});

test("flag on: the internal team id alone no longer grants Pro", async () => {
  const team = internalTeam();
  const { storePlanIdForTeam, storePlanIdForProject } = loadPlanGate(team, true);
  const { deriveCurrentBoardBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(storePlanIdForTeam(team, true), "Free");
  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Free");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Free");
  assert.equal(
    deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }, true).storePlanId,
    "Free",
  );
});

test("flag on: a canceled subscription on the internal team grants nothing", async () => {
  const team = internalTeam(canceledPro);
  const { storePlanIdForTeam } = loadPlanGate(team, true);

  assert.equal(storePlanIdForTeam(team, true), "Free");
});

test("flag on: board admission follows the saved plan, comp and subscription still count", async () => {
  const internal = { id: INTERNAL_TEAM_ID, compedUntil: null, subscriptionPlan: [] };
  const seen = [];

  assert.equal(await loadQuota([internal], true, seen).hasPaidPlan(1), false);
  assert.ok(seen.some(([key, userId]) => key === FLAG && userId === OWNER));
  assert.equal(await loadQuota([{ ...internal, compedUntil: FUTURE() }], true).hasPaidPlan(1), true);
  assert.equal(
    await loadQuota([{ ...internal, subscriptionPlan: [{ subscriptionStatus: "active" }] }], true).hasPaidPlan(1),
    true,
  );
});

test("other teams are unaffected by the flag in either state", async () => {
  const other = { ...internalTeam(), id: "other-team" };

  for (const enabled of [false, true]) {
    const { storePlanIdForTeam, storePlanIdForProject } = loadPlanGate(other, enabled);
    assert.equal(storePlanIdForTeam(other, enabled), "Free");
    assert.equal(await storePlanIdForProject(null, "other-team"), "Free");
    assert.equal(
      await loadQuota([{ id: "other-team", compedUntil: null, subscriptionPlan: [] }], enabled).hasPaidPlan(1),
      false,
    );
  }
});

test("a flag read that fails keeps the forced Pro", async () => {
  const team = internalTeam();
  const { storePlanIdForProject } = loadModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("flags unavailable"); } },
    "@/lib/prisma": { default: { team: { findUnique: async () => team } } },
  });

  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Pro");
});

test("the access-risk flag defaults to Owner + QA", () => {
  const flag = loadModule("src/lib/flags/definitions/htpr-7852-internal-team-saved-plan.ts");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.highRisk, "access");
});
