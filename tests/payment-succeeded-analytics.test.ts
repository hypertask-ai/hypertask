import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const paymentFlag = "htpr-7272-payment-login-agent-events";
const subscriptionFlag = "htpr-7268-invite-seat-analytics";
const paidAt = 1769999990;

function harness() {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG = paymentFlag;
  h.setFlagEnabled(paymentFlag, true);
  h.mocks["@/lib/telemetry/analyticsOutbox"] = { isAnalyticsOutboxEnabled: async () => false };
  h.prisma.team.findFirst = async ({ where }: any) => where.stripe_customer_id === "cus_stored"
    ? { id: "team", googleAccount: { userId: 123 } } : null;
  h.prisma.subscriptionPlan = { findFirst: async () => null };
  return h;
}

function invoice(overrides: Record<string, any> = {}): any {
  return {
    id: "in_renewal", customer: "cus_stored", subscription: "sub_paid", status: "paid", amount_paid: 3000,
    currency: "usd", billing_reason: "subscription_cycle", status_transitions: { paid_at: paidAt },
    lines: { data: [
      { type: "invoiceitem", price: { id: "price_one_off" } },
      { type: "subscription", price: { id: "price_month" } },
      { type: "subscription", price: { id: "price_extra" } },
    ] },
    customer_email: "never-send@example.test", customer_name: "Never Send", description: "private customer text",
    metadata: { secret: "private-secret" }, ...overrides,
  };
}

function event(object = invoice(), id = "evt_paid"): Stripe.Event {
  return { id, type: "invoice.paid", created: 1770000000, data: { object } } as Stripe.Event;
}

function subscription(): any {
  return {
    id: "sub_paid", customer: "cus_stored", status: "active",
    items: { data: [{ id: "si_paid", quantity: 3, price: {
      id: "price_month", product: "prod_paid", unit_amount: 1000, currency: "usd", recurring: { interval: "month" },
    } }] },
  };
}

function record(h: ReturnType<typeof harness>, evt = event(), retrieve = async () => subscription(), history = async (): Promise<any> => ({ data: [], has_more: true })) {
  h.load("src/lib/telemetry/stripeAnalytics.ts").recordStripeInvoicePaid(evt, retrieve, history);
}

function expected(evt = event(), plan: string | null = "price_month", time: number | null = paidAt) {
  const paidInvoice = evt.data.object as any;
  return {
    distinctId: "123", event: "payment_succeeded", properties: {
      user_id: "123", workspace_id: "team", board_id: null, source: "server", event_id: `payment_succeeded:${paidInvoice.id}`,
      occurred_at: new Date((time ?? evt.created) * 1000).toISOString(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      utm_source: null, utm_medium: null, utm_campaign: null, initial_referrer: null,
      is_seeded: null, account_category: null, attribution_status: "unknown",
      stripe_event_id: evt.id, stripe_customer_id: "cus_stored", subscription_id: "sub_paid", invoice_id: paidInvoice.id,
      plan, currency: "usd", amount_paid: 3000, paid_at: time === null ? null : new Date(time * 1000).toISOString(),
      billing_reason: paidInvoice.billing_reason ?? null,
    },
    timestamp: new Date((time ?? evt.created) * 1000),
  };
}

function payments(h: ReturnType<typeof harness>) {
  return h.captures.filter((capture) => capture.event === "payment_succeeded");
}

test("renewals capture exact payment properties once per invoice, not per Stripe delivery", async () => {
  const h = harness();
  record(h);
  record(h);
  record(h, event(invoice(), "evt_another_delivery"));
  await h.drain();
  record(h, event(invoice(), "evt_late_replay"));
  await h.drain();
  assert.deepEqual(h.captures, [expected()]);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].log, "analytics:payment_succeeded:in_renewal");
  assert.match(h.captureAttempts[0].uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(h.flagChecks.some(({ key, userId }) => key === paymentFlag && userId === 123));
  record(h, event(invoice({ id: "in_next_renewal" }), "evt_next"));
  await h.drain();
  assert.equal(payments(h).length, 2);
});

