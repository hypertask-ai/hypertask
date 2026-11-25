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
