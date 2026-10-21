const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { load, root } = require("./helpers/agent-connection.cjs");

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
const flag = load("src/lib/flags/definitions/htpr-7511-signup-straight-to-board.ts");
const boardUrl = "https://app.hypertask.ai/project?id=7&view=default#board";
const startBody = (extra = {}) => ({ intent: "signup-straight-to-board", teamId: "team-owned", boardUrl, ...extra });
const legacyBody = (extra = {}) => ({
  teamId: "team-owned", mode: "Trial", priceId: "price_legacy_trial",
  returnUrl: "https://app.hypertask.ai/trial-page-confirmation",
  cancelUrl: "https://app.hypertask.ai", ...extra,
});
const subscription = (status, extra = {}) => ({
  id: `sub_${status}`, status, trial_start: null, trial_end: null,
  items: { data: [{ price: { id: "price_pro_month" } }] }, ...extra,
});

function harness() {
  const h = {
    enabled: true, seats: 3, record: null, calls: [], expired: [], sessions: new Map(),
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
    customers: { retrieve: async () => ({ id: "cus_owned", email: h.customerEmail ?? null }) },
    prices: { retrieve: async (id) => { assert.equal(id, "price_pro_month"); if (h.priceFailure) throw new Error("price lookup unavailable"); return h.price; } },
    subscriptions: { list: async (request) => {
      assert.equal(request.customer, "cus_owned");
      h.subscriptionRequests ??= [];
      h.subscriptionRequests.push(request);
      if (h.subscriptionPages) return h.subscriptionPages[request.starting_after ? 1 : 0];
      return { data: h.subscriptions, has_more: false };
    } },
    checkout: { sessions: {
      list: async (request) => {
        h.sessionRequests ??= []; h.sessionRequests.push(request);
        if (h.sessionPages) return h.sessionPages[request.starting_after ? 1 : 0];
        return { data: h.hidden ? [] : [...h.sessions.values()], has_more: false };
      },
      retrieve: async (id) => h.sessions.get(id),
      expire: async (id) => { h.expired.push(id); h.sessions.get(id).status = "expired"; },
      create: async (payload, options) => {
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
  let tail = Promise.resolve();
  reservations.withTeamCheckoutReservation = async (_teamId, run) => {
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
        write: async (attempt) => { assertHeld(); h.record = structuredClone(attempt); },
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
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { assert.equal(key, flag.HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG); assert.equal(id, h.team.googleAccount.userId); return h.enabled; } },
    "@/lib/flags/definitions/htpr-7511-signup-straight-to-board": flag,
    "@/lib/resolveSeatQuantity": { resolveSeatQuantity: async () => h.seats },
    "@/lib/stripe": stripeModule,
    "@/lib/subscriptionPlans": plans,
    "@/utils/controllers/stripe/checkoutReservation": reservations,
  });
  h.checkout = (body = startBody(), userId = 6, principal = {}) => controller.createAuthorizedCheckoutSession(userId, body, principal);
  h.reservations = reservations;
  return h;
}

for (const enabled of [true, false]) {
  test(`legacy trial remains allowed with frozen ${enabled ? 7 : 14} days and its legacy price (flag ${enabled})`, async () => {
    const h = harness(); h.enabled = enabled;
    assert.equal((await h.checkout(legacyBody({ trialDays: 99, quantity: 99 }))).status, 200);
    const payload = h.calls[0].payload;
    assert.equal(payload.subscription_data.trial_period_days, enabled ? 7 : 14);
    assert.equal(payload.line_items[0].price, "price_legacy_trial");
    assert.equal(payload.line_items[0].quantity, 3);
    assert.deepEqual(payload.line_items[0].adjustable_quantity, { enabled: true, minimum: 3 });
    assert.equal(h.record.desired.trialDays, enabled ? 7 : 14);
  });
}

test("new intent refuses flag OFF; eligible Free owner is still allowed with server Pro price, exact seats and safe board returns", async () => {
  const refused = harness(); refused.enabled = false;
  assert.equal((await refused.checkout()).status, 403);
  assert.equal(refused.calls.length, 0);
  const h = harness();
  const preview = await h.checkout(startBody({ action: "preview" }));
  assert.deepEqual(preview.body, { canStartPlan: true, trialDays: 7 });
  assert.equal(h.record, null); assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
  const payload = h.calls[0].payload;
  assert.equal(payload.customer, "cus_owned");
  assert.deepEqual(payload.line_items, [{ price: "price_pro_month", quantity: 3 }]);
  assert.equal(payload.subscription_data.trial_period_days, 7);
  assert.equal(payload.success_url, boardUrl);
  assert.equal(payload.cancel_url, boardUrl);
  assert.equal(payload.payment_method_collection, "always");
  assert.equal(payload.metadata.trialDays, "7");
  assert.equal(payload.metadata.checkoutIntent, "signup-straight-to-board");
  assert.equal(payload.customer_email, undefined);
  assert.equal(h.writes, 0);
});

test("member is refused, owner is still allowed and ownership is rechecked under the lock", async () => {
  const h = harness();
  assert.equal((await h.checkout(startBody(), 99)).status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
  const changed = harness(); changed.onLock = () => { changed.team.googleAccount.userId = 99; };
  assert.equal((await changed.checkout()).status, 403);
  assert.equal(changed.calls.length, 0);
});

test("new intent rejects every client billing term and arbitrary return destination; ordinary owner request remains allowed", async () => {
  const h = harness();
  for (const extra of [{ priceId: "price_legacy_trial" }, { trialDays: 99 }, { quantity: 999 },
    { stripe_customer_id: "cus_spoof" }, { googleAccountId: "spoof" }, { mode: "Normal" },
    { returnUrl: boardUrl }, { cancelUrl: boardUrl }, { intent: "forged" }]) {
    assert.equal((await h.checkout(startBody(extra))).status, 400, JSON.stringify(extra));
  }
  for (const bad of ["https://evil.test/project?id=7", "https://app.hypertask.ai/pricing?id=7", "https://app.hypertask.ai/project?id=7&id=8"]) {
    assert.equal((await h.checkout(startBody({ boardUrl: bad }))).status, 400);
  }
  assert.equal((await h.checkout(startBody({ boardUrl: "https://app.hypertask.ai/project?id=8" }))).status, 404);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
});

test("comped, internally comped and paid teams are refused without writes; Free team is still allowed", async () => {
  for (const extra of [
    { compedUntil: "2099-01-01", compedPlan: "Pro" },
    { compedUntil: "2099-01-01", compedPlan: "BYOK" },
    { id: "08f79efd-770e-4e32-9728-65e6d29ec893" },
    { activeSubscriptionPlanId: "sub_active", subscriptionPlan: [{ subscriptionId: "sub_active", subscriptionStatus: "active", priceId: "price_pro_month" }] },
  ]) {
    const h = harness(); Object.assign(h.team, extra);
    assert.equal((await h.checkout(startBody({ teamId: h.team.id }))).status, 409);
    assert.equal(h.calls.length, 0); assert.equal(h.writes, 0);
  }
  assert.equal((await harness().checkout()).status, 200);
});

test("price contract fails closed for wrong product, amount, currency, interval, activity or quantity transformation", async () => {
  for (const extra of [{ product: "prod_other" }, { unit_amount: 1900 }, { currency: "eur" }, { active: false },
    { type: "one_time" }, { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
    { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 2, round: "up" } }]) {
    const h = harness(); Object.assign(h.price, extra);
    assert.equal((await h.checkout(startBody({ action: "preview" }))).status, 503);
    assert.equal((await h.checkout()).status, 503);
    assert.equal(h.calls.length, 0);
  }
  const unavailable = harness(); unavailable.priceFailure = true;
  assert.equal((await unavailable.checkout()).status, 503);
  assert.equal(unavailable.calls.length, 0);
  const old = process.env.STRIPE_PRO_PRODUCT_ID;
  try {
    delete process.env.STRIPE_PRO_PRODUCT_ID;
    assert.equal((await harness().checkout()).status, 503);
  } finally { process.env.STRIPE_PRO_PRODUCT_ID = old; }
  assert.equal((await harness().checkout()).status, 200);
});

test("past trials get normal monthly checkout and no free-trial capability claim; legacy repeat trial stays refused", async () => {
  for (const databaseHistory of [true, false]) {
    const h = harness();
    if (databaseHistory) h.team.team_activity.hasCompletedTrial = true;
    else h.subscriptions = [subscription("canceled", { trial_start: 123, trial_end: 456 })];
    const preview = await h.checkout(startBody({ action: "preview" }));
    assert.equal(preview.body.trialDays, 0);
    assert.equal(h.calls.length, 0);
    assert.equal((await h.checkout(legacyBody())).status, 409);
    assert.equal((await h.checkout()).status, 200);
    assert.equal(h.calls[0].payload.subscription_data, undefined);
    assert.equal(h.calls[0].payload.line_items[0].price, "price_pro_month");
  }
});

test("all nonterminal customer subscriptions refuse new intent; terminal subscriptions and unrelated legacy Normal policy remain allowed", async () => {
  for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]) {
    const h = harness(); h.subscriptions = [subscription(status)];
    assert.equal((await h.checkout()).status, 409, status);
    assert.equal(h.calls.length, 0);
  }
  for (const status of ["canceled", "incomplete_expired"]) {
    const h = harness(); h.subscriptions = [subscription(status)];
    assert.equal((await h.checkout()).status, 200);
  }
  const legacy = harness(); legacy.subscriptions = [subscription("paused")];
  assert.equal((await legacy.checkout(legacyBody({ mode: "Normal", priceId: "price_pro_month" }))).status, 200);
});

test("nonterminal and past-trial checks paginate Stripe subscriptions", async () => {
  const h = harness();
  h.subscriptionPages = [
    { data: [subscription("canceled", { id: "sub_page_one" })], has_more: true },
    { data: [subscription("paused")], has_more: false },
  ];
  assert.equal((await h.checkout()).status, 409);
  assert.equal(h.subscriptionRequests[1].starting_after, "sub_page_one");
  const trial = harness(); trial.subscriptionPages = [
    h.subscriptionPages[0], { data: [subscription("canceled", { trial_start: 1 })], has_more: false },
  ];
  assert.equal((await trial.checkout()).status, 200);
  assert.equal(trial.calls[0].payload.subscription_data, undefined);
});

test("double clicks/two tabs reuse one session and old/new tabs serialize and expire the incompatible 14-day offer", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.checkout(), h.checkout()]);
  assert.equal(a.body.url, b.body.url); assert.equal(h.calls.length, 1);
  const mixed = harness(); mixed.enabled = false;
  await mixed.checkout(legacyBody());
  mixed.enabled = true;
  assert.equal((await mixed.checkout()).status, 200);
  assert.deepEqual(mixed.expired, ["cs_1"]);
  assert.equal(mixed.calls[0].payload.subscription_data.trial_period_days, 14);
  assert.equal(mixed.calls[1].payload.subscription_data.trial_period_days, 7);
  assert.notEqual(mixed.calls[0].key, mixed.calls[1].key);
});

