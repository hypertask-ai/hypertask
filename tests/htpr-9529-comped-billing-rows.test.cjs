const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const axios = require("axios");
const { loadModule } = require("./helpers/loadModule.cjs");

const slots = ["MONTHLY_PRICE_ID_BYOK", "YEARLY_PRICE_ID_BYOK", "MONTHLY_PRICE_ID_PRO", "YEARLY_PRICE_ID_PRO"];
for (const [i, slot] of slots.entries()) process.env[`NEXT_PUBLIC_STRIPE_${slot}`] = `price_choice_${i}`;
const PAID_BYOK_PRICE = "price_choice_0";
const PAID_PRO_PRICE = "price_choice_2";
const COMPED_ROWS_FLAG = "htpr-9529-comped-billing-rows";

const compedUntil = new Date("2099-01-01T12:00:00.000Z");
const expiredComp = new Date("2020-01-01T12:00:00.000Z");
const upcomingPeriodEnd = 1793000000;
const expectedDate = (seconds) =>
  new Date(seconds * 1000).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

let team, dom, mounted, billingData, compedRows;
const { deriveTeamBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");
const { default: BillingSection } = loadModule("src/components/Modals/Settings/BillingSection.tsx", {
  "@/components/Modals/OptionPicker": { default: () => null },
  "@/hooks/useFlag": { useFlag: (key) => (key === COMPED_ROWS_FLAG ? compedRows : false) },
  "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
  "@/store": { currentUserAtom: {} },
  "./SettingsSectionShell": { default: ({ children }) => React.createElement("main", null, children) },
  "./settingsNavigation": { getSettingsPath: (section) => `/settings/${section}` },
  "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }) },
  "./useSettingsTeam": { useSettingsTeam: () => ({
    billing: deriveTeamBilling(team),
    ownerAndMembers: { owner: { id: 985 }, members: [] },
    project: null,
    team,
    refetchTeam: async () => team,
  }) },
});

function subscribed(priceId = PAID_PRO_PRICE, status = "active") {
  return {
    ...team,
    activeSubscriptionPlanId: "sub_current",
    subscriptionPlan: [{
      subscriptionId: "sub_current",
      subscriptionStatus: status,
      priceId,
      subscriptionObject: { cancel_at_period_end: false, items: { data: [{ price: {
        id: priceId, currency: "usd", unit_amount: 2000, recurring: { interval: "month", interval_count: 1 },
      } }] } },
    }],
  };
}

beforeEach(() => {
  compedRows = true;
  team = {
    id: "team_selected",
    title: "Selected",
    stripe_customer_id: "",
    totalSeats: 3,
    googleAccountId: "account_owned",
    subscriptionPlan: [],
    googleAccount: { userId: 985 },
  };
  billingData = {
    customerEmail: "billing@example.invalid",
    invoices: [],
    upcomingInvoice: {
      amountDue: 2000, subtotal: 2000, discountTotal: 0, created: upcomingPeriodEnd,
      currency: "usd", nextPaymentAttempt: upcomingPeriodEnd, periodEnd: upcomingPeriodEnd,
    },
  };
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get = async (url) => {
    if (url === "/api/stripe/billing-portal") return { data: { available: false } };
    return { data: billingData };
  };
});

afterEach(async () => {
  if (mounted) await React.act(async () => mounted.unmount());
  mounted = null;
  if (dom) dom.window.close();
  dom = null;
  delete global.window;
  delete global.document;
  delete global.React;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

async function render() {
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/settings/billing" });
  global.window = dom.window;
  global.document = dom.window.document;
  mounted = createRoot(document.getElementById("root"));
  await React.act(async () => mounted.render(React.createElement(BillingSection)));
}

function labelSpan(label) {
  const span = [...document.querySelectorAll("span")].find((candidate) => candidate.textContent === label);
  assert.ok(span, `Missing row ${label}`);
  return span;
}

function rowValue(label) {
  return labelSpan(label).nextElementSibling?.textContent;
}

function actionRowValue(label) {
  const spans = labelSpan(label).parentElement.querySelectorAll("span");
  return spans[spans.length - 1]?.textContent;
}

test("a comped Pro team never reads Free Plan on any billing row", async () => {
  team.compedUntil = compedUntil;
  team.compedPlan = "Pro";

  await render();

  assert.equal(rowValue("Plan"), "Pro");
  assert.equal(rowValue("Billing cycle"), "Comped");
  assert.equal(rowValue("Renewal"), expectedDate(compedUntil.getTime() / 1000));
  assert.equal(rowValue("Next invoice"), "Not billed");
  assert.equal(actionRowValue("Invoice total"), "—");
  assert.match(document.body.textContent, /No invoices needed on a comped plan/);
  assert.doesNotMatch(document.body.textContent, /Free Plan/);
});

test("with the switch off a comped Pro team reads the old rows", async () => {
  compedRows = false;
  team.compedUntil = compedUntil;
  team.compedPlan = "Pro";

  await render();

  assert.equal(rowValue("Plan"), "Pro");
  assert.equal(rowValue("Billing cycle"), "Free Plan");
  assert.equal(rowValue("Next invoice"), "Free Plan");
});

test("a normal Free team still reads Free Plan", async () => {
  await render();

  assert.equal(rowValue("Plan"), "Free");
  assert.equal(rowValue("Billing cycle"), "Free Plan");
  assert.equal(rowValue("Renewal"), "Free Plan");
  assert.equal(rowValue("Next invoice"), "Free Plan");
  assert.match(document.body.textContent, /No invoices found/);
});

test("a paid Pro team outranks a BYOK comp and keeps every subscription row", async () => {
  team = subscribed();
  team.stripe_customer_id = "cus_selected";
  team.compedPlan = "BYOK";
  team.compedUntil = compedUntil;

  await render();

  assert.equal(rowValue("Plan"), "Pro");
  assert.equal(rowValue("Billing cycle"), "month");
  assert.equal(rowValue("Renewal"), expectedDate(upcomingPeriodEnd));
  assert.equal(rowValue("Next invoice"), expectedDate(upcomingPeriodEnd));
  assert.equal(actionRowValue("Invoice total"), "$20.00");
  assert.doesNotMatch(document.body.textContent, /Comped/);
  assert.doesNotMatch(document.body.textContent, /Not billed/);
});

test("a Pro comp outranks a paid BYOK team and owns the rows", async () => {
  team = subscribed(PAID_BYOK_PRICE);
  team.stripe_customer_id = "cus_selected";
  team.compedPlan = "Pro";
  team.compedUntil = compedUntil;

  await render();

  assert.equal(rowValue("Plan"), "Pro");
  assert.equal(rowValue("Billing cycle"), "Comped");
  assert.equal(rowValue("Renewal"), expectedDate(compedUntil.getTime() / 1000));
  assert.doesNotMatch(document.body.textContent, /Free Plan/);
});

test("an expired comp falls back to the plan the team really has", async () => {
  team.compedPlan = "Pro";
  team.compedUntil = expiredComp;

  await render();

  assert.equal(rowValue("Plan"), "Free");
  assert.equal(rowValue("Billing cycle"), "Free Plan");
  assert.doesNotMatch(document.body.textContent, /Comped/);
});

test("a comped plan name without a comped-until date is not a comp", async () => {
  team.compedPlan = "Pro";

  await render();

  assert.equal(rowValue("Plan"), "Free");
  assert.equal(rowValue("Billing cycle"), "Free Plan");
  assert.doesNotMatch(document.body.textContent, /Comped/);
});

test("a paid Pro team keeps its subscription rows", async () => {
  team = subscribed();
  team.stripe_customer_id = "cus_selected";
  billingData.invoices = [{
    amountPaid: 2000, cardBrand: "visa", cardLast4: "4242", created: upcomingPeriodEnd,
    currency: "usd", hostedInvoiceUrl: "https://stripe.test/invoice", id: "invoice_paid",
    paymentMethodType: "card", status: "paid",
  }];

  await render();

  assert.equal(rowValue("Plan"), "Pro");
  assert.equal(rowValue("Billing cycle"), "month");
  assert.equal(rowValue("Renewal"), expectedDate(upcomingPeriodEnd));
  assert.equal(actionRowValue("Invoice total"), "$20.00");
  assert.equal(document.querySelector('a[href="https://stripe.test/invoice"]').textContent, "View");
  assert.doesNotMatch(document.body.textContent, /Free Plan/);
});
