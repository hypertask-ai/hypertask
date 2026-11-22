const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const slots = ["MONTHLY_PRICE_ID_BYOK", "YEARLY_PRICE_ID_BYOK", "MONTHLY_PRICE_ID_PRO", "YEARLY_PRICE_ID_PRO"];
for (const [index, slot] of slots.entries()) process.env[`NEXT_PUBLIC_STRIPE_${slot}`] = `price_choice_${index}`;

const { HTPR_9529_COMPED_PRO_BILLING_FLAG } = loadModule(
  "src/lib/flags/definitions/htpr-9529-comped-pro-billing.ts",
);
const { deriveTeamBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

let team;
let enabledFlags;
const { default: BillingSection } = loadModule(
  "src/components/Modals/Settings/BillingSection.tsx",
  {
    "@/hooks/useFlag": { useFlag: (key) => enabledFlags.has(key) },
    "@/lib/state": { useRecoilValue: () => null },
    "@/store": { currentUserAtom: {} },
    "./SettingsSectionShell": {
      default: ({ children }) => React.createElement("section", null, children),
    },
    "./SettingsCard": {
      default: ({ children }) => React.createElement("div", null, children),
    },
    "./SettingsBillingRow": {
      BillingActionRow: ({ action, label }) => React.createElement("div", null, label, action),
      BillingRow: ({ label, value }) => React.createElement(
        "div",
        null,
        React.createElement("span", null, label),
        React.createElement("span", null, value),
      ),
      settingsActionButtonClass: "",
    },
    "./settingsNavigation": { getSettingsPath: (section) => `/settings/${section}` },
    "./useSettingsTeam": {
      useSettingsTeam: () => ({
        billing: deriveTeamBilling(team),
        ownerAndMembers: { members: [], owner: null },
        project: null,
        refetchTeam: async () => team,
        team,
      }),
    },
    "@/components/Modals/OptionPicker": { default: () => null },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }) },
  },
);

const future = "2099-01-01T00:00:00.000Z";
const comped = (plan) => ({
  id: "team-comp",
  compedUntil: future,
  compedPlan: plan,
  subscriptionPlan: [],
  totalSeats: 2,
});

function page() {
  const previous = global.React;
  global.React = React;
  try {
    return renderToStaticMarkup(React.createElement(BillingSection));
  } finally {
    if (previous === undefined) delete global.React;
    else global.React = previous;
  }
}

function row(html, label) {
  const match = new RegExp(`<span>${label}</span><span>([^<]*)</span>`).exec(html);
  assert.ok(match, `Missing ${label}`);
  return match[1];
}

test("the comped billing copy is an Everyone bugfix flag", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-9529-comped-pro-billing.ts").default;
  assert.equal(HTPR_9529_COMPED_PRO_BILLING_FLAG, "htpr-9529-comped-pro-billing");
  assert.equal(definition.key, HTPR_9529_COMPED_PRO_BILLING_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, undefined);
});

test("a comped Pro team sees the plan on billing cycle, renewal and invoice", () => {
  team = comped("Pro");
  enabledFlags = new Set([HTPR_9529_COMPED_PRO_BILLING_FLAG]);
  const html = page();
  assert.equal(row(html, "Plan"), "Pro");
  assert.equal(row(html, "Billing cycle"), "Complimentary");
  assert.equal(row(html, "Renewal"), "Complimentary");
  assert.equal(row(html, "Next invoice"), "Complimentary");
  assert.match(html, /Invoice total[\s\S]*Complimentary/);
  assert.equal(html.includes("Free Plan"), false);
});

test("the same comped Pro team still says Free Plan while the fix is off", () => {
  team = comped("Pro");
  enabledFlags = new Set();
  const html = page();
  assert.equal(row(html, "Plan"), "Pro");
  assert.equal(row(html, "Billing cycle"), "Free Plan");
  assert.equal(row(html, "Renewal"), "Free Plan");
  assert.equal(row(html, "Next invoice"), "Free Plan");
  assert.match(html, /Invoice total[\s\S]*Free Plan/);
});

test("a Free team and an expired comp still say Free Plan", () => {
  enabledFlags = new Set([HTPR_9529_COMPED_PRO_BILLING_FLAG]);
  team = { id: "team-free", compedUntil: null, compedPlan: null, subscriptionPlan: [], totalSeats: 1 };
  const free = page();
  assert.equal(row(free, "Plan"), "Free");
  assert.equal(row(free, "Billing cycle"), "Free Plan");
  assert.equal(row(free, "Renewal"), "Free Plan");
  team = { ...comped("Pro"), compedUntil: "2020-01-01T00:00:00.000Z" };
  const expired = page();
  assert.equal(row(expired, "Plan"), "Free");
  assert.equal(row(expired, "Billing cycle"), "Free Plan");
  assert.match(expired, /Free Plan/);
});

test("a comped BYOK team and the internal comp team do not say Free Plan", () => {
  enabledFlags = new Set([HTPR_9529_COMPED_PRO_BILLING_FLAG]);
  team = comped("BYOK");
  const byok = page();
  assert.equal(row(byok, "Plan"), "BYOK");
  assert.equal(row(byok, "Billing cycle"), "Complimentary");
  assert.equal(byok.includes("Free Plan"), false);
  team = { id: "08f79efd-770e-4e32-9728-65e6d29ec893", subscriptionPlan: [], totalSeats: 1 };
  const internal = page();
  assert.equal(row(internal, "Plan"), "Pro");
  assert.equal(row(internal, "Renewal"), "Complimentary");
  assert.equal(row(internal, "Next invoice"), "Complimentary");
  assert.equal(internal.includes("Free Plan"), false);
});

test("a paid Pro subscription keeps its billing cycle", () => {
  enabledFlags = new Set([HTPR_9529_COMPED_PRO_BILLING_FLAG]);
  team = {
    id: "team-paid",
    compedUntil: null,
    compedPlan: null,
    activeSubscriptionPlanId: "sub_pro",
    subscriptionPlan: [{
      subscriptionId: "sub_pro",
      subscriptionStatus: "active",
      priceId: "price_1QjJeDIhmcH60VcciHzZ3mTJ",
    }],
    totalSeats: 1,
  };
  const html = page();
  assert.equal(row(html, "Plan"), "Pro");
  assert.equal(row(html, "Billing cycle"), "month");
  assert.equal(html.includes("Complimentary"), false);
});