for (const [scenario, overrides] of Object.entries({
  zero: { amount_paid: 0 }, negative: { amount_paid: -1 }, unpaid: { status: "open" },
  missingSubscription: { subscription: null }, missingCustomer: { customer: null },
  unmappedCustomer: { customer: "cus_unmapped" },
})) {
  test(`payment_succeeded skips ${scenario}`, async () => {
    const h = harness();
    h.setFlagEnabled(subscriptionFlag, false);
    const warn = console.warn;
    console.warn = () => {};
    try {
      record(h, event(invoice(overrides)), async () => { throw Error("must not retrieve subscription"); });
      await h.drain();
      assert.deepEqual(h.captures, []);
      assert.deepEqual(h.logs, []);
    } finally { console.warn = warn; }
  });
}

test("payment and legacy paths share one stored customer lookup and never fall back to invoice email", async () => {
  const h = harness();
  let lookups = 0;
  h.prisma.team.findFirst = async ({ where }: any) => {
    lookups++;
    assert.deepEqual(where, { stripe_customer_id: "cus_stored" });
    return { id: "team", googleAccount: { userId: 123 } };
  };
  h.setFlagEnabled(subscriptionFlag, false);
  record(h);
  await h.drain();
  assert.equal(lookups, 1);
  assert.deepEqual(payments(h), [expected()]);
});

test("payment flag is independent from subscription_started and flag off preserves legacy output", async () => {
  for (const paymentEnabled of [false, true]) {
    for (const subscriptionEnabled of [false, true]) {
      const h = harness();
      h.setFlagEnabled(paymentFlag, paymentEnabled);
      h.setFlagEnabled(subscriptionFlag, subscriptionEnabled);
      const evt = event(invoice({ billing_reason: "subscription_create" }));
      record(h, evt, async () => subscription(), async () => ({ data: [], has_more: false }));
      await h.drain();
      assert.deepEqual(h.captures.map((capture) => capture.event).sort(), [
        ...(paymentEnabled ? ["payment_succeeded"] : []), ...(subscriptionEnabled ? ["subscription_started"] : []),
      ].sort());
      if (!paymentEnabled && subscriptionEnabled) {
        const legacy = harness();
        legacy.setFlagEnabled(paymentFlag, false);
        legacy.load("src/lib/telemetry/stripeAnalytics.ts").recordStripeInvoicePaid(evt, async () => subscription(), async () => ({ data: [], has_more: false }));
        await legacy.drain();
        assert.deepEqual(h.captures, legacy.captures);
      }
      if (paymentEnabled) assert.deepEqual(payments(h), [expected(evt)]);
    }
  }
});

test("payment eligibility excludes QA, guests, missing users and activation-disabled users", async () => {
  for (const scenario of ["qa", "guest", "missing", "disabled"]) {
    const h = harness();
    h.setFlagEnabled(subscriptionFlag, false);
    if (scenario === "qa") h.prisma.team.findFirst = async () => ({ id: "team", googleAccount: { userId: 985 } });
    if (scenario === "guest") h.users.get(123).uid = "guest_123";
    if (scenario === "missing") h.users.delete(123);
    if (scenario === "disabled") h.setFlagEnabled("htpr-7034-activation-analytics", false);
    record(h);
    await h.drain();
    assert.deepEqual(h.captures, [], scenario);
    assert.deepEqual(h.logs, [], scenario);
  }
});

test("subscription lookup failures cannot suppress an independent payment", async () => {
  for (const failure of ["history", "subscription"]) {
    const h = harness();
    record(h, event(), async () => { throw Error("Stripe subscription unavailable"); }, async () => {
      if (failure === "history") throw Error("Stripe history unavailable");
      return { data: [], has_more: false };
    });
    await h.drain();
    assert.deepEqual(payments(h), [expected()]);
  }
});

test("modern invoice parent and price payloads work without extra Stripe calls", async () => {
  const h = harness();
  h.setFlagEnabled(subscriptionFlag, false);
  const evt = event(invoice({
    subscription: null, customer: { id: "cus_stored" },
    parent: { subscription_details: { subscription: { id: "sub_paid" } } },
    lines: { data: [
      { parent: { type: "invoice_item_details" }, pricing: { price_details: { price: "price_one_off" } } },
      { parent: { type: "subscription_item_details" }, pricing: { price_details: { price: { id: "price_modern" } } } },
    ] },
  }));
  record(h, evt, async () => { throw Error("must not retrieve subscription"); }, async () => { throw Error("must not list invoices"); });
  await h.drain();
  assert.deepEqual(h.captures, [expected(evt, "price_modern")]);
});

