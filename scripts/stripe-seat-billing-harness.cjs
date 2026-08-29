#!/usr/bin/env node
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const dotenv = require("dotenv");
const jitiFactory = require("jiti");
const { assertSafeHarnessConfig } = require("./lib/stripe-harness-guards.cjs");

const root = path.resolve(__dirname, "..");
const envFile = path.resolve(
  process.env.STRIPE_HARNESS_ENV_FILE || path.join(root, ".env.local"),
);
dotenv.config({ path: envFile, override: true });

assertSafeHarnessConfig({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  confirmation: process.env.STRIPE_HARNESS_CONFIRM,
});

process.env.NODE_ENV = "development";
const jiti = jitiFactory(
  path.join(root, "scripts/stripe-seat-billing-harness.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const { stripe } = jiti(path.join(root, "src/lib/subscription.ts"));
const { syncSeatBillingOnJoin } = jiti(
  path.join(root, "src/lib/syncSeatBilling.ts"),
);
const passthroughSeatBillingLock = async (_teamId, run) => run(() => {});

const runId = `htpr4848-${Date.now()}-${randomUUID()}`;
const metadata = { hypertask_harness: "HTPR-4848", run_id: runId };
const unitAmount = 2_000;
const teamId = `${runId}-team`;
const resources = {
  customerId: null,
  productId: null,
  priceId: null,
  subscriptionId: null,
};
let receivedSignal = null;
let cleanupPromise = null;

function handleSignal(signal) {
  receivedSignal = signal;
  console.error(`${signal} received; stopping at the next safe cleanup point.`);
}

function assertNotInterrupted() {
  if (receivedSignal)
    throw new Error(`Harness interrupted by ${receivedSignal}.`);
}

process.once("SIGINT", handleSignal);
process.once("SIGTERM", handleSignal);

async function invoiceIds(customerId) {
  const page = await stripe.invoices.list({ customer: customerId, limit: 100 });
  return new Set(page.data.map((invoice) => invoice.id));
}

async function cleanup() {
  const failures = [];
  const attempt = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      failures.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const subscriptionIds = new Set(
    resources.subscriptionId ? [resources.subscriptionId] : [],
  );
  const customerIds = new Set(
    resources.customerId ? [resources.customerId] : [],
  );
  const priceIds = new Set(resources.priceId ? [resources.priceId] : []);
  const productIds = new Set(resources.productId ? [resources.productId] : []);
  const collect = async (label, list, target) => {
    await attempt(label, async () => {
      for await (const item of list()) {
        if (item.metadata?.run_id === runId) target.add(item.id);
      }
    });
  };

  await collect(
    "discover test subscriptions",
    () =>
      stripe.subscriptions.list({
        status: "all",
        limit: 100,
      }),
    subscriptionIds,
  );
  await collect(
    "discover test customers",
    () => stripe.customers.list({ limit: 100 }),
    customerIds,
  );
  await collect(
    "discover test prices",
    () => stripe.prices.list({ limit: 100 }),
    priceIds,
  );
  await collect(
    "discover test products",
    () => stripe.products.list({ limit: 100 }),
    productIds,
  );

  for (const id of subscriptionIds) {
    await attempt(`cancel test subscription ${id}`, () =>
      stripe.subscriptions.cancel(id),
    );
  }
  for (const id of customerIds) {
    await attempt(`tag retained invoices for ${id}`, async () => {
      for await (const invoice of stripe.invoices.list({
        customer: id,
        limit: 100,
      })) {
        await stripe.invoices.update(invoice.id, { metadata });
      }
    });
    await attempt(`delete test customer ${id}`, () => stripe.customers.del(id));
  }
  for (const id of priceIds) {
    await attempt(`archive test price ${id}`, () =>
      stripe.prices.update(id, { active: false }),
    );
  }
  for (const id of productIds) {
    await attempt(`archive test product ${id}`, () =>
      stripe.products.update(id, { active: false }),
    );
  }
  if (failures.length) {
    throw new Error(`Harness cleanup was incomplete:\n${failures.join("\n")}`);
  }
}

function cleanupOnce() {
  cleanupPromise ??= cleanup();
  return cleanupPromise;
}

async function main() {
  const customer = await stripe.customers.create(
    { email: `${runId}@example.invalid`, metadata },
    { idempotencyKey: `${runId}:customer` },
  );
  resources.customerId = customer.id;
  assertNotInterrupted();

  const paymentMethod = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  const product = await stripe.products.create(
    { name: `Hypertask seat harness ${runId}`, metadata },
    { idempotencyKey: `${runId}:product` },
  );
  resources.productId = product.id;
  assertNotInterrupted();
  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: "eur",
      unit_amount: unitAmount,
      recurring: { interval: "month" },
      metadata,
    },
    { idempotencyKey: `${runId}:price` },
  );
  resources.priceId = price.id;
  assertNotInterrupted();
  const subscription = await stripe.subscriptions.create(
    {
      customer: customer.id,
      default_payment_method: paymentMethod.id,
      items: [{ price: price.id, quantity: 5 }],
      payment_behavior: "error_if_incomplete",
      metadata,
    },
    { idempotencyKey: `${runId}:subscription` },
  );
  resources.subscriptionId = subscription.id;
  assertNotInterrupted();
  const subscriptionItem = subscription.items.data[0];
  assert.ok(subscriptionItem, "Stripe must return the subscription item");

  let team = {
    totalSeats: 6,
    activeSubscriptionPlanItemId: subscriptionItem.id,
    compedUntil: null,
    subscriptionPlan: [
      { subscriptionItemId: subscriptionItem.id, subscriptionStatus: "active" },
    ],
  };
  const adapter = {
    findTeam: async (requestedId) => (requestedId === teamId ? team : null),
    resolveQuantity: async (_requestedId, totalSeats) => totalSeats,
    retrieveSubscriptionItem: (id) => stripe.subscriptionItems.retrieve(id),
    updateSubscriptionItem: (id, update) =>
      stripe.subscriptionItems.update(id, update),
    reportFailure: async (error) => console.error(error.message),
  };

  const invoicesBeforeSeat = await invoiceIds(customer.id);
  assert.equal(
    await syncSeatBillingOnJoin(teamId, adapter, passthroughSeatBillingLock),
    "SEATED",
  );
  const seatedItem = await stripe.subscriptionItems.retrieve(
    subscriptionItem.id,
  );
  assert.equal(
    seatedItem.quantity,
    6,
    "the sixth accepted seat must be billed",
  );
  const invoicePage = await stripe.invoices.list({
    customer: customer.id,
    limit: 100,
  });
  const seatInvoices = invoicePage.data.filter(
    (invoice) => !invoicesBeforeSeat.has(invoice.id),
  );
  assert.equal(
    seatInvoices.length,
    1,
    "one seat change must create exactly one invoice",
  );
  const seatLines = seatInvoices[0].lines.data.filter(
    (line) => line.price?.id === price.id && line.proration,
  );
  assert.equal(
    seatLines.length,
    seatInvoices[0].lines.data.length,
    "every invoice line must be a proration at the subscription's actual price",
  );
  const netProration = seatLines.reduce(
    (total, line) => total + line.amount,
    0,
  );
  assert.ok(netProration > 0, "the added seat must have a positive net charge");
  assert.ok(
    netProration <= unitAmount,
    "the prorated seat charge cannot exceed the plan's monthly unit amount",
  );
  assert.equal(
    seatInvoices[0].amount_paid,
    netProration,
    "the invoice must equal the net seat proration",
  );

  const invoicesBeforeComp = await invoiceIds(customer.id);
  team = {
    ...team,
    totalSeats: 7,
    compedUntil: new Date(Date.now() + 86_400_000),
  };
  assert.equal(
    await syncSeatBillingOnJoin(teamId, adapter, passthroughSeatBillingLock),
    "SKIPPED",
  );
  const compedItem = await stripe.subscriptionItems.retrieve(
    subscriptionItem.id,
  );
  assert.equal(
    compedItem.quantity,
    6,
    "a comped team must not change Stripe quantity",
  );
  assert.deepEqual(
    await invoiceIds(customer.id),
    invoicesBeforeComp,
    "a comped join must not create an invoice",
  );

  console.log(
    "Stripe seat-billing harness passed: one paid seat invoice, zero comped updates.",
  );
}

(async () => {
  let primaryError;
  try {
    await main();
  } catch (error) {
    primaryError = error;
  }
  try {
    await cleanupOnce();
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else console.error(cleanupError);
  }
  process.removeListener("SIGINT", handleSignal);
  process.removeListener("SIGTERM", handleSignal);
  if (primaryError) throw primaryError;
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
