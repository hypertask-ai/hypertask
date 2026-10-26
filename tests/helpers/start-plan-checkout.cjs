const assert = require("node:assert/strict");
const path = require("node:path");
const { load, root } = require("./agent-connection.cjs");

Object.assign(process.env, {
  NEXT_PUBLIC_BASEURL: "https://app.hypertask.ai",
  NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID: "price_legacy_trial",
  NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_PRO: "price_pro_month",
  NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_PRO: "price_pro_year",
  NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK: "price_byok_month",
  NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_BYOK: "price_byok_year",
  STRIPE_PRO_PRODUCT_ID: "prod_pro",
});
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const plans = jiti(path.join(root, "src/lib/subscriptionPlans.ts"));
const billing = jiti(path.join(root, "src/lib/deriveCurrentBoardBilling.ts"));
const flag = load("src/lib/flags/definitions/htpr-7551-start-plan-checkout.ts");
function harness() {
  const h = {
    enabled: true, seats: 3, record: null, calls: [], expired: [], sessions: new Map(),
    locks: 0, stripeCalls: [], flagReads: [], attemptReads: 0, reservationWrites: [],
    payloads: new Map(), subscriptions: [], hidden: false, writes: 0, lost: false,
    team: {
      id: "team-owned", title: "Owned", totalSeats: 1,
      googleAccountId: "account-owned", googleAccount: { userId: 6 },
      stripe_customer_id: "cus_owned", activeSubscriptionPlanId: null,
      subscriptionPlan: [], team_activity: { hasCompletedTrial: false },
    },
    price: {
      id: "price_pro_month", active: true, type: "recurring", currency: "usd", unit_amount: 2000,
      product: "prod_pro", billing_scheme: "per_unit", transform_quantity: null,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    },
  };
  const stripe = {
    prices: { retrieve: async (id) => { h.stripeCalls.push("prices.retrieve"); assert.equal(id, "price_pro_month"); if (h.priceFailure) throw new Error("price lookup unavailable"); return h.price; } },
    subscriptions: { list: async (request) => {
      h.stripeCalls.push("subscriptions.list");
      assert.equal(request.customer, h.team.stripe_customer_id);
      h.subscriptionRequests ??= [];
      h.subscriptionRequests.push(request);
      if (h.subscriptionPages) return h.subscriptionPages[request.starting_after ? 1 : 0];
      return { data: h.subscriptions, has_more: false };
    } },
    checkout: { sessions: {
      list: async (request) => {
        h.stripeCalls.push("sessions.list");
        h.sessionRequests ??= []; h.sessionRequests.push(request);
        if (h.sessionPages) return h.sessionPages[request.starting_after ? 1 : 0];
        return { data: h.hidden ? [] : [...h.sessions.values()].filter((session) => session.customer === request.customer), has_more: false };
      },
      retrieve: async (id) => { h.stripeCalls.push("sessions.retrieve"); return h.sessions.get(id); },
      expire: async (id) => { h.stripeCalls.push("sessions.expire"); h.expired.push(id); h.sessions.set(id, { ...h.sessions.get(id), status: "expired" }); },
      create: async (payload, options) => {
        h.stripeCalls.push("sessions.create");
        const key = options.idempotencyKey;
        h.calls.push({ key, payload: structuredClone(payload) });
        if (h.payloads.has(key)) assert.deepEqual(payload, h.payloads.get(key), "same key must keep the entire Stripe wire payload");
        else h.payloads.set(key, structuredClone(payload));
        if (h.beforeCreate) await h.beforeCreate();
        if (h.rejectOnce) { const error = h.rejectOnce; h.rejectOnce = null; throw error; }
        let session = [...h.sessions.values()].find((entry) => entry.key === key);
        if (!session) {
          const id = `cs_${h.sessions.size + 1}`;
          session = { id, key, url: `https://checkout.stripe.test/${id}`, status: "open",
            customer: payload.customer, metadata: payload.metadata,
            success_url: payload.success_url, cancel_url: payload.cancel_url, subscription: null };
          h.sessions.set(id, session);
        }
        if (h.timeoutAfterCreate) { h.timeoutAfterCreate = false; throw new Error("lost response"); }
        return session;
      },
    } },
  };
  function Stripe() { return stripe; }
  const stripeModule = load("src/lib/stripe.ts", { stripe: Stripe });
  const reservations = load("src/utils/controllers/stripe/checkoutReservation.ts", { "@/lib/redis": {} });
  reservations.readTeamCheckoutAttempt = async () => { h.attemptReads++; return h.record && structuredClone(h.record); };
  let tail = Promise.resolve();
  reservations.withTeamCheckoutReservation = async (_teamId, run) => {
    h.locks++;
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const assertHeld = () => { if (h.lost) throw new reservations.CheckoutReservationLockLostError(); };
    try {
      if (h.onLock) h.onLock();
      return await run({
        assertHeld,
        read: async () => { assertHeld(); return h.record && structuredClone(h.record); },
        write: async (attempt) => { assertHeld(); h.record = structuredClone(attempt); h.reservationWrites.push(structuredClone(attempt)); },
        clear: async () => { assertHeld(); h.record = null; },
      });
    } finally { release(); }
  };
  const prisma = {
    team: { findUnique: async () => h.team, update: async () => { h.writes++; throw new Error("no billing writes"); } },
    project: { findFirst: async (request) => request.where.id === 7 && request.where.teamId === h.team.id ? { id: 7 } : null },
  };
  const controller = load("src/utils/controllers/stripe/createAuthorizedCheckoutSession.ts", {
    "@/lib/prisma": prisma,
    "@/lib/deriveCurrentBoardBilling": billing,
    "@/lib/teamComp": jiti(path.join(root, "src/lib/teamComp.ts")),
    "@/lib/internalCompTeams": jiti(path.join(root, "src/lib/internalCompTeams.ts")),
    "@/lib/flags/definitions/htpr-7980-stripe-portal-billing": load("src/lib/flags/definitions/htpr-7980-stripe-portal-billing.ts"),
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      if (key === "htpr-7938-fourteen-day-trial") {
        h.trialFlagReads ??= []; h.trialFlagReads.push(id);
        if (h.trialFlagFailure) throw new Error("trial flag lookup unavailable");
        return Boolean(h.fourteenDayTrial);
      }
      assert.equal(key, flag.HTPR_7551_START_PLAN_CHECKOUT_FLAG); h.flagReads.push(id);
      if (h.flagFailure) throw new Error("flag lookup unavailable"); return h.enabled;
    } },
    "@/lib/flags/keys": flag,
    "@/lib/flags/definitions/htpr-7938-fourteen-day-trial": { HTPR_7938_FOURTEEN_DAY_TRIAL_FLAG: "htpr-7938-fourteen-day-trial" },
    "@/lib/resolveSeatQuantity": { resolveSeatQuantity: async () => h.seats },
    "@/lib/stripe": stripeModule,
    "@/lib/subscriptionPlans": plans,
    "@/utils/controllers/stripe/checkoutReservation": reservations,
  });
  h.checkout = (body = { intent: "signup-straight-to-board", teamId: "team-owned", boardUrl: "https://app.hypertask.ai/project?id=7&view=default#board" }, userId = 6) => controller.createAuthorizedCheckoutSession(userId, body);
  h.reservations = reservations;
  return h;
}

module.exports = { harness, plans };
