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
let saved;
let live;
let team;
let writes;
let stripeWrites;
let failSave;
const prisma = {
  team: { findUnique: async () => team },
  subscriptionPlan: {
    findFirst: async () => ({ ...team.subscriptionPlan[0], subscriptionObject: saved, team: { stripe_customer_id: "cus", activeSubscriptionPlanId: "sub" } }),
    updateMany: async ({ where, data }) => {
      if (failSave) throw new Error("database unavailable");
      assert.equal(where.subscriptionId, "sub");
      assert.equal(where.teamId, "team");
      writes++;
      saved = data.subscriptionObject;
      return { count: 1 };
    },
  },
};
stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/subscription.ts", { stripe: {
  subscriptions: { retrieve: async (id) => { assert.equal(id, "sub"); return live; } },
  subscriptionItems: {
    retrieve: async () => ({ ...live.items.data[0], subscription: "sub" }),
    update: async (_id, update) => { stripeWrites++; live.items.data[0].quantity = update.quantity; return live.items.data[0]; },
  },
} });
stub("src/lib/resolveSeatQuantity.ts", { resolveSeatQuantity: async () => team.totalSeats });
stub("src/lib/errors/reportError.ts", { reportError: async () => {} });
const passthrough = async (_id, run) => run(() => {});
stub("src/lib/seatBillingLock.ts", { withTeamSeatBillingLock: passthrough });
const billing = load(path.join(root, "src/lib/syncSeatBilling.ts"));
const refresh = (...args) => load(path.join(root, "src/lib/stripeSubscriptionSnapshot.ts")).refreshStripeSubscriptionSnapshotWithLockHeld(...args);

test.beforeEach(() => {
  saved = { id: "sub", items: { data: [{ id: "si", quantity: 1, price: { id: "price_yearly" } }] } };
  live = { id: "sub", customer: "cus", status: "active", items: { data: [{ id: "si", quantity: 2, price: { id: "price_yearly" } }] } };
  team = { totalSeats: 2, activeSubscriptionPlanId: "sub", activeSubscriptionPlanItemId: "si", compedUntil: null,
    subscriptionPlan: [{ id: "row", teamId: "team", subscriptionId: "sub", subscriptionItemId: "si", subscriptionStatus: "active", priceId: "price_yearly", subscriptionObject: saved }] };
  writes = 0; stripeWrites = 0; failSave = false;
});

test("a yearly snapshot showing one seat is refreshed to Stripe's two even when billing needs no change", async () => {
  assert.equal(await billing.syncSeatBillingOnJoin("team", undefined, passthrough), "OK");
  assert.equal(saved.items.data[0].quantity, 2);
  assert.equal(stripeWrites, 0);
});

test("a successful seat increase saves the updated Stripe quantity", async () => {
  team.totalSeats = 3;
  assert.equal(await billing.syncSeatBillingOnJoin("team", undefined, passthrough), "SEATED");
  assert.equal(saved.items.data[0].quantity, 3);
  assert.equal(stripeWrites, 1);
});

test("snapshot persistence failure is reported instead of silently returning success", async () => {
  failSave = true;
  assert.equal(await billing.syncSeatBillingOnJoin("team", undefined, passthrough), "Error");
  assert.equal(saved.items.data[0].quantity, 1);
});

test("one-off resync previews without writes, applies on request and preserves pending cancellation", async () => {
  saved.hypertaskPendingPreviousSubscriptionCancellationId = "sub_old";
  const preview = await refresh("team", "sub", () => {}, false);
  assert.equal(preview.subscriptionObject.items.data[0].quantity, 2);
  assert.equal(saved.items.data[0].quantity, 1);
  assert.equal(writes, 0);
  const result = await refresh("team", "sub", () => {}, true);
  assert.equal(result.subscriptionObject.items.data[0].quantity, 2);
  assert.equal(saved.items.data[0].quantity, 2);
  assert.equal(saved.hypertaskPendingPreviousSubscriptionCancellationId, "sub_old");
  assert.equal(stripeWrites, 0);
});

for (const mismatch of ["customer", "id", "status", "item"]) {
  test(`resync refuses mismatched Stripe ${mismatch}`, async () => {
    if (mismatch === "item") live.items.data[0].id = "foreign_item";
    else live[mismatch] = mismatch === "status" ? "canceled" : "foreign";
    await assert.rejects(refresh("team", "sub", () => {}, true));
    assert.equal(saved.items.data[0].quantity, 1);
    assert.equal(writes, 0);
  });
}

test("bulk resync refuses seat decreases while normal reconciliation can refresh them", async () => {
  saved.items.data[0].quantity = 3;
  await assert.rejects(refresh("team", "sub", () => {}, true, true), /would lower a saved seat count/);
  assert.equal(saved.items.data[0].quantity, 3);
  const result = await refresh("team", "sub", () => {}, true);
  assert.equal(result.quantity, 2);
  assert.equal(saved.items.data[0].quantity, 2);
});

test("lost billing lock prevents snapshot persistence", async () => {
  let checks = 0;
  await assert.rejects(refresh("team", "sub", () => {
    if (++checks === 2) throw new Error("lock lost");
  }, true), /lock lost/);
  assert.equal(saved.items.data[0].quantity, 1);
  assert.equal(writes, 0);
});
