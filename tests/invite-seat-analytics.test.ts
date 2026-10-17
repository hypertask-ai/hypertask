import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

function harness() {
  const h = activationHarness();
  h.prisma.team.findFirst = async ({ where }: any) => where.stripe_customer_id === "cus_stored"
    ? { id: "team", googleAccount: { userId: 123 } } : null;
  h.prisma.subscriptionPlan = { findFirst: async () => null };
  return h;
}

function subscription(overrides: Record<string, any> = {}): any {
  return {
    id: "sub_paid", customer: "cus_stored", status: "active", ended_at: null,
    cancellation_details: null,
    items: { data: [
      { id: "si_one", quantity: 3, price: { id: "price_month", product: "prod_one", unit_amount: 1000, currency: "usd", recurring: { interval: "month" } } },
      { id: "si_two", quantity: 2, price: { id: "price_extra", product: "prod_two", unit_amount: 500, currency: "usd", recurring: { interval: "month" } } },
    ] },
    discount: { coupon: { percent_off: 25, amount_off: null } },
    ...overrides,
  };
}

function event(type = "customer.subscription.updated", id = "evt_seats", object: any = subscription(), previous: any = undefined): Stripe.Event {
  return { id, type, created: 1770000000, data: { object, previous_attributes: previous } } as Stripe.Event;
}

function paidEvent(overrides: Record<string, any> = {}, id = "evt_paid") {
  return event("invoice.paid", id, {
    id: "in_paid", customer: "cus_stored", subscription: "sub_paid", status: "paid", amount_paid: 3000,
    currency: "usd", status_transitions: { paid_at: 1769999990 }, ...overrides,
  });
}

const noPaidHistory = async () => ({ data: [], has_more: false });

function invitationRef(id: string) {
  return require("node:crypto").createHash("sha256").update(`hypertask:invitation:${id}`).digest("hex").slice(0, 32);
}

function common(userId: number, eventId: string, boardId: string | null = null) {
  return {
    user_id: String(userId), workspace_id: "team", board_id: boardId, source: "server", event_id: eventId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    utm_source: null, utm_medium: null, utm_campaign: null, initial_referrer: null,
    is_seeded: null, account_category: null, attribution_status: "unknown",
  };
}

function assertCommon(properties: any, userId: number, eventId: string, boardId: string | null = null) {
  for (const [key, value] of Object.entries(common(userId, eventId, boardId))) assert.equal(properties[key], value, key);
  assert.equal(new Date(properties.occurred_at).toISOString(), properties.occurred_at);
}

test("invite_sent captures email/link once per invitation, including resends and parallel retries", async () => {
  for (const method of ["email", "link"] as const) {
    const h = harness();
    const api = h.load("src/lib/telemetry/inviteAnalytics.ts");
    const invite = { id: "invitation", userId: 123, projectId: 15 };
    api.recordInviteSent(invite, method);
    api.recordInviteSent(invite, method);
    await h.drain();
    api.recordInviteSent(invite, method);
    await h.drain();
    assert.equal(h.captures.length, 1);
    const capture = h.captures[0];
    assert.equal(capture.event, "invite_sent");
    assert.equal(capture.distinctId, "123");
    assertCommon(capture.properties, 123, `invite_sent:${invitationRef("invitation")}`, "15");
    assert.equal(capture.properties.invitation_id, invitationRef("invitation"));
    assert.equal(JSON.stringify(capture).includes('"invitation"'), false);
    assert.equal(capture.properties.invite_method, method);
    assert.equal(capture.properties.role, "Member");
    assert.match(h.captureAttempts[0].uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test("the resend route reuses the invitation's inviter and cannot double count accepted delivery", async () => {
  const h = harness();
  const invite = { id: "existing", userId: 123, projectId: 15, project: h.projects.get(15) };
  h.users.set(234, { id: 234, uid: "real_resender", email: "resender@example.test" });
  h.mocks["@/lib/auth/getSessionUser"].getSessionUser = async () => ({ userId: 234 });
  h.mocks["@/utils/controllers/getMemberAndOwnerForBoard"].default = async () => [234];
  h.prisma.invite.findFirst = async () => invite;
  h.mocks["@/pages/api/invite/cancelInvite"] = { cancelInvite: async () => {} };
  h.load("src/lib/telemetry/inviteAnalytics.ts").recordInviteSent(invite, "email");
  await h.drain();
  const handler = h.load("src/pages/api/invite/reSendInvite.ts").default;
  for (let retry = 0; retry < 2; retry++) {
    const res = response();
    await handler({ headers: {}, body: { projectId: 15, email: "invitee@example.test" } }, res);
    assert.equal(res.code, 200);
    await h.drain();
  }
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].distinctId, "123");
});

test("public link reset attributes invite_sent to the actual creator rather than the stored board owner", async () => {
  const h = harness();
  h.projects.get(15).ownerId = 234;
  h.prisma.invite.findFirst = async () => ({ id: "old" });
  h.mocks["@/utils/api/invite/generatePublicInviteController"] = h.load("src/utils/api/invite/generatePublicInviteController.ts");
  const res = response();
  await h.load("src/pages/api/invite/generatePublicInvite.ts").default({ method: "POST", headers: {}, body: { projectId: 15 } }, res);
  assert.equal(res.code, 200);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].distinctId, "123");
  assert.equal(h.captures[0].properties.invite_method, "link");
});

