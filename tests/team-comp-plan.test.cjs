// HTPR-6653: a comp grants the plan it names. A BYOK comp must behave exactly
// like a paying BYOK team: shared allowance key, never the managed Pro key.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

const stubbedModulePaths = [
  "src/app/api/ai/_lib/byokKeys.ts",
  "src/app/api/ai/_lib/planGate.ts",
  "src/lib/crypto/byokCipher.ts",
  "src/lib/prisma.ts",
  "src/utils/controllers/projects/getAllIncludes.ts",
];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/team-comp-plan-entry-${++entryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 86_400_000);

// Canonical monthly Pro seat price (planFromStripePriceId.ts).
const PRO_PRICE = "price_1QjJeDIhmcH60VcciHzZ3mTJ";

function team(overrides = {}) {
  return {
    id: "team_comp",
    activeSubscriptionPlanId: null,
    compedUntil: null,
    compedPlan: null,
    subscriptionPlan: [],
    ...overrides,
  };
}

const payingPro = {
  activeSubscriptionPlanId: "sub_pro",
  subscriptionPlan: [
    { subscriptionId: "sub_pro", subscriptionStatus: "active", priceId: PRO_PRICE },
  ],
};

function stubPrisma(teamRow, byokLookups = []) {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/prisma.ts", {
    default: {
      project: { findFirst: async () => ({ teamId: teamRow.id }) },
      team: { findUnique: async () => teamRow },
      teamByokApiKey: {
        findUnique: async (args) => {
          const provider = args.where.teamId_provider.provider;
          byokLookups.push(provider);
          return provider === "managed_gateway"
            ? { enabled: true, ciphertext: "vck_managed_pro_key" }
            : null;
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });
}

test("plan resolution: comp null, Pro, BYOK, expired, and alongside a paid plan", () => {
  stubPrisma(team());
  const { storePlanIdForTeam } = loadTs("src/app/api/ai/_lib/planGate.ts");

  assert.equal(storePlanIdForTeam(team()), "Free", "no comp, no subscription");
  // Comps made before HTPR-6653 have no plan and must stay Pro.
  assert.equal(storePlanIdForTeam(team({ compedUntil: future() })), "Pro");
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: future(), compedPlan: "Pro" })),
    "Pro",
  );
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: future(), compedPlan: "BYOK" })),
    "BYOK",
  );
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: past(), compedPlan: "Pro" })),
    "Free",
    "an expired Pro comp grants nothing",
  );
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: past(), compedPlan: "BYOK" })),
    "Free",
    "an expired comp grants nothing",
  );
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: past(), compedPlan: "Pro", ...payingPro })),
    "Pro",
    "an expired comp falls back to the paid plan",
  );
  // A BYOK comp must never downgrade a team that pays for Pro.
  assert.equal(
    storePlanIdForTeam(team({ compedUntil: future(), compedPlan: "BYOK", ...payingPro })),
    "Pro",
  );
});

test("client billing snapshot shows the comped plan", () => {
  const { deriveCurrentBoardBilling } = loadTs("src/lib/deriveCurrentBoardBilling.ts");
  const billing = (teamRow) =>
    deriveCurrentBoardBilling({ id: 1, teamId: teamRow.id, team: teamRow });

  const byok = billing(team({ compedUntil: future(), compedPlan: "BYOK" }));
  assert.equal(byok.storePlanId, "BYOK");
  assert.equal(byok.billingInterval, null);

  const byokOverPro = billing(
    team({ compedUntil: future(), compedPlan: "BYOK", ...payingPro }),
  );
  assert.equal(byokOverPro.storePlanId, "Pro");
  assert.equal(byokOverPro.billingInterval, "month", "the paid plan decides");

  assert.equal(
    billing(team({ compedUntil: future() })).storePlanId,
    "Pro",
    "legacy comp without a plan stays Pro",
  );
});

test("a BYOK comp uses the shared allowance key and never reads the managed Pro key", async () => {
  const sharedKey = "vck_shared_allowance";
  process.env.AI_GATEWAY_API_KEY = sharedKey;
  const lookups = [];
  stubPrisma(team({ compedUntil: future(), compedPlan: "BYOK" }), lookups);
  const { getTeamGatewayFunding } = loadTs("src/app/api/ai/_lib/byokKeys.ts");

  assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: "team_comp" }), {
    apiKey: sharedKey,
    source: "shared",
  });
  assert.equal(lookups.includes("managed_gateway"), false);
});

test("a Pro comp still uses the managed team key", async () => {
  process.env.AI_GATEWAY_API_KEY = "vck_shared_allowance";
  stubPrisma(team({ compedUntil: future(), compedPlan: "Pro" }));
  const { getTeamGatewayFunding } = loadTs("src/app/api/ai/_lib/byokKeys.ts");

  assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: "team_comp" }), {
    apiKey: "vck_managed_pro_key",
    source: "managed",
  });
});

test("a BYOK comp cannot use premium models on the shared key", async () => {
  const sharedKey = "vck_shared_allowance";
  process.env.AI_GATEWAY_API_KEY = sharedKey;
  stubPrisma(team({ compedUntil: future(), compedPlan: "BYOK" }));
  const { assertModelAllowedForPlan } = loadTs("src/app/api/ai/_lib/planGate.ts");

  await assert.rejects(
    assertModelAllowedForPlan(null, { modelKey: "gpt-6-luna" }, "team_comp", sharedKey),
    /needs your own AI key/,
  );
});