test("compatible orphans are reused; trial-day mismatches and stale redirects are expired under the same lock", async () => {
  const h = harness(); const original = await h.checkout(); h.record = null;
  assert.equal((await h.checkout()).body.url, original.body.url);
  assert.equal(h.calls.length, 1);
  h.record = null; h.sessions.get("cs_1").metadata.trialDays = "14";
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.expired, ["cs_1"]);
  h.record = null; h.sessions.get("cs_2").success_url = "https://app.hypertask.ai/project?id=7&view=old";
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.expired, ["cs_1", "cs_2"]);
});

for (const retryLegacy of [false, true]) {
  test(`lost-response seven-day checkout reconciles identical payload/key after OFF (${retryLegacy ? "legacy" : "header"} retry)`, async () => {
    const h = harness(); h.timeoutAfterCreate = true; h.hidden = true;
    assert.equal((await h.checkout()).status, 409);
    const pending = structuredClone(h.record); h.enabled = false; h.seats = 9;
    const retry = await h.checkout(retryLegacy ? legacyBody() : startBody());
    assert.equal(retry.status, retryLegacy ? 409 : 200);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].key, h.calls[1].key);
    assert.deepEqual(h.calls[0].payload, h.calls[1].payload);
    assert.equal(h.record.attemptId, pending.attemptId);
    assert.deepEqual(h.expired, []);
    assert.equal(h.sessions.size, 1);
  });
}