test("invitation dedupe and UUID survive a changed attributed inviter", async () => {
  const h = harness();
  h.users.set(234, { id: 234, uid: "real_resender", email: "resender@example.test" });
  const api = h.load("src/lib/telemetry/inviteAnalytics.ts");
  const invite = { id: "shared-invitation", userId: 123, projectId: 15 };
  h.setFailure("capture");
  api.recordInviteSent(invite, "link", 234);
  await h.drain();
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  api.recordInviteSent(invite, "email");
  await h.drain();
  assert.equal(h.captureAttempts[1].uuid, uuid);
  api.recordInviteSent(invite, "link", 234);
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("member_joined uses the joiner and membership ID, counts human board members plus owner, and excludes owner", async () => {
  const h = harness();
  h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
  h.members.push({ id: 7, projectId: 15, userId: 234, agentId: null, role: "Member", acceptedAt: new Date(1769999000000) });
  h.members.push({ id: 8, projectId: 15, userId: 123, agentId: "agent", role: "Member" });
  const api = h.load("src/lib/telemetry/inviteAnalytics.ts");
  api.recordMemberJoined(7, 234, 15, "invitation", 123);
  api.recordMemberJoined(7, 234, 15, "invitation", 123);
  api.recordMemberJoined(8, 123, 15);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].distinctId, "234");
  assert.equal(h.captures[0].event, "member_joined");
  assert.deepEqual(h.captures[0].properties, {
    ...common(234, "member_joined:7", "15"), occurred_at: new Date(1769999000000).toISOString(),
    membership_id: "7", invitation_id: invitationRef("invitation"), inviter_user_id: "123", role: "Member", member_count: 2,
  });
});

for (const key of ["SOME-KEY", "public"]) {
  test(`committed ${key === "public" ? "public link" : "email invite"} join emits once and repeated acceptance does not`, async () => {
    const h = harness();
    h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
    h.invites.push({ id: "invite", key, userId: 123, projectId: 15, expired: false, uses: -1, project: h.projects.get(15) });
    const accept = h.load("src/utils/controllers/members/invite.ts").default;
    assert.equal((await accept(234, 15, "invite")).status, 200);
    await accept(234, 15, "invite");
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].event, "member_joined");
    assert.equal(h.captures[0].properties.invitation_id, invitationRef("invite"));
  });
}

