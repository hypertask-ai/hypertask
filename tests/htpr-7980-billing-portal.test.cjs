const assert = require("node:assert/strict");
const path = require("node:path");
const { test, beforeEach } = require("node:test");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const priceIds = ["price_byok_month", "price_byok_year", "price_pro_month", "price_pro_year"];
for (const [index, name] of ["MONTHLY_PRICE_ID_BYOK", "YEARLY_PRICE_ID_BYOK", "MONTHLY_PRICE_ID_PRO", "YEARLY_PRICE_ID_PRO"].entries()) {
  process.env[`NEXT_PUBLIC_STRIPE_${name}`] = priceIds[index];
}
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
function stub(rel, exports) {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
let user, team, enabled, flagLookups, retrieved, sessions, legacy;
let configuration;
const validConfiguration = () => ({
  id: "bpc_dedicated", active: true, is_default: false, livemode: false,
  metadata: { ticket: "HTPR-7980" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email"] },
    invoice_history: { enabled: true }, payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true, default_allowed_updates: ["price"],
      products: [{ product: "prod_byok", prices: priceIds.slice(0, 2), adjustable_quantity: { enabled: false } },
        { product: "prod_pro", prices: priceIds.slice(2), adjustable_quantity: { enabled: false } }],
      proration_behavior: "create_prorations", billing_cycle_anchor: "unchanged",
      trial_update_behavior: "continue_trial", schedule_at_period_end: { conditions: [] },
    },
  },
});
stub("src/lib/auth/serverUser.ts", { getServerCookieUser: async () => user });
stub("src/lib/prisma.ts", { default: { team: { findUnique: async () => team } } });
stub("src/lib/flags.ts", { isFeatureEnabled: async (_key, userId) => { flagLookups.push(userId); return enabled; } });
stub("src/lib/subscription.ts", { generateCustomerPortalLink: async (customerId) => { legacy.push(customerId); return "https://billing.stripe.test/legacy"; } });
stub("src/lib/stripe.ts", { getStripeInstance: () => ({ billingPortal: {
  configurations: { retrieve: async (id, params) => { retrieved.push({ id, ...params }); return configuration; } },
  sessions: { create: async (params) => { sessions.push(params); return { url: "https://billing.stripe.test/dedicated" }; } },
} }) });
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const policy = jiti(path.join(root, "src/lib/stripeBillingPortal.ts"));
const { GET, POST } = jiti(path.join(root, "src/app/api/stripe/billing-portal/route.ts"));
const request = (body = { teamId: "team_owned" }) => new Request("https://app.hypertask.ai/api/stripe/billing-portal", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});
beforeEach(() => {
  user = { id: 985, accountId: "account_owned" };
  team = { googleAccount: { userId: 985 }, googleAccountId: "account_owned", stripe_customer_id: "cus_owned" };
  enabled = true; flagLookups = []; retrieved = []; sessions = []; legacy = [];
  configuration = validConfiguration();
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_dedicated";
});
test("owned team uses only the explicit validated configuration and trusted customer", async () => {
  const response = await POST(request({ teamId: "team_owned", customer: "cus_attacker", configuration: "bpc_attacker" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: "https://billing.stripe.test/dedicated" });
  assert.deepEqual(flagLookups, [985]);
  assert.deepEqual(retrieved, [{ id: "bpc_dedicated", expand: ["features.subscription_update.products"] }]);
  assert.deepEqual(sessions, [{ customer: "cus_owned", configuration: "bpc_dedicated", return_url: "https://app.hypertask.ai/settings/billing" }]);
  assert.deepEqual(legacy, []);
});
test("untrusted caller cannot resolve flag, config, customer or portal session", async () => {
  user = { id: 42, accountId: "account_other" };
  assert.equal((await POST(request())).status, 403);
  assert.deepEqual([flagLookups, retrieved, sessions, legacy], [[], [], [], []]);
  user = null;
  assert.equal((await POST(request())).status, 401);
});
test("owner linked through the authenticated account remains allowed", async () => {
  user.id = 986;
  assert.equal((await POST(request())).status, 200);
  assert.equal(sessions.length, 1);
});
test("flag off retains the legacy portal and never fetches a new config", async () => {
  enabled = false;
  assert.equal((await POST(request())).status, 200);
  assert.deepEqual(legacy, ["cus_owned"]);
  assert.deepEqual(retrieved, []);
  assert.deepEqual(sessions, []);
});
test("missing dedicated config refuses rather than falling back to default", async () => {
  delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  assert.equal((await POST(request())).status, 503);
  assert.deepEqual([retrieved, sessions, legacy], [[], [], []]);
});
for (const [name, mutate] of [
  ["default config", (c) => { c.is_default = true; }],
  ["inactive config", (c) => { c.active = false; }],
  ["unrelated config", (c) => { c.metadata.ticket = "OTHER"; }],
  ["quantity updates", (c) => { c.features.subscription_update.default_allowed_updates.push("quantity"); }],
  ["adjustable product quantity", (c) => { c.features.subscription_update.products[0].adjustable_quantity.enabled = true; }],
  ["immediate cancellation", (c) => { c.features.subscription_cancel.mode = "immediately"; }],
  ["trial ending", (c) => { c.features.subscription_update.trial_update_behavior = "end_trial"; }],
  ["unapproved credit policy", (c) => { c.features.subscription_update.proration_behavior = "none"; }],
  ["reset billing anchor", (c) => { c.features.subscription_update.billing_cycle_anchor = "now"; }],
  ["deferred schedule", (c) => { c.features.subscription_update.schedule_at_period_end.conditions.push({ type: "decreasing_item_amount" }); }],
  ["missing BYOK choice", (c) => { c.features.subscription_update.products.shift(); }],
  ["unexpected price", (c) => { c.features.subscription_update.products[0].prices.push("price_unknown"); }],
  ["missing invoices", (c) => { c.features.invoice_history.enabled = false; }],
  ["missing card management", (c) => { c.features.payment_method_update.enabled = false; }],
  ["other customer edits", (c) => { c.features.customer_update.allowed_updates.push("address"); }],
]) test(`unsafe policy refuses ${name} before creating any session`, async () => {
  mutate(configuration);
  assert.equal((await POST(request())).status, 503);
  assert.deepEqual([sessions, legacy], [[], []]);
});
test("configuration creation selects the explicit trial, credit, cancellation and seat policy", () => {
  const params = policy.billingPortalConfiguration(validConfiguration().features.subscription_update.products);
  assert.deepEqual(params.features, validConfiguration().features);
  assert.deepEqual(params.metadata, { ticket: "HTPR-7980" });
  assert.deepEqual(policy.billingPortalPriceIds(), priceIds);
});
test("provisioner rejects live keys before touching Stripe", async () => {
  const { provisionTestBillingPortal } = await import(pathToFileURL(path.join(root, "scripts/provision-stripe-billing-portal.mjs")));
  process.env.STRIPE_SECRET_KEY = "sk_live_refused_fixture";
  await assert.rejects(provisionTestBillingPortal("/unused"), /live provisioning is forbidden/);
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
});

test("portal availability requires sign-in and never calls Stripe", async () => {
  user = null;
  assert.equal((await GET()).status, 401);
  assert.deepEqual([flagLookups, retrieved, sessions, legacy], [[], [], [], []]);
});
for (const [name, value, available] of [
  ["missing configuration", undefined, false],
  ["blank configuration", "  ", false],
  ["invalid configuration", "not_a_configuration", false],
  ["configured portal", " bpc_dedicated ", true],
]) test(`portal availability reports ${name} without exposing the ID`, async () => {
  if (value === undefined) delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  else process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID = value;
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual([retrieved, sessions, legacy], [[], [], []]);
});
test("portal availability respects the server ticket flag", async () => {
  enabled = false;
  const response = await GET();
  assert.deepEqual(await response.json(), { available: false });
  assert.deepEqual([retrieved, sessions, legacy], [[], [], []]);
});