for (const lines of [undefined, { data: [] }, { data: [{ type: "invoiceitem", price: { id: "price_not_subscription" } }] }, { data: [{ type: "subscription" }] }]) {
  test(`missing subscription line price stays null: ${JSON.stringify(lines)}`, async () => {
    const h = harness();
    h.setFlagEnabled(subscriptionFlag, false);
    const evt = event(invoice({ lines, billing_reason: null, status_transitions: { paid_at: null } }));
    record(h, evt);
    await h.drain();
    assert.deepEqual(h.captures, [expected(evt, null, null)]);
  });
}

test("failed payment delivery retries with the same business UUID even after the billed user changes", async () => {
  const h = harness();
  h.setFlagEnabled(subscriptionFlag, false);
  h.setFailure("capture");
  record(h);
  await h.drain();
  assert.equal(h.captures.length, 0);
  assert.equal(h.logs.length, 0);
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  h.users.set(234, { id: 234, uid: "real_234", email: "private@example.test" });
  h.prisma.team.findFirst = async () => ({ id: "team", googleAccount: { userId: 234 } });
  record(h, event(invoice(), "evt_retry"));
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts[1].uuid, uuid);
  record(h);
  await h.drain();
  assert.equal(h.captures.length, 1);
});

function response() {
  return { code: 0, body: null as any, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

function webhook(h: ReturnType<typeof harness>, evt: Stripe.Event, verified = true) {
  const billing: string[] = [];
  h.mocks["raw-body"] = { default: async () => Buffer.from("signed fixture") };
  h.mocks["stripe"] = { Stripe: class {
    webhooks = { constructEvent: () => { if (!verified) throw Error("invalid signature"); return evt; } };
    subscriptions = { retrieve: async () => subscription() };
    invoices = { list: async () => ({ data: [], has_more: false }) };
  } };
  h.mocks["@/utils/controllers/stripe/webhook/onCheckoutSuccess"] = { default: async () => { billing.push("checkout"); } };
  h.mocks["@/utils/controllers/stripe/webhook/onSubscriptionUpdated"] = { default: async () => { billing.push("update"); } };
  return { billing, handle: h.load("src/pages/api/stripe/webhook.ts").default };
}

test("verified first-invoice webhook returns unchanged response before analytics resolves and emits both events", async () => {
  const h = harness();
  const original = h.prisma.team.findFirst;
  const pending: ((value: any) => void)[] = [];
  h.prisma.team.findFirst = (args: any) => new Promise((resolve) => { pending.push(async () => resolve(await original(args))); });
  const evt = event(invoice({ billing_reason: "subscription_create" }));
  const { billing, handle } = webhook(h, evt);
  const res = response();
  await handle({ headers: { "stripe-signature": "signed" } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { message: "success" });
  assert.deepEqual(billing, []);
  assert.equal(h.captures.length, 0);
  h.prisma.team.findFirst = original;
  pending.forEach((resolve) => resolve(null));
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.event).sort(), ["payment_succeeded", "subscription_started"]);
  assert.deepEqual(payments(h), [expected(evt)]);
});

test("unverified Stripe events never schedule payment analytics", async () => {
  const h = harness();
  const { billing, handle } = webhook(h, event(), false);
  await assert.rejects(handle({ headers: { "stripe-signature": "invalid" } }, response()), /invalid signature/);
  assert.deepEqual(h.jobs, []);
  assert.deepEqual(h.captures, []);
  assert.deepEqual(billing, []);
});

for (const failure of ["capture", "database", "constructor", "schedule"] as const) {
  test(`payment analytics ${failure} failure cannot change webhook response or billing`, async () => {
    const h = harness();
    h.setFailure(failure);
    const { billing, handle } = webhook(h, event());
    const res = response();
    await handle({ headers: { "stripe-signature": "signed" } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { message: "success" });
    assert.deepEqual(billing, []);
    await assert.doesNotReject(h.drain());
  });
}