for (const needsSeat of [false, true]) {
  test(`direct member add records only committed membership, new team seat=${needsSeat}`, async () => {
    const h = harness();
    h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
    h.projects.get(15).team = { id: "team", googleAccount: { userId: 123 }, stripe_customer_id: "cus_stored" };
    let accepted = !needsSeat;
    h.prisma.member_Team.findFirst = async () => accepted ? { status: "Accepted" } : null;
    h.prisma.member_Team.findUnique = async () => ({ status: accepted ? "Accepted" : "Pending" });
    h.prisma.team.update = async () => ({ totalSeats: 2 });
    h.prisma.invite.updateMany = async () => ({});
    h.mocks["@/lib/teamMembership"].ensureTeamMembership = async () => { accepted = true; return { created: true, member: { user: {} } }; };
    h.mocks["@/lib/syncSeatBilling"].mutateAndSyncSeatBilling = async (_id: string, mutate: any) => mutate(() => {});
    const add = h.load("src/utils/controllers/members/addExistingUserToProject.ts").addExistingUserToProject;
    assert.equal((await add(15, 234, 123)).ok, true);
    await add(15, 234, 123);
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].properties.invitation_id, null);
    assert.equal(h.captures[0].properties.inviter_user_id, "123");
    assert.equal(h.captures[0].properties.membership_id, String(h.members[0].id));
  });
}

test("Anyone share join passes the sharer to committed member tracking; Domain shares do not add members", async () => {
  const h = harness();
  h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
  h.projects.get(15).team = { googleAccount: { userId: 123 } };
  h.prisma.invite.updateMany = async () => ({});
  let shareType = "Anyone";
  h.prisma.taskSharing = { findFirst: async () => ({ projectId: 15, userId: 123, shareType, user: h.users.get(123) }) };
  h.mocks["@/utils/controllers/members/addExistingUserToProject"] = h.load("src/utils/controllers/members/addExistingUserToProject.ts");
  const join = h.load("src/utils/controllers/members/share.ts").default;
  assert.equal((await join(234, "share")).status, 200);
  await join(234, "share");
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.inviter_user_id, "123");
  assert.equal(h.captures[0].properties.invitation_id, null);
  shareType = "Domain";
  await join(234, "share");
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("adding an existing teammate by email tracks the committed board membership without inventing an invitation", async () => {
  const h = harness();
  const joiner = { id: 234, uid: "real_joiner", email: "joiner@example.test" };
  h.users.set(234, joiner);
  h.prisma.user.findFirst = async () => joiner;
  h.projects.get(15).members = [];
  h.projects.get(15).team = { id: "team" };
  h.prisma.team.findFirst = async () => ({ googleAccount: { userId: 123 }, members: [{ user: joiner }] });
  const result = await h.load("src/pages/api/invite/createInviteLink.ts").addMemberController(123, 15, [joiner.email]);
  assert.equal(result.status, 200);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].event, "member_joined");
  assert.equal(h.captures[0].properties.inviter_user_id, "123");
  assert.equal(h.captures[0].properties.invitation_id, null);
});

test("rolled-back direct joins never schedule a member event", async () => {
  const h = harness();
  h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
  h.projects.get(15).team = { googleAccount: { userId: 123 }, stripe_customer_id: "cus_stored" };
  h.prisma.member_Team.findFirst = async () => null;
  h.mocks["@/lib/syncSeatBilling"].mutateAndSyncSeatBilling = async (_id: string, mutate: any) => mutate(() => {});
  h.prisma.$transaction = async () => { throw Error("rollback"); };
  const result = await h.load("src/utils/controllers/members/addExistingUserToProject.ts").addExistingUserToProject(15, 234, 123);
  assert.equal(result.ok, false);
  await h.drain();
  assert.equal(h.captures.length, 0);
  assert.equal(h.jobs.length, 0);
});

test("subscription_started requires a paid invoice, records the contract and seat properties, and dedupes renewals", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/stripeAnalytics.ts");
  const retrieve = async () => subscription();
  await api.captureStripeInvoicePaid(paidEvent(), retrieve, noPaidHistory);
  await api.captureStripeInvoicePaid(paidEvent(), retrieve, noPaidHistory);
  await h.drain();
  const firstInvoice = paidEvent().data.object as any;
  await api.captureStripeInvoicePaid(paidEvent({ id: "in_renewal", created: firstInvoice.created + 2592000 }, "evt_renewal"), retrieve,
    async () => ({ data: [firstInvoice], has_more: false }));
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].distinctId, "123");
  assert.equal(h.captures[0].event, "subscription_started");
  assert.deepEqual(h.captures[0].properties, {
    ...common(123, "subscription_started:sub_paid"), occurred_at: new Date(1769999990000).toISOString(),
    stripe_event_id: "evt_paid", stripe_customer_id: "cus_stored", subscription_id: "sub_paid", invoice_id: "in_paid",
    seats_before: 0, seats_after: 5, plan: "price_month", interval: "month", currency: "usd", discounted_amount: 3000,
    amount_paid: 3000, paid_at: new Date(1769999990000).toISOString(), is_first_subscription_for_user: true,
  });
});