test("OFF preserves known seven-day sessions and orphan offers, never adopting them into fresh legacy requests", async () => {
  for (const orphan of [false, true]) {
    const h = harness(); const original = await h.checkout(); h.enabled = false;
    if (orphan) h.record = null;
    assert.equal((await h.checkout(legacyBody())).status, 409);
    assert.deepEqual(h.expired, []);
    assert.equal(h.calls.length, 1);
    if (!orphan) assert.equal((await h.checkout()).body.url, original.body.url);
  }
});

test("legacy missing-field in-flight attempts replay the exact old wire payload and original key before a new selection", async () => {
  const h = harness(); h.enabled = false; h.hidden = true;
  const desired = { teamId: "team-owned", customerId: "cus_owned", googleAccountId: "account-owned",
    quantity: 3, priceId: "price_legacy_trial", checkoutMode: "Trial",
    returnUrl: legacyBody().returnUrl, cancelUrl: legacyBody().cancelUrl };
  h.record = { ...h.reservations.createCheckoutAttempt(desired), state: "in_flight" };
  const key = h.record.idempotencyKey;
  const wire = {
    mode: "subscription", customer: "cus_owned", line_items: [{ quantity: 3, price: "price_legacy_trial", adjustable_quantity: { enabled: true, minimum: 3 } }],
    success_url: desired.returnUrl, cancel_url: desired.cancelUrl, allow_promotion_codes: true, payment_method_collection: "always",
    subscription_data: { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } } },
    metadata: { teamId: "team-owned", googleAccountId: "account-owned", stripe_customer_id: "cus_owned", priceId: "price_legacy_trial",
      checkoutMode: "Trial", checkoutQuantity: "3", checkoutAttemptId: h.record.attemptId },
  };
  h.payloads.set(key, structuredClone(wire));
  h.sessions.set("cs_legacy", { id: "cs_legacy", key, status: "open", url: "https://checkout.stripe.test/legacy",
    customer: wire.customer, metadata: wire.metadata, success_url: wire.success_url, cancel_url: wire.cancel_url });
  assert.equal((await h.checkout(legacyBody())).status, 200);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].key, key);
  assert.deepEqual(h.calls[0].payload, wire);
  assert.equal(h.record.desired.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.checkoutIntent, undefined);
});

