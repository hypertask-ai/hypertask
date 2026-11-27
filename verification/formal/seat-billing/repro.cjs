const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
process.env.STRIPE_SECRET_KEY ??= "sk_test_unused";

const load = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { syncSeatBillingOnJoin, reconcileSeatBillingForTeam } = load(path.join(root, "src/lib/syncSeatBilling.ts"));
const { createMemorySeatBillingWrites } = load(path.join(root, "src/lib/seatBillingLock.ts"));
const passthrough = async (_teamId, run) => run(() => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let seats = 1;
let billed = 1;
const landed = new Map();
const writes = createMemorySeatBillingWrites();

const adapter = {
  writes,
  findTeam: async () => ({
    totalSeats: seats, activeSubscriptionPlanId: "sub_1", activeSubscriptionPlanItemId: "si_1",
    stripe_customer_id: "cus_1", compedUntil: null,
    subscriptionPlan: [{ id: "plan_1", teamId: "team_1", subscriptionId: "sub_1", subscriptionItemId: "si_1", subscriptionStatus: "active", priceId: "price_1", subscriptionObject: null }],
  }),
  resolveQuantity: async () => seats,
  retrieveSubscriptionItem: async () => ({ id: "si_1", quantity: billed, priceId: "price_1", subscriptionId: "sub_1" }),
  updateSubscriptionItem: async (_itemId, update, options) => {
    if (landed.has(options.idempotencyKey)) return landed.get(options.idempotencyKey);
    const applied = sleep(60).then(() => { billed = update.quantity; });
    landed.set(options.idempotencyKey, applied);
    if (landed.size === 1) {
      await sleep(20);
      throw new Error("Stripe request timed out after 15000ms");
    }
    await applied;
  },
  reportFailure: async () => {},
};

(async () => {
  seats = 2;
  const join = await syncSeatBillingOnJoin("team_1", adapter, passthrough);
  seats = 1;
  const reconcile = await reconcileSeatBillingForTeam("team_1", adapter, passthrough);
  await Promise.all(landed.values());
  const pending = await writes.load("team_1");
  console.log(JSON.stringify({ join, reconcile, seats, billed, pending }, null, 2));
  process.exitCode = join === "Error" && reconcile === "RECONCILED" && billed === seats && pending === null && landed.size === 2 ? 0 : 1;
})();