for (const scenario of ["trial", "zero-invoice", "unpaid", "zero-price", "fully-discounted", "customer-mismatch"]) {
  test(`subscription_started excludes ${scenario}`, async () => {
    const h = harness();
    const sub = subscription();
    const invoice = paidEvent();
    if (scenario === "trial") sub.status = "trialing";
    if (scenario === "zero-invoice") (invoice.data.object as any).amount_paid = 0;
    if (scenario === "unpaid") (invoice.data.object as any).status = "open";
    if (scenario === "zero-price") sub.items.data.forEach((item: { price: { unit_amount: number } }) => { item.price.unit_amount = 0; });
    if (scenario === "fully-discounted") sub.discount.coupon.percent_off = 100;
    if (scenario === "customer-mismatch") sub.customer = "cus_other";
    await h.load("src/lib/telemetry/stripeAnalytics.ts").captureStripeInvoicePaid(invoice, async () => sub, noPaidHistory);
    await h.drain();
    assert.deepEqual(h.captures, []);
    assert.deepEqual(h.logs, []);
  });
}

test("a renewal of a subscription paid before analytics existed is never a new start", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/stripeAnalytics.ts");
  const earlier = { ...(paidEvent().data.object as any), id: "in_before_analytics", created: 1767000000 };
  await api.captureStripeInvoicePaid(paidEvent({ created: 1770000000 }), async () => subscription(), async () => ({ data: [earlier], has_more: false }));
  await h.drain();
  assert.deepEqual(h.captures, []);
  await api.captureStripeInvoicePaid(paidEvent({ created: 1770000000 }), async () => subscription(), async () => ({ data: [], has_more: true }));
  await h.drain();
  assert.deepEqual(h.captures, []);
});

test("first-for-user is false after another subscription was paid and null when history is cut off", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/stripeAnalytics.ts");
  const other = { ...(paidEvent().data.object as any), id: "in_other", subscription: "sub_other", created: 1767000000 };
  await api.captureStripeInvoicePaid(paidEvent({ created: 1770000000 }), async () => subscription(), async () => ({ data: [other], has_more: false }));
  await h.drain();
  assert.equal(h.captures[0].properties.is_first_subscription_for_user, false);
  await api.captureStripeInvoicePaid(paidEvent({ subscription: "sub_second" }, "evt_second"), async () => subscription({ id: "sub_second" }),
    async () => ({ data: [], has_more: true }));
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("discounted interval amount covers every item, amount-off, item coupons, and product restrictions", () => {
  const api = harness().load("src/lib/telemetry/stripeAnalytics.ts");
  assert.equal(api.subscriptionAnalyticsProperties(subscription({ discount: { coupon: { percent_off: null, amount_off: 750, currency: "usd" } } })).discounted_amount, 3250);
  const sub = subscription({ discounts: [{ source: { coupon: { percent_off: 50, amount_off: null, applies_to: { products: ["prod_two"] } } } }] });
  sub.items.data[0].discounts = [{ coupon: { percent_off: null, amount_off: 100, currency: "usd" } }];
  assert.equal(api.subscriptionAnalyticsProperties(sub).discounted_amount, 3400);
  assert.equal(api.subscriptionAnalyticsProperties(subscription({ discounts: ["unexpanded"] })).discounted_amount, null);
});

test("subscription_seats_changed uses previous event quantities, stable Stripe event key, and includes decreases", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/stripeAnalytics.ts");
  const previous = { items: { data: [{ id: "si_one", quantity: 1 }, { id: "si_two", quantity: 1 }] } };
  const evt = event();
  await api.captureStripeSubscriptionEvent(evt, subscription(), previous);
  await api.captureStripeSubscriptionEvent(evt, subscription(), previous);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assertCommon(h.captures[0].properties, 123, "subscription_seats_changed:evt_seats");
  assert.deepEqual(h.captures[0].properties, {
    ...common(123, "subscription_seats_changed:evt_seats"), occurred_at: new Date(evt.created * 1000).toISOString(),
    stripe_event_id: "evt_seats", stripe_customer_id: "cus_stored", subscription_id: "sub_paid",
    seats_before: 2, seats_after: 5, plan: "price_month", interval: "month", currency: "usd", discounted_amount: 3000,
  });
  await api.captureStripeSubscriptionEvent(event("customer.subscription.updated", "evt_decrease"), subscription(), { quantity: 7 });
  await h.drain();
  assert.equal(h.captures[1].properties.seats_before, 7);
  assert.equal(h.captures[1].properties.seats_after, 5);
  for (const previous of [undefined, { quantity: 5 }, { items: { data: [{ id: "si_one" }, { id: "si_two" }] } }]) await api.captureStripeSubscriptionEvent(evt, subscription(), previous);
  await h.drain();
  assert.equal(h.captures.length, 2);
});

