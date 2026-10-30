const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

const INTERNAL_TEAM_ID = "08f79efd-770e-4e32-9728-65e6d29ec893";
const PRO_PRICE = "price_1QjJeDIhmcH60VcciHzZ3mTJ";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/htpr-7852-entry-${++entryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

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

function stubPrisma(teamRow) {
  stubModule("src/lib/prisma.ts", {
    default: {
      project: { findUnique: async () => ({ team: teamRow }) },
      team: { findUnique: async () => teamRow },
    },
  });
}

test("the internal team keeps Pro from its saved subscription", async () => {
  const team = internalTeam(savedPro);
  stubPrisma(team);
  const { storePlanIdForTeam, storePlanIdForProject } = loadTs("src/app/api/ai/_lib/planGate.ts");
  const { deriveCurrentBoardBilling } = loadTs("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(storePlanIdForTeam(team), "Pro");
  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Pro");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
  const billing = deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team });
  assert.equal(billing.storePlanId, "Pro");
  assert.equal(billing.billingInterval, "month");
});

test("the internal team keeps Pro from a comp", async () => {
  const future = new Date(Date.now() + 86_400_000);
  const team = internalTeam({ compedUntil: future, compedPlan: "Pro" });
  stubPrisma(team);
  const { storePlanIdForTeam } = loadTs("src/app/api/ai/_lib/planGate.ts");

  assert.equal(storePlanIdForTeam(team), "Pro");
});

test("the internal team id alone no longer grants Pro", async () => {
  const team = internalTeam();
  stubPrisma(team);
  const { storePlanIdForTeam, storePlanIdForProject } = loadTs("src/app/api/ai/_lib/planGate.ts");
  const { deriveCurrentBoardBilling } = loadTs("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(storePlanIdForTeam(team), "Free");
  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Free");
  assert.equal(
    deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }).storePlanId,
    "Free",
  );
});

test("a canceled subscription on the internal team grants nothing", async () => {
  const team = internalTeam({
    activeSubscriptionPlanId: "sub_internal_pro",
    subscriptionPlan: [
      { subscriptionId: "sub_internal_pro", subscriptionStatus: "canceled", priceId: PRO_PRICE },
    ],
  });
  stubPrisma(team);
  const { storePlanIdForTeam } = loadTs("src/app/api/ai/_lib/planGate.ts");

  assert.equal(storePlanIdForTeam(team), "Free");
});
