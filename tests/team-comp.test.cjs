const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/team-comp-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { isTeamComped } = jiti(path.join(root, "src/lib/teamComp.ts"));
const { deriveCurrentBoardBilling } = jiti(
  path.join(root, "src/lib/deriveCurrentBoardBilling.ts"),
);

test("isTeamComped accepts future dates and rejects past or missing dates", () => {
  assert.equal(isTeamComped({ compedUntil: new Date(Date.now() + 60_000) }), true);
  assert.equal(isTeamComped({ compedUntil: new Date(Date.now() - 60_000).toISOString() }), false);
  assert.equal(isTeamComped({ compedUntil: null }), false);
});

test("deriveCurrentBoardBilling gives comped teams Pro with no billing interval", () => {
  const billing = deriveCurrentBoardBilling({
    id: 42,
    teamId: "partner-team",
    team: {
      id: "partner-team",
      compedUntil: new Date(Date.now() + 60_000).toISOString(),
      activeSubscriptionPlanId: "sub_partner",
      subscriptionPlan: [
        {
          subscriptionId: "sub_partner",
          subscriptionStatus: "Active",
          priceId: "price_partner_flat_fee",
        },
      ],
      byokApiKeys: [{ provider: "openai", enabled: true }],
    },
  });

  assert.equal(billing?.storePlanId, "Pro");
  assert.equal(billing?.billingInterval, null);
  assert.equal(billing?.stripePriceId, "price_partner_flat_fee");
  assert.deepEqual(billing?.byokProviderFlags, [
    { provider: "openai", enabled: true },
  ]);
});