test("subscription_canceled waits for actual end, uses ended_at and fixed reason, and dedupes by subscription", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/stripeAnalytics.ts");
  await api.captureStripeSubscriptionEvent(event(), subscription({ cancel_at_period_end: true }));
  await h.drain();
  assert.equal(h.captures.length, 0);
  const sub = subscription({ status: "canceled", ended_at: 1769990000, cancellation_details: { reason: "payment_failed" } });
  await api.captureStripeSubscriptionEvent(event("customer.subscription.deleted", "evt_end"), sub);
  await api.captureStripeSubscriptionEvent(event("customer.subscription.deleted", "evt_end_retry"), sub);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].event, "subscription_canceled");
  assert.deepEqual(h.captures[0].properties, {
    ...common(123, "subscription_canceled:sub_paid"), occurred_at: new Date(sub.ended_at * 1000).toISOString(),
    stripe_event_id: "evt_end", stripe_customer_id: "cus_stored", subscription_id: "sub_paid",
    seats_before: 5, seats_after: 0, plan: "price_month", interval: "month", currency: "usd", discounted_amount: 3000,
    canceled_at: new Date(sub.ended_at * 1000).toISOString(), cancellation_reason: "payment_failed",
  });
  await api.captureStripeSubscriptionEvent(event("customer.subscription.deleted", "evt_other"), subscription({ id: "sub_other", ended_at: 1769990000, cancellation_details: { reason: "personal free text" } }));
  await h.drain();
  assert.equal(h.captures[1].properties.cancellation_reason, "unknown");
  assert.equal(JSON.stringify(h.captures).includes("personal free text"), false);
});

test("unresolved Stripe customer emits nothing, never matches email, and warns once without personal data", async () => {
  const h = harness();
  const warnings: any[] = [];
  const warn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    h.prisma.team.findFirst = async ({ where }: any) => { assert.deepEqual(Object.keys(where), ["stripe_customer_id"]); return null; };
    await h.load("src/lib/telemetry/stripeAnalytics.ts").captureStripeInvoicePaid(paidEvent(), async () => { throw Error("must not fetch unresolved customer"); }, async () => { throw Error("must not list unresolved customer"); });
    await h.drain();
    assert.deepEqual(h.captures, []);
    assert.deepEqual(h.logs, []);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.stringify(warnings).includes("cus_stored"), false);
  } finally { console.warn = warn; }
});