test("ambiguous recovery remains 409 with original key; lock loss cannot settle or replace it", async () => {
  const h = harness(); h.rejectOnce = Object.assign(new Error("busy"), { statusCode: 409 });
  assert.equal((await h.checkout()).status, 409);
  const original = h.record.idempotencyKey;
  h.rejectOnce = new Error("network"); h.enabled = false;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  assert.equal(h.record.idempotencyKey, original);
  assert.deepEqual(h.calls.map(({ key }) => key), [original, original]);
  assert.deepEqual(h.expired, []);
  const lost = harness(); lost.beforeCreate = async () => { lost.lost = true; };
  await assert.rejects(lost.checkout(), { name: "CheckoutReservationLockLostError" });
  assert.equal(lost.record.state, "in_flight");
  const savedKey = lost.record.idempotencyKey; lost.beforeCreate = null; lost.lost = false;
  assert.equal((await lost.checkout()).status, 200);
  assert.equal(lost.record.idempotencyKey, savedKey);
  assert.equal(lost.sessions.size, 1);
});

test("completed trials are never shortened/replaced, even with stale subscription listings or changed desired terms", async () => {
  const h = harness(); await h.checkout();
  const original = h.record.attemptId;
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_started";
  h.seats = 10;
  assert.equal((await h.checkout()).status, 409);
  const preview = await h.checkout(startBody({ action: "preview" }));
  assert.equal(preview.body.finishing, true);
  h.enabled = false;
  assert.equal((await h.checkout()).status, 409);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
  assert.equal(h.record.attemptId, original);
});

