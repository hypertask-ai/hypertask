import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function provisionTestBillingPortal(output) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("Stripe test key required; live provisioning is forbidden");
  if (!output) throw new Error("An evidence output path is required");
  const Stripe = require("stripe");
  const stripe = new Stripe(key, { apiVersion: "2023-08-16" });
  const before = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  assert.equal(before.data.length, 1, "Existing test default required; never create the first/default configuration");
  assert.equal(before.data[0].livemode, false);
  const products = [];
  const priceIds = [];
  for (const [plan, amounts] of [["BYOK", [1000, 9600]], ["Pro", [2000, 19200]]]) {
    const product = await stripe.products.create({
      name: `HTPR-7980 test ${plan}`, metadata: { ticket: "HTPR-7980" },
    }, { idempotencyKey: `htpr-7980-product-${plan}-v1` });
    assert.equal(product.livemode, false);
    const prices = [];
    for (const [index, interval] of ["month", "year"].entries()) {
      const price = await stripe.prices.create({
        product: product.id, currency: "usd", unit_amount: amounts[index],
        recurring: { interval }, metadata: { ticket: "HTPR-7980" },
      }, { idempotencyKey: `htpr-7980-price-${plan}-${interval}-v1` });
      assert.equal(price.livemode, false);
      prices.push(price.id);
      priceIds.push(price.id);
      process.env[`NEXT_PUBLIC_STRIPE_${interval === "month" ? "MONTHLY" : "YEARLY"}_PRICE_ID_${plan.toUpperCase()}`] = price.id;
    }
    products.push({ product: product.id, prices, adjustable_quantity: { enabled: false } });
  }
  const jiti = require("jiti")(import.meta.url, { alias: { "@": `${root}/src` }, interopDefault: true, moduleCache: false });
  const policy = jiti(`${root}/src/lib/stripeBillingPortal.ts`);
  const created = await stripe.billingPortal.configurations.create(
    policy.billingPortalConfiguration(products), { idempotencyKey: "htpr-7980-portal-config-v1" },
  );
  const configuration = await stripe.billingPortal.configurations.retrieve(created.id, {
    expand: ["features.subscription_update.products"],
  });
  assert.equal(configuration.livemode, false);
  policy.assertBillingPortalConfiguration(configuration, priceIds);
  const after = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  assert.deepEqual(after.data, before.data, "Default portal configuration changed");
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID = configuration.id;
  process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
  const customer = await stripe.customers.create({ name: "HTPR-7980 test fixture", email: "htpr7980-billing@example.invalid", metadata: { ticket: "HTPR-7980" } },
    { idempotencyKey: "htpr-7980-portal-customer-v3" });
  assert.equal(customer.livemode, false);
  const subscription = await stripe.subscriptions.create({
    customer: customer.id, items: [{ price: priceIds[2], quantity: 3 }],
    trial_period_days: 14, collection_method: "charge_automatically",
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    metadata: { ticket: "HTPR-7980" },
  }, { idempotencyKey: "htpr-7980-portal-trial-v3" });
  assert.equal(subscription.livemode, false);
  const coupon = await stripe.coupons.create({
    duration: "forever", percent_off: 100, metadata: { ticket: "HTPR-7980" },
  }, { idempotencyKey: "htpr-7980-portal-zero-charge-v1" });
  const activeCustomer = await stripe.customers.create({
    name: "HTPR-7980 active test fixture", email: "htpr7980-active@example.invalid", metadata: { ticket: "HTPR-7980" },
  }, { idempotencyKey: "htpr-7980-portal-active-customer-v1" });
  assert.equal(activeCustomer.livemode, false);
  const activeSubscription = await stripe.subscriptions.create({
    customer: activeCustomer.id, items: [{ price: priceIds[2], quantity: 3 }],
    discounts: [{ coupon: coupon.id }], payment_behavior: "error_if_incomplete",
    metadata: { ticket: "HTPR-7980" }, expand: ["latest_invoice"],
  }, { idempotencyKey: "htpr-7980-portal-active-subscription-v1" });
  assert.equal(activeSubscription.livemode, false);
  assert.equal(activeSubscription.status, "active");
  assert.equal(activeSubscription.latest_invoice.amount_due, 0);
  const session = await policy.createConfiguredBillingPortalSession(activeCustomer.id);
  assert.equal(session.configuration, configuration.id);
  const result = {
    mode: "test", configuration, defaultConfigurationUnchanged: true, priceIds,
    customerId: activeCustomer.id, subscriptionId: activeSubscription.id, session,
    trialCustomerId: customer.id, trialSubscriptionId: subscription.id, zeroCharge: true,
  };
  await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log("Stripe test portal provisioned; explicit policy validated; default unchanged");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  provisionTestBillingPortal(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