for (const kind of ["invite", "join", "paid", "seats", "canceled"]) {
  test(`${kind}: eligibility excludes analytics and failed capture retries with the same UUID`, async () => {
    const h = harness();
    h.members.push({ id: 7, userId: 123, projectId: 15, role: "Member" });
    h.projects.get(15).ownerId = 234;
    const invites = h.load("src/lib/telemetry/inviteAnalytics.ts");
    const stripe = h.load("src/lib/telemetry/stripeAnalytics.ts");
    const record = async () => {
      if (kind === "invite") invites.recordInviteSent({ id: "invite", userId: 123, projectId: 15 }, "link");
      if (kind === "join") invites.recordMemberJoined(7, 123, 15);
      if (kind === "paid") await stripe.captureStripeInvoicePaid(paidEvent(), async () => subscription(), noPaidHistory);
      if (kind === "seats") await stripe.captureStripeSubscriptionEvent(event(), subscription(), { quantity: 1 });
      if (kind === "canceled") await stripe.captureStripeSubscriptionEvent(event("customer.subscription.deleted"), subscription({ ended_at: 1769990000 }));
    };
    h.setEnabled(false);
    await record(); await h.drain();
    assert.equal(h.captures.length, 0);
    assert.equal(h.logs.length, 0);
    h.setEnabled(true); h.setFailure("capture");
    if (["paid", "seats", "canceled"].includes(kind)) await assert.rejects(record(), /mock capture unavailable/);
    else await record();
    await h.drain();
    assert.equal(h.logs.length, 0);
    const uuid = h.captureAttempts[0].uuid;
    h.setFailure(null);
    await record(); await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captureAttempts[1].uuid, uuid);
    await record(); await h.drain();
    assert.equal(h.captures.length, 1);
  });
}

