// HTPR-4863: a team whose card fails must not keep premium forever.
// Policy (owner-decided): past_due still entitles (Stripe is retrying),
// unpaid does not (Stripe gave up), alongside the existing dead statuses.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const prismaStub = require("./fixtures/prisma-team-stub.cjs");

const jiti = require("jiti")(path.join(root, "tests/team-comp-entry.cjs"), {
  interopDefault: true,
  alias: {
    "@/lib/prisma": path.join(root, "tests/fixtures/prisma-team-stub.cjs"),
    "@": path.join(root, "src"),
  },
});

const { storePlanIdForProject } = jiti(
  path.join(root, "src/app/api/ai/_lib/planGate.ts"),
);

const { deriveCurrentBoardBilling } = jiti(
  path.join(root, "src/lib/deriveCurrentBoardBilling.ts"),
);
const { subscriptionStatusGrantsAccess, pickEntitlingSubscriptionRow } = jiti(
  path.join(root, "src/lib/subscriptionAccess.ts"),
);

const PRO_MONTH = "price_1TMlqDIhmcH60VccRZGW1xK3";

function billingFor(subscriptionStatus, extra = {}) {
  return deriveCurrentBoardBilling({
    id: 1,
    teamId: "team-1",
    team: {
      id: "team-1",
      compedUntil: null,
      activeSubscriptionPlanId: "sub_1",
      subscriptionPlan: [
        { subscriptionId: "sub_1", subscriptionStatus, priceId: PRO_MONTH },
      ],
      ...extra,
    },
  });
}

test("a paying team keeps Pro", () => {
  assert.equal(billingFor("active")?.storePlanId, "Pro");
  assert.equal(billingFor("trialing")?.storePlanId, "Pro");
});

test("past_due keeps Pro while Stripe retries the card", () => {
  assert.equal(billingFor("past_due")?.storePlanId, "Pro");
});

test("unpaid drops the team off premium", () => {
  const billing = billingFor("unpaid");
  assert.equal(billing?.storePlanId, "Free");
  assert.equal(billing?.billingInterval, null);
});

test("already-dead statuses still drop the team off premium", () => {
  for (const status of ["Expired", "ended", "canceled", "incomplete_expired"]) {
    assert.equal(billingFor(status)?.storePlanId, "Free", status);
  }
});

test("a comped team survives a failed card", () => {
  const billing = deriveCurrentBoardBilling({
    id: 1,
    teamId: "team-1",
    team: {
      id: "team-1",
      compedUntil: new Date(Date.now() + 60_000).toISOString(),
      activeSubscriptionPlanId: "sub_1",
      subscriptionPlan: [
        { subscriptionId: "sub_1", subscriptionStatus: "unpaid", priceId: PRO_MONTH },
      ],
    },
  });
  assert.equal(billing?.storePlanId, "Pro");
});

test("a live second subscription beats a stale active pointer at a dead one", () => {
  const row = pickEntitlingSubscriptionRow(
    [
      { subscriptionId: "sub_dead", subscriptionStatus: "unpaid" },
      { subscriptionId: "sub_live", subscriptionStatus: "active" },
    ],
    "sub_dead",
  );
  assert.equal(row.subscriptionId, "sub_live");
});

test("subscriptionStatusGrantsAccess encodes the policy", () => {
  assert.equal(subscriptionStatusGrantsAccess("past_due"), true);
  assert.equal(subscriptionStatusGrantsAccess("unpaid"), false);
  assert.equal(subscriptionStatusGrantsAccess(null), false);
});

// The AI plan gate is the authorization path a failed-payment team would abuse,
// so assert it directly and not only the client-side billing snapshot.
async function gatePlanFor(subscriptionStatus) {
  prismaStub.setTeam({
    id: "team-1",
    compedUntil: null,
    activeSubscriptionPlanId: "sub_1",
    subscriptionPlan: [
      { subscriptionId: "sub_1", subscriptionStatus, priceId: PRO_MONTH },
    ],
  });
  return storePlanIdForProject(1, null);
}

test("the AI plan gate keeps past_due on Pro and drops unpaid to Free", async () => {
  assert.equal(await gatePlanFor("active"), "Pro");
  assert.equal(await gatePlanFor("past_due"), "Pro");
  assert.equal(await gatePlanFor("unpaid"), "Free");
  assert.equal(await gatePlanFor("canceled"), "Free");
});

test("legacy capitalised statuses still entitle, unknown ones fail closed", () => {
  assert.equal(subscriptionStatusGrantsAccess("Paid"), true);
  assert.equal(subscriptionStatusGrantsAccess("Active"), true);
  assert.equal(subscriptionStatusGrantsAccess("paused"), false);
  assert.equal(subscriptionStatusGrantsAccess("something_new"), false);
});
