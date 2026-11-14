const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const limits = load("src/lib/freePlanLimits.ts", {});
const plans = load("src/lib/subscriptionPlans.ts", {
  "@/lib/freePlanLimits": limits,
});

const generousOn = {
  planLimits: true,
  unlimitedTickets: true,
  unlimitedBoards: true,
  raisedFileLimit: true,
  storageCap: true,
};

test("generous Free copy stays truthful from entitlement flags", () => {
  assert.deepEqual(limits.freePlanLimitCopy(generousOn), [
    "Unlimited boards",
    "Unlimited tickets",
    "Up to 25 MB each on tickets and comments",
    "Keep everything; you just can't add more until you're under it or upgrade",
    "Up to 2 GB attachment storage per team",
  ]);
  assert.equal(limits.freePlanLimitCopy({ ...generousOn, storageCap: false }).some((line) => line.includes("2 GB")), false);
});

test("corrected positioning sells Pro on more AI and keeps dollars off", () => {
  const corrected = plans.subscriptionPlansFor(generousOn, true, true);
  const free = corrected.find((plan) => plan.id === "Free");
  const pro = corrected.find((plan) => plan.id === "Pro");
  assert.ok(free.perks.some((perk) => perk.titlePrefix === "AI" && perk.amount === "Included allowance"));
  assert.ok(free.perks.some((perk) => perk.title === "LLM billing" && perk.amount === "Included AI allowance"));
  assert.ok(free.perks.some((perk) => perk.title === "Boards" && perk.amount === "Unlimited boards"));
  assert.ok(free.perks.some((perk) => perk.title === "Storage"));
  assert.equal(pro.perks.find((perk) => perk.title === "LLM billing").amount, "Included AI; add your own key for more");
  assert.equal(JSON.stringify(pro).includes("$15"), false);
});

test("flag-off corrected path keeps legacy entitlement wording", () => {
  const legacy = { planLimits: false, unlimitedTickets: false };
  const off = plans.subscriptionPlansFor(legacy, false, false);
  const corrected = plans.subscriptionPlansFor(legacy, false, true);
  assert.deepEqual(off, plans.storeSubscriptionPlans);
  assert.equal(corrected.find((plan) => plan.id === "Free").perks.some((perk) => perk.amount === "Included allowance"), true);
  assert.equal(limits.freePlanLimitCopy(legacy).includes("Up to 2 boards"), false);
});