function response() {
  return { code: 0, body: null as any, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

function webhook(h: ReturnType<typeof harness>, evt: Stripe.Event, retrieve: any = async () => subscription()) {
  const calls: any[] = [];
  h.mocks["raw-body"] = { default: async () => Buffer.from("verified fixture") };
  h.mocks["stripe"] = { Stripe: class { events = { retrieve: async () => evt }; webhooks = { constructEvent: () => evt }; subscriptions = { retrieve }; invoices = { list: noPaidHistory }; } };
  h.mocks["@/utils/controllers/stripe/webhook/onCheckoutSuccess"] = { default: async (...args: any[]) => { calls.push(["checkout", ...args]); } };
  h.mocks["@/utils/controllers/stripe/webhook/onSubscriptionUpdated"] = { default: async (...args: any[]) => { calls.push(["update", ...args]); } };
  return { calls, handle: h.load("src/pages/api/stripe/webhook.ts").default };
}

for (const failure of ["capture", "database", "constructor", "schedule"] as const) {
  test(`verified webhook keeps response and billing calls unchanged when analytics ${failure} throws`, async () => {
    for (const type of ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"]) {
      const h = harness();
      h.setFailure(failure);
      const sub = subscription({ ended_at: 1769990000 });
      const evt = type === "invoice.paid" ? paidEvent() : event(type, "evt_response", sub, { quantity: 1 });
      const { calls, handle } = webhook(h, evt, async () => sub);
      const res = response();
      await assert.doesNotReject(handle({ headers: { "stripe-signature": "verified" } }, res));
      assert.equal(res.code, 200);
      assert.deepEqual(res.body, { message: "success" });
      assert.equal(calls.length, type === "invoice.paid" ? 0 : 1);
      await assert.doesNotReject(h.drain());
    }
  });
}

test("webhook passes previous_attributes through and returns without awaiting a stalled analytics lookup", async () => {
  const h = harness();
  let release!: (team: any) => void;
  let started!: () => void;
  const lookupStarted = new Promise<void>((resolve) => { started = resolve; });
  h.prisma.team.findFirst = () => new Promise((resolve) => { release = resolve; started(); });
  const evt = event("customer.subscription.updated", "evt_nonblocking", subscription(), { quantity: 2 });
  const { handle } = webhook(h, evt);
  const res = response();
  await handle({ headers: { "stripe-signature": "verified" } }, res);
  assert.equal(res.code, 200);
  assert.equal(h.captures.length, 0);
  await lookupStarted;
  release({ id: "team", googleAccount: { userId: 123 } });
  await h.drain();
  assert.equal(h.captures[0].properties.seats_before, 2);
});

test("paid webhook returns without awaiting analytics-only Stripe retrieval", async () => {
  const h = harness();
  let release!: (sub: any) => void;
  let started!: () => void;
  const retrieving = new Promise<void>((resolve) => { started = resolve; });
  const { handle } = webhook(h, paidEvent(), () => new Promise((resolve) => { release = resolve; started(); }));
  const res = response();
  await handle({ headers: { "stripe-signature": "verified" } }, res);
  assert.equal(res.code, 200);
  await retrieving;
  assert.equal(h.captures.length, 0);
  release(subscription());
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("invite requests return before analytics eligibility resolves", async () => {
  const h = harness();
  let released = false;
  const pending: ((enabled: boolean) => void)[] = [];
  h.mocks["@/lib/flags"].isFeatureEnabled = (key: string) => key === "htpr-7272-payment-login-agent-events" ? Promise.resolve(false) : released ? Promise.resolve(true) : new Promise((resolve) => { pending.push(resolve); });
  const result = await h.load("src/utils/api/invite/generatePublicInviteController.ts").getInviteFromProjectId(15, 123);
  assert.ok(result.inviteLink);
  assert.equal(h.captures.length, 0);
  released = true;
  pending.forEach((resolve) => resolve(true));
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("with the HTPR-7268 flag off, invites keep the legacy events and Stripe sends nothing", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7268-invite-seat-analytics", false);
  h.users.set(234, { id: 234, uid: "real_joiner", email: "joiner@example.test" });
  h.members.push({ id: 7, projectId: 15, userId: 234, agentId: null, role: "Member", acceptedAt: new Date(1769999000000) });
  const invites = h.load("src/lib/telemetry/inviteAnalytics.ts");
  const stripe = h.load("src/lib/telemetry/stripeAnalytics.ts");
  invites.recordInviteSent({ id: "invitation", userId: 123, projectId: 15 }, "email");
  invites.recordMemberJoined(7, 234, 15, "invitation", 123);
  invites.recordMemberJoined(7, 234, 15);
  await stripe.captureStripeInvoicePaid(paidEvent(), async () => subscription(), noPaidHistory);
  await stripe.captureStripeSubscriptionEvent(event(), subscription(), { quantity: 1 });
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => [capture.event, capture.distinctId, capture.properties]).sort(), [
    ["invite_accepted", "123", { inviteeId: 234 }],
    ["teammate_invited", "123", { method: "email" }],
  ]);
});

test("first-for-user is unknown when the billed user owns another billed workspace", async () => {
  const h = harness();
  const findTeam = h.prisma.team.findFirst;
  h.prisma.team.findFirst = async (args: any) => typeof args.where.stripe_customer_id === "object" ? { id: "other-team" } : findTeam(args);
  await h.load("src/lib/telemetry/stripeAnalytics.ts").captureStripeInvoicePaid(paidEvent(), async () => subscription(), noPaidHistory);
  await h.drain();
  assert.equal(h.captures[0].properties.is_first_subscription_for_user, null);
});

test("an invoice paid earlier wins over one created earlier but paid later", async () => {
  const h = harness();
  const createdFirstPaidLater = { ...(paidEvent().data.object as any), id: "in_created_first", created: 1760000000, status_transitions: { paid_at: 1770000500 } };
  await h.load("src/lib/telemetry/stripeAnalytics.ts").captureStripeInvoicePaid(paidEvent({ created: 1765000000 }), async () => subscription(),
    async () => ({ data: [createdFirstPaidLater], has_more: false }));
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.invoice_id, "in_paid");
});

test("with the flag off, legacy teammate_invited keeps the original caller attribution", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7268-invite-seat-analytics", false);
  h.users.set(234, { id: 234, uid: "real_resender", email: "resender@example.test" });
  h.load("src/lib/telemetry/inviteAnalytics.ts").recordInviteSent({ id: "invitation", userId: 123, projectId: 15 }, "email", 123, 234);
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => [capture.event, capture.distinctId]), [["teammate_invited", "234"]]);
});

test("an earlier one-off invoice does not make the first subscription a repeat", async () => {
  const h = harness();
  const oneOff = { ...(paidEvent().data.object as any), id: "in_one_off", subscription: null, created: 1767000000, status_transitions: { paid_at: 1767000000 } };
  await h.load("src/lib/telemetry/stripeAnalytics.ts").captureStripeInvoicePaid(paidEvent(), async () => subscription(), async () => ({ data: [oneOff], has_more: false }));
  await h.drain();
  assert.equal(h.captures[0].properties.is_first_subscription_for_user, true);
});