test("agent and cross-origin requests are refused at the signed-session boundary; same-origin human owner is still allowed", async () => {
  const h = harness();
  let session = { id: 6, agentId: "agent" };
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => session, verifyProvisionalCheckoutSession: () => null },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (_id, body) => h.checkout(body) },
  }).default;
  const invoke = async (origin) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await route({ method: "POST", headers: { origin }, cookies: {}, body: startBody() }, res);
    return res;
  };
  assert.equal((await invoke("https://app.hypertask.ai")).code, 403);
  session = { id: 6 };
  assert.equal((await invoke("https://evil.test")).code, 403);
  assert.equal((await invoke(undefined)).code, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await invoke("https://app.hypertask.ai")).code, 200);
});


test("restricted provisional checkout refuses other teams, legacy intent and unproven customer email; its own email-free team stays allowed", async () => {
  const h = harness();
  const principal = { provisionalTeamId: "team-owned" };
  assert.equal((await h.checkout(startBody({ teamId: "another-team" }), 6, principal)).status, 403);
  assert.equal((await h.checkout(legacyBody(), 6, principal)).status, 403);
  h.customerEmail = "unproven@example.test";
  assert.equal((await h.checkout(startBody(), 6, principal)).status, 409);
  assert.equal(h.calls.length, 0);
  h.customerEmail = null;
  assert.equal((await h.checkout(startBody(), 6, principal)).status, 200);
  assert.equal(h.calls[0].payload.customer_email, undefined);
  assert.equal(h.writes, 0);
});

test("restricted checkout tokens cannot authenticate as full web sessions, but remain allowed on their own checkout route", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "checkout-scope-fixture-secret";
  try {
    const sessions = load("src/lib/auth/session.ts");
    const edge = load("src/lib/auth/sessionEdge.ts");
    const token = sessions.signProvisionalCheckoutSession(6, "team-owned");
    assert.equal(sessions.verifySession(token), null);
    assert.equal(await edge.verifySessionEdge(token), null);
    assert.deepEqual(sessions.verifyProvisionalCheckoutSession(token), { id: 6, provisionalTeamId: "team-owned" });
    const full = sessions.signSession({ id: 6 });
    assert.deepEqual(sessions.verifySession(full), { id: 6 });
    assert.deepEqual(await edge.verifySessionEdge(full), { id: 6 });
    assert.equal(sessions.verifyProvisionalCheckoutSession(full), null);
    const h = harness();
    const route = load("src/pages/api/stripe/session/checkout.ts", {
      "@/lib/auth/session": sessions,
      "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
      "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (id, body, principal) => h.checkout(body, id, principal) },
    }).default;
    const invoke = async (body, cookies) => {
      const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await route({ method: "POST", headers: { origin: "https://app.hypertask.ai" }, cookies, body }, res);
      return res;
    };
    const cookies = { [sessions.PROVISIONAL_CHECKOUT_COOKIE]: token };
    assert.equal((await invoke(legacyBody(), cookies)).code, 403);
    assert.equal((await invoke(startBody({ teamId: "other" }), cookies)).code, 403);
    assert.equal((await invoke(startBody(), { [sessions.SESSION_COOKIE]: token })).code, 401);
    assert.equal(h.calls.length, 0);
    assert.equal((await invoke(startBody(), cookies)).code, 200);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});


