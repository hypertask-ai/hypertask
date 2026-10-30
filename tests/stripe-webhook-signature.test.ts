import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

const RealStripe = require("stripe");

const secret = "whsec_htpr8209_test_secret";
const payload = JSON.stringify({
  id: "evt_htpr8209",
  object: "event",
  api_version: "2023-08-16",
  type: "customer.created",
  created: 1770000000,
  data: { object: { id: "cus_htpr8209", object: "customer" } },
});

function signature(overrides: { timestamp?: number; secret?: string } = {}) {
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", overrides.secret ?? secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function harness() {
  const h = activationHarness();
  h.mocks["stripe"] = { Stripe: RealStripe };
  h.mocks["@/utils/controllers/stripe/webhook/onCheckoutSuccess"] = {
    default: async () => undefined,
  };
  h.mocks["@/utils/controllers/stripe/webhook/onSubscriptionUpdated"] = {
    default: async () => undefined,
  };
  return h;
}

function response() {
  const out: { status: number | null; body: unknown } = { status: null, body: null };
  const res: Record<string, unknown> = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

function request(headers: Record<string, string>) {
  const stream = Readable.from([Buffer.from(payload)]) as unknown as {
    headers: Record<string, string>;
  };
  stream.headers = headers;
  return stream as never;
}

function handler() {
  process.env.STRIPE_SECRET_KEY = "sk_test_htpr8209";
  return harness().load("src/pages/api/stripe/webhook.ts").default;
}

test("a signature that does not match the webhook secret answers 400 instead of throwing", async () => {
  process.env.WEBHOOK_SECRET_STRIPE = secret;
  const { res, out } = response();

  await handler()(
    request({ "stripe-signature": signature({ secret: "whsec_wrong_secret" }) }),
    res
  );

  assert.equal(out.status, 400);
  assert.deepEqual(out.body, { message: "invalid signature" });
});

test("a stale signature answers 400", async () => {
  process.env.WEBHOOK_SECRET_STRIPE = secret;
  const { res, out } = response();
  const stale = Math.floor(Date.now() / 1000) - 3600;

  await handler()(request({ "stripe-signature": signature({ timestamp: stale }) }), res);

  assert.equal(out.status, 400);
  assert.deepEqual(out.body, { message: "invalid signature" });
});

test("a request without a signature header answers 400 instead of hanging", async () => {
  process.env.WEBHOOK_SECRET_STRIPE = secret;
  const { res, out } = response();

  await handler()(request({}), res);

  assert.equal(out.status, 400);
  assert.deepEqual(out.body, { message: "missing signature" });
});

test("a missing webhook secret is reported as a server fault, not a signature mismatch", async () => {
  delete process.env.WEBHOOK_SECRET_STRIPE;
  const { res, out } = response();

  await handler()(request({ "stripe-signature": signature() }), res);

  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { message: "webhook secret is not configured" });
});

test("a valid signature for an unhandled event type answers 200", async () => {
  process.env.WEBHOOK_SECRET_STRIPE = secret;
  const { res, out } = response();

  await handler()(request({ "stripe-signature": signature() }), res);

  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { message: "success" });
});
