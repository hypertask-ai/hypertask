const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const { default: flag } = loadModule("src/lib/flags/definitions/htpr-9529-comped-billing-rows.ts");
const { legacyBillingDisplay, settingsBillingDisplay } = loadModule("src/lib/settingsBillingDisplay.ts");

const compedTeam = {
  id: "team_comped",
  compedPlan: "Pro",
  compedUntil: new Date("2099-01-01T12:00:00.000Z"),
  subscriptionPlan: [],
};
const compedBilling = { teamId: "team_comped", stripePriceId: null, storePlanId: "Pro", billingInterval: null, byokProviderFlags: [] };

test("the switch is a reversible display bugfix that ships to everyone", () => {
  assert.equal(flag.key, "htpr-9529-comped-billing-rows");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("the switch on reports the comp and off keeps today's Free Plan rows", () => {
  assert.equal(settingsBillingDisplay(compedTeam, compedBilling).billingCycle, "Comped");
  assert.equal(legacyBillingDisplay(compedBilling).billingCycle, "Free Plan");
  assert.equal(legacyBillingDisplay(compedBilling).comped, false);
});

test("a comped team keeps its comp before the billing snapshot loads", () => {
  const comped = settingsBillingDisplay(compedTeam, null);
  assert.equal(comped.plan, "Pro");
  assert.equal(comped.comped, true);
  assert.equal(comped.billingCycle, "Comped");

  const paying = settingsBillingDisplay({
    id: "team_paid",
    activeSubscriptionPlanId: "sub_paid",
    subscriptionPlan: [{ subscriptionId: "sub_paid", subscriptionStatus: "active", priceId: "price_1QjJeDIhmcH60VcciHzZ3mTJ" }],
  }, null);
  assert.equal(paying.plan, "Pro");
  assert.equal(paying.comped, false);
  assert.equal(paying.billingCycle, "month");
});
