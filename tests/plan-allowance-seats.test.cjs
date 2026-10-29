const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false,
});
function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
let seats;
let teamOverride;
let highWater;
let plan;
stub("src/lib/prisma.ts", { default: {
  team: { findUnique: async ({ select }) => {
    if (select.members) assert.equal(select.members.where.status, "Accepted");
    return ({
    id: "team", googleAccount: { userId: 1 }, members: [{ userId: 1 }, { userId: 2 }, { userId: 2 }, { userId: 3 }],
    activeSubscriptionPlanId: "sub", activeSubscriptionPlanItemId: "item",
    subscriptionPlan: [{ subscriptionId: "sub", subscriptionStatus: "active", subscriptionItemId: "item", subscriptionObject: {
      items: { data: [{ id: "other", quantity: 99 }, { id: "item", quantity: seats, price: { id: "price_1QjJf8IhmcH60VccNUrF7YJf" } }] },
    } }], ...teamOverride,
  }); } },
  user: { findUnique: async () => ({ uid: "owner" }) },
} });
stub("src/lib/flags.ts", { isFeatureEnabled: async () => true });
stub("src/lib/redis.ts", { getRedis: async () => ({
  eval: async (_script, _count, key, quantity) => {
    const next = Math.max(highWater.get(key) ?? 0, Number(quantity)); highWater.set(key, next); return next;
  },
  get: async (key) => highWater.get(key) ?? null,
}) });
stub("src/app/api/ai/_lib/planGate.ts", { storePlanIdForProject: async () => plan });
const policy = load(path.join(root, "src/app/api/ai/_lib/planAllowancePolicy.ts"));
test.beforeEach(() => { seats = 1; teamOverride = {}; highWater = new Map(); plan = "Pro"; });
test("flat $100 deal with fourteen accepted users gets fourteen AI seats, not Stripe quantity one", async () => {
  teamOverride = {
    members: Array.from({ length: 14 }, (_, userId) => ({ userId: userId + 1 })),
    googleAccount: { userId: 1 },
    subscriptionPlan: [{ subscriptionId: "sub", subscriptionStatus: "active", subscriptionItemId: "item", subscriptionObject: {
      items: { data: [{ id: "item", quantity: 1, price: { id: "price_1U7MmqIhmcH60VccoCD7iFea" } }] },
    } }],
  };
  assert.equal((await policy.resolveTeamAllowancePolicy("flat-fourteen", "managed")).monthlyUsd, 70);
});

test("a comped quantity-one Stripe line uses accepted members without double-counting the owner", async () => {
  seats = 1;
  teamOverride = { compedUntil: new Date(Date.now() + 100000) };
  assert.equal((await policy.resolveTeamAllowancePolicy("comp-stripe-one", "managed")).monthlyUsd, 15);
  seats = 5;
  assert.equal((await policy.resolveTeamAllowancePolicy("comp-stripe-five", "managed")).monthlyUsd, 25);
});

test("ordinary quantity-one subscriptions keep one paid AI seat despite extra members", async () => {
  seats = 1;
  assert.equal((await policy.resolveTeamAllowancePolicy("ordinary-one", "managed")).monthlyUsd, 5);
});

test("yearly paid quantity controls allowance rather than accepted-member count", async () => {
  seats = 2;
  assert.equal((await policy.resolveTeamAllowancePolicy("yearly-two", "managed")).monthlyUsd, 10);
  seats = 5;
  assert.equal((await policy.resolveTeamAllowancePolicy("yearly-five", "managed")).monthlyUsd, 25);
});

test("BYOK still counts distinct accepted users rather than Stripe quantity", async () => {
  seats = 10; plan = "BYOK";
  assert.equal((await policy.resolveTeamAllowancePolicy("byok-members", "shared")).monthlyUsd, 7.5);
});

test("flat deals never reduce a larger saved paid-seat quantity", async () => {
  teamOverride = { subscriptionPlan: [{ subscriptionId: "sub", subscriptionStatus: "active", subscriptionItemId: "item", subscriptionObject: {
    items: { data: [{ id: "item", quantity: 10, price: { id: "price_1U7MmqIhmcH60VccoCD7iFea" } }] },
  } }] };
  assert.equal((await policy.resolveTeamAllowancePolicy("flat-larger-paid", "managed")).monthlyUsd, 50);
});

test("member departures from a flat deal cannot lower this month's allowance", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    teamOverride = { compedUntil: new Date(now + 86400000) };
    assert.equal((await policy.resolveTeamAllowancePolicy("comp-departure", "managed")).monthlyUsd, 15);
    teamOverride.members = [];
    now += 5 * 60 * 1000 + 1;
    assert.equal((await policy.resolveTeamAllowancePolicy("comp-departure", "managed")).monthlyUsd, 15);
  } finally { Date.now = realNow; }
});
