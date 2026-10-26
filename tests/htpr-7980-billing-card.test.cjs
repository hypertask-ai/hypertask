const assert = require("node:assert/strict");
const path = require("node:path");
const { test, beforeEach, afterEach } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const axios = require("axios");
const root = path.resolve(__dirname, "..");
const slots = ["MONTHLY_PRICE_ID_BYOK", "YEARLY_PRICE_ID_BYOK", "MONTHLY_PRICE_ID_PRO", "YEARLY_PRICE_ID_PRO"];
for (const [i, slot] of slots.entries()) process.env[`NEXT_PUBLIC_STRIPE_${slot}`] = `price_choice_${i}`;
let team, refreshedTeam, enabled, portalAvailable, availabilityError, userId, requests, redirects, refreshCount, dom, mounted;
function stub(rel, exports) {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub("src/hooks/useFlag.tsx", { useFlag: () => enabled });
const stateFile = path.join(root, "src/lib/state.tsx");
require.cache[stateFile] = { id: stateFile, filename: stateFile, loaded: true, exports: { useRecoilValue: () => ({ id: userId }) } };
stub("src/store/index.ts", { currentUserAtom: {} });
stub("src/components/Modals/Settings/SettingsSectionShell.tsx", { default: ({ children }) => React.createElement("main", null, children) });
stub("src/components/Modals/Settings/settingsNavigation.ts", { getSettingsPath: (section) => `/settings/${section}` });
stub("src/components/Modals/OptionPicker/index.tsx", { default: ({ options, onSelect }) => React.createElement("div", null,
  options.map(option => React.createElement("button", { key: option.id, onClick: () => onSelect(option) }, option.label))) });
require.cache[require.resolve("next/navigation")] = { id: require.resolve("next/navigation"), filename: require.resolve("next/navigation"), loaded: true,
  exports: { useRouter: () => ({ push() {}, refresh() {} }) } };
const jiti = require("jiti")(__filename, { interopDefault: true, jsx: true, alias: { "@": path.join(root, "src") } });
const { deriveTeamBilling } = jiti(path.join(root, "src/lib/deriveCurrentBoardBilling.ts"));
stub("src/components/Modals/Settings/useSettingsTeam.ts", { useSettingsTeam: () => ({
  billing: deriveTeamBilling(team), ownerAndMembers: { owner: { id: 985 }, members: [] },
  project: null, team, refetchTeam: async () => { refreshCount++; return refreshedTeam; },
}) });
const { settingsBillingSummary } = jiti(path.join(root, "src/lib/settingsBillingSummary.ts"));
const BillingSection = jiti(path.join(root, "src/components/Modals/Settings/BillingSection.tsx")).default;
function subscribed(status = "active", extra = {}) {
  return { ...team, activeSubscriptionPlanId: "sub_current", subscriptionPlan: [{
    subscriptionId: "sub_current", subscriptionStatus: status, priceId: "price_choice_2",
    subscriptionObject: { cancel_at_period_end: false, items: { data: [{ price: {
      id: "price_choice_2", currency: "usd", unit_amount: 2000, recurring: { interval: "month", interval_count: 1 },
    } }] }, ...extra },
  }] };
}
beforeEach(() => {
  enabled = true; portalAvailable = true; availabilityError = false; userId = 985; refreshCount = 0; requests = []; redirects = [];
  team = { id: "team_selected", title: "Selected", stripe_customer_id: "", totalSeats: 3,
    googleAccountId: "account_owned", subscriptionPlan: [], googleAccount: { userId: 985 } };
  refreshedTeam = team;
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get = async (url) => {
    if (url === "/api/stripe/billing-portal") {
      if (availabilityError) throw new Error("Unavailable");
      return { data: { available: portalAvailable } };
    }
    return { data: { customerEmail: null, invoices: [], upcomingInvoice: null } };
  };
  axios.post = async (url, body) => { requests.push({ url, body }); return { data: { url: "https://stripe.test/hosted" } }; };
});
afterEach(async () => {
  if (mounted) await React.act(async () => mounted.unmount());
  mounted = null;
  if (dom) dom.window.close();
  dom = null;
  delete global.window; delete global.document;
  delete global.React; delete global.IS_REACT_ACT_ENVIRONMENT;
});
async function render() {
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/settings/billing" });
  global.window = new Proxy(dom.window, { get(target, key) {
    if (key === "location") return { origin: "https://app.hypertask.ai", assign: (url) => redirects.push(url) };
    return Reflect.get(target, key);
  } });
  global.document = dom.window.document;
  mounted = createRoot(document.getElementById("root"));
  await React.act(async () => mounted.render(React.createElement(BillingSection)));
}
async function click(label) {
  const button = [...document.querySelectorAll("button")].find(button => button.textContent === label || button.textContent.startsWith(label));
  assert.ok(button, `Missing ${label}`);
  await React.act(async () => button.click());
}
test("Free owner sees one card, chooses any existing plan, provisions the customer, and opens checkout", async () => {
  await render();
  assert.equal(document.querySelectorAll("h3").length, 1);
  assert.match(document.body.textContent, /PlanFreePrice\$0StatusFree/);
  await click("Upgrade");
  assert.equal(document.querySelectorAll("button").length, 5);
  await click("BYOK · Annually");
  assert.deepEqual(requests, [
    { url: "/api/stripe/ensure-customer", body: { teamId: "team_selected" } },
    { url: "/api/stripe/session/checkout", body: { intent: "settings-billing-upgrade", teamId: "team_selected", priceId: "price_choice_1", mode: "Normal",
      returnUrl: "https://app.hypertask.ai/settings/billing", cancelUrl: "https://app.hypertask.ai/settings/billing" } },
  ]);
  assert.equal(refreshCount, 2);
  assert.deepEqual(redirects, ["https://stripe.test/hosted"]);
});
for (const status of ["trialing", "active", "past_due", "unpaid", "incomplete"]) test(`${status} subscription uses portal, never new-subscription checkout`, async () => {
  team = subscribed(status); team.stripe_customer_id = "cus_selected"; refreshedTeam = team;
  await render();
  assert.ok(![...document.querySelectorAll("button")].some(button => button.textContent === "Upgrade"));
  await click("Manage billing");
  assert.deepEqual(requests, [{ url: "/api/stripe/billing-portal", body: { teamId: "team_selected" } }]);
  assert.deepEqual(redirects, ["https://stripe.test/hosted"]);
});
test("an intervening subscription prevents checkout after the picker opens", async () => {
  await render(); await click("Upgrade");
  refreshedTeam = subscribed("trialing");
  await click("Pro · Monthly");
  assert.deepEqual(requests, []);
  assert.deepEqual(redirects, []);
});
test("member cannot launch billing or upgrade", async () => {
  userId = 42; team.stripe_customer_id = "cus_selected";
  await render();
  assert.ok([...document.querySelectorAll("button")].every(button => button.disabled));
  assert.match(document.body.textContent, /Team owner only/);
  assert.deepEqual(requests, []);
});
test("flag off keeps existing billing rows and controls", () => {
  enabled = false;
  const html = renderToStaticMarkup(React.createElement(BillingSection));
  assert.match(html, /Seats/); assert.match(html, /Payment/); assert.match(html, /Billing cycle/);
});
test("comped team retains its grant without an accidental new charge", () => {
  team.compedUntil = "2099-01-01"; team.compedPlan = "Pro";
  assert.deepEqual(settingsBillingSummary(team), { plan: "Pro", price: "Complimentary", status: "Complimentary", hasSubscription: false, canUpgrade: false });
});
test("active custom and cancellation snapshots use the selected row and real price", () => {
  team = subscribed("active", { cancel_at_period_end: true });
  const row = team.subscriptionPlan[0]; row.priceId = "price_custom";
  row.subscriptionObject.items.data[0].price = { id: "price_custom", currency: "eur", unit_amount: 7300, recurring: { interval: "year", interval_count: 1 } };
  team.subscriptionPlan.unshift({ subscriptionId: "sub_stale", subscriptionStatus: "canceled", priceId: "price_choice_0" });
  assert.deepEqual(settingsBillingSummary(team), { plan: "Custom plan", price: "€73.00 per user / year", status: "Cancels at period end", hasSubscription: true, canUpgrade: false });
});

test("a custom price with no saved amount never invents the public Pro price", () => {
  team = subscribed(); team.subscriptionPlan[0].priceId = "price_custom";
  team.subscriptionPlan[0].subscriptionObject = null;
  assert.deepEqual(settingsBillingSummary(team), { plan: "Custom plan", price: "See Stripe for pricing", status: "Active", hasSubscription: true, canUpgrade: false });
});
test("a terminal subscription row and stale pointer retain the unsubscribed Free path", () => {
  team = subscribed("canceled");
  assert.deepEqual(settingsBillingSummary(team), { plan: "Free", price: "$0", status: "Free", hasSubscription: false, canUpgrade: true });
});

for (const status of ["trialing", "active", "past_due"]) test(`${status} portal action stays hidden without server configuration`, async () => {
  portalAvailable = false;
  team = subscribed(status); team.stripe_customer_id = "cus_selected"; refreshedTeam = team;
  await render();
  assert.ok(![...document.querySelectorAll("button")].some(button => button.textContent === "Manage billing"));
  assert.match(document.body.textContent, /PlanProPrice/);
  assert.deepEqual(requests, []);
  assert.deepEqual(redirects, []);
});
test("portal availability errors keep the action hidden", async () => {
  availabilityError = true;
  team = subscribed(); team.stripe_customer_id = "cus_selected"; refreshedTeam = team;
  await render();
  assert.ok(![...document.querySelectorAll("button")].some(button => button.textContent === "Manage billing"));
  assert.deepEqual(requests, []);
});
test("unconfigured portal does not block existing Free checkout", async () => {
  portalAvailable = false;
  await render();
  await click("Upgrade"); await click("Pro · Monthly");
  assert.deepEqual(redirects, ["https://stripe.test/hosted"]);
});

test("portal stays hidden until availability is confirmed", async () => {
  let resolveAvailability;
  axios.get = () => new Promise(resolve => { resolveAvailability = resolve; });
  team = subscribed(); team.stripe_customer_id = "cus_selected"; refreshedTeam = team;
  await render();
  assert.ok(![...document.querySelectorAll("button")].some(button => button.textContent === "Manage billing"));
  await React.act(async () => resolveAvailability({ data: { available: true } }));
  await click("Manage billing");
  assert.deepEqual(requests, [{ url: "/api/stripe/billing-portal", body: { teamId: "team_selected" } }]);
});