test("orphan reuse checks every checkout page, including pages containing only another team's sessions", async () => {
  const h = harness(); const first = await h.checkout(); h.record = null;
  h.sessionPages = [
    { data: [{ id: "cs_other", metadata: { teamId: "another-team" }, status: "open" }], has_more: true },
    { data: [h.sessions.get("cs_1")], has_more: false },
  ];
  const retry = await h.checkout();
  assert.equal(retry.body.url, first.body.url);
  assert.equal(h.calls.length, 1);
  assert.equal(h.sessionRequests.at(-1).starting_after, "cs_other");
  assert.deepEqual(h.expired, []);
});

test("OFF can start a new fourteen-day legacy attempt only after an old seven-day offer has actually expired", async () => {
  const h = harness(); await h.checkout(); h.enabled = false;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  const oldKey = h.record.idempotencyKey;
  h.sessions.get("cs_1").status = "expired";
  assert.equal((await h.checkout(legacyBody())).status, 200);
  assert.notEqual(h.record.idempotencyKey, oldKey);
  assert.equal(h.calls.at(-1).payload.subscription_data.trial_period_days, 14);
  assert.deepEqual(h.expired, []);
});

test("completed legacy fourteen-day trial cannot be replaced by a seven-day legacy request when Stripe's subscription list lags", async () => {
  const h = harness(); h.enabled = false;
  await h.checkout(legacyBody());
  const key = h.record.idempotencyKey;
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_legacy";
  h.enabled = true; h.hidden = true;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  assert.equal(h.record.idempotencyKey, key);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
});

test("a canceled completed trial offers monthly checkout, and a stale non-entitling plan pointer does not refuse a Free team", async () => {
  const h = harness(); await h.checkout();
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_cancelled";
  h.subscriptions = [subscription("canceled", { id: "sub_cancelled", trial_start: 1, trial_end: 2 })];
  assert.equal((await h.checkout(startBody({ action: "preview" }))).body.trialDays, 0);
  assert.equal((await h.checkout()).status, 200);
  assert.equal(h.calls.at(-1).payload.subscription_data, undefined);
  const stale = harness(); stale.team.activeSubscriptionPlanId = "sub_old";
  stale.team.subscriptionPlan = [{ subscriptionId: "sub_old", subscriptionStatus: "canceled", priceId: "price_pro_month" }];
  assert.equal((await stale.checkout()).status, 200);
  assert.equal(stale.calls[0].payload.subscription_data.trial_period_days, 7);
});

test("unsigned and guest requests remain refused while a signed non-guest owner remains allowed", async () => {
  const h = harness(); let session = null; let guest = false;
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => session, verifyProvisionalCheckoutSession: () => null },
    "@/lib/demo/guestGuard": { GUEST_FORBIDDEN_MESSAGE: "Guests cannot buy plans", isGuestRequest: async () => guest },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (_id, body) => h.checkout(body) },
  }).default;
  const invoke = async () => {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await route({ method: "POST", cookies: {}, headers: { origin: "https://app.hypertask.ai", authorization: "Bearer agent-token-fixture" }, body: startBody() }, res);
    return res;
  };
  assert.equal((await invoke()).code, 401);
  session = { id: 6 }; guest = true;
  assert.equal((await invoke()).code, 403);
  assert.equal(h.calls.length, 0);
  guest = false; assert.equal((await invoke()).code, 200);
});


test("already-admitted past-trial monthly intent also recovers its frozen non-adjustable payload after OFF", async () => {
  const h = harness(); h.team.team_activity.hasCompletedTrial = true;
  h.timeoutAfterCreate = true; h.hidden = true;
  assert.equal((await h.checkout()).status, 409);
  const key = h.record.idempotencyKey;
  h.enabled = false;
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.record.idempotencyKey, key);
  assert.equal(h.calls[1].payload.subscription_data, undefined);
  assert.deepEqual(h.calls[1].payload.line_items, [{ quantity: 3, price: "price_pro_month" }]);
  assert.equal((await h.checkout(startBody({ action: "preview" }))).body.trialDays, 0);
  assert.equal((await h.checkout(legacyBody({ mode: "Normal", priceId: "price_pro_month" }))).status, 409);
  assert.deepEqual(h.expired, []);
});
