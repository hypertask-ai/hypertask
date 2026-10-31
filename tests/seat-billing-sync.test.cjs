const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.STRIPE_SECRET_KEY = "sk_test_unused";

const jiti = require("jiti")(path.join(root, "tests/seat-billing-sync-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const loadTs = (rel) => {
  const mod = jiti(path.join(root, rel));
  return mod.default ?? mod;
};

const prisma = loadTs("src/lib/prisma.ts");
const subscriptionModule = jiti(path.join(root, "src/lib/subscription.ts"));
const { syncSeatBillingOnJoin } = jiti(path.join(root, "src/lib/syncSeatBilling.ts"));
const passthrough = async (_teamId, run) => run(() => {});
const sync = (teamId) => syncSeatBillingOnJoin(teamId, undefined, passthrough);

let updates = [];
let teamRow = null;
let stripeQuantity = 0;
let updateThrows = false;

function stub({ team, quantity, throws = false }) {
  updates = [];
  teamRow = team;
  stripeQuantity = quantity;
  updateThrows = throws;

  prisma.team.findUnique = async () => teamRow;
  prisma.subscriptionPlan.findFirst = async () => ({
    ...teamRow.subscriptionPlan[0], id: "row_test", teamId: "team_1",
    subscriptionObject: null,
    team: { activeSubscriptionPlanId: "sub_test", stripe_customer_id: "cus_test" },
  });
  prisma.subscriptionPlan.updateMany = async () => ({ count: 1 });
  subscriptionModule.stripe.subscriptions.retrieve = async () => ({
    id: "sub_test", customer: "cus_test", status: teamRow.subscriptionPlan[0].subscriptionStatus,
    items: { data: [{ id: "si_test", quantity: stripeQuantity, price: { id: "price_test" } }] },
  });
  prisma.user.findUnique = async () => ({ email: "owner@example.com" });
  subscriptionModule.stripe.subscriptionItems.retrieve = async (id) => ({
    id,
    quantity: stripeQuantity,
    price: { id: "price_test" },
    subscription: "sub_test",
  });
  subscriptionModule.stripe.subscriptionItems.update = async (id, args) => {
    updates.push({ id, ...args });
    if (updateThrows) throw new Error("card_declined");
    stripeQuantity = args.quantity;
    return { id, ...args };
  };
}

const paidTeam = ({ members = 5, pendingInvites = [], ...overrides } = {}) => ({
  totalSeats: members,
  activeSubscriptionPlanId: "sub_test",
  activeSubscriptionPlanItemId: "si_test",
  compedUntil: null,
  subscriptionPlan: [
    {
      subscriptionId: "sub_test",
      subscriptionItemId: "si_test",
      subscriptionStatus: "active",
      priceId: "price_test",
    },
  ],
  googleAccount: { userId: 1 },
  members: Array.from({ length: Math.max(members - 1, 0) }, (_, i) => ({
    userId: i + 2,
    user: { email: `member${i}@example.com` },
  })),
  projects: [
    { invites: pendingInvites.map((email) => ({ emails: [email] })) },
  ],
  ...overrides,
});

test("a comped team is never charged and its quantity never moves", async () => {
  stub({
    team: paidTeam({ members: 12, compedUntil: new Date(Date.now() + 86_400_000) }),
    quantity: 5,
  });
  assert.equal(await sync("team_1"), "SKIPPED");
  assert.deepEqual(updates, []);
});

test("an already-paid seat costs nothing", async () => {
  stub({ team: paidTeam({ members: 6 }), quantity: 10 });
  assert.equal(await sync("team_1"), "OK");
  assert.deepEqual(updates, []);
});

test("a new seat is charged exactly once, at the subscription's real price", async () => {
  stub({ team: paidTeam({ members: 6 }), quantity: 5 });
  assert.equal(await sync("team_1"), "SEATED");
  assert.equal(updates.length, 1, "one Stripe mutation, never a second charge");
  assert.deepEqual(updates[0], {
    id: "si_test",
    quantity: 6,
    proration_behavior: "always_invoice",
  });
});

test("seats reserved for pending invitees are billed for too", async () => {
  stub({
    team: paidTeam({
      members: 6,
      pendingInvites: ["pending1@example.com", "pending2@example.com"],
    }),
    quantity: 5,
  });
  assert.equal(await sync("team_1"), "SEATED");
  assert.equal(updates[0].quantity, 8, "6 accepted + 2 reserved, not 6");
});

test("an invite to someone already on the team does not buy a second seat", async () => {
  stub({
    team: paidTeam({ members: 6, pendingInvites: ["member0@example.com"] }),
    quantity: 5,
  });
  assert.equal(await sync("team_1"), "SEATED");
  assert.equal(updates[0].quantity, 6);
});

test("a trialing team gets the seat without an invoice", async () => {
  stub({
    team: paidTeam({
      members: 6,
      subscriptionPlan: [
        {
          subscriptionId: "sub_test",
          subscriptionItemId: "si_test",
          subscriptionStatus: "trialing",
          priceId: "price_test",
        },
      ],
    }),
    quantity: 5,
  });
  assert.equal(await sync("team_1"), "SEATED");
  assert.equal(updates[0].proration_behavior, "none");
});

test("a team with no subscription is skipped", async () => {
  stub({
    team: paidTeam({
      members: 6,
      activeSubscriptionPlanItemId: null,
      subscriptionPlan: [],
    }),
    quantity: 0,
  });
  assert.equal(await sync("team_1"), "SKIPPED");
  assert.deepEqual(updates, []);
});

test("a Stripe failure is reported, never thrown into the join flow", async () => {
  stub({ team: paidTeam({ members: 6 }), quantity: 5, throws: true });
  assert.equal(await sync("team_1"), "Error");
});

test("no team id is a no-op", async () => {
  stub({ team: paidTeam({ members: 6 }), quantity: 5 });
  assert.equal(await sync(undefined), "SKIPPED");
  assert.deepEqual(updates, []);
});
