const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { load } = require("./helpers/agent-connection.cjs");

const flag = "htpr-7919-allowance-percent";
const flagModule = { HTPR_7919_ALLOWANCE_PERCENT_FLAG: flag };
const plans = load("src/lib/subscriptionPlans.ts", {
  "@/lib/freePlanLimits": load("src/lib/freePlanLimits.ts"),
});
const limits = { planLimits: false, unlimitedTickets: false };

function renderUsage(enabled, pct = 70, capped = false) {
  const data = {
    configured: true,
    fundingSource: "shared",
    allowance: {
      pct, capped, usedUsd: 3.5, remainingUsd: 1.5, budgetUsd: 5,
      resetsOn: "2026-11-01", projectedPct: 90,
    },
    includedWithHypertask: { usedUsd: 2.25 },
    models: [], features: [], boards: [], tasks: [], agents: [],
  };
  let index = 0;
  const values = [data, null, false];
  const container = ({ children, title }) => React.createElement("section", null,
    React.createElement("h2", null, title), children);
  const Screen = load("src/components/Modals/Settings/AiUsageSection.tsx", {
    react: { useState: () => [values[index++], () => {}], useEffect: () => {} },
    axios: {},
    "@/hooks/useFlag": { useFlag: name => name === flag && enabled },
    "@/lib/flags/definitions/htpr-7919-allowance-percent": flagModule,
    "./SettingsCard": { __esModule: true, default: container },
    "./SettingsSectionShell": { __esModule: true, default: container },
    "./settingsNavigation": { useSettingsNavigation: () => ({ setSettingsSection() {} }) },
    "./useSettingsTeam": { useSettingsTeam: () => ({ teamId: "team", project: null }) },
  }).default;
  return renderToStaticMarkup(Screen());
}

for (const pct of [0, 70, 95, 130]) {
  test(`usage screen shows ${pct}% without dollars, retaining reset and recovery`, () => {
    const html = renderUsage(true, pct, pct >= 100);
    assert.doesNotMatch(html, /\$/);
    assert.match(html, new RegExp(`${pct}%`));
    assert.match(html, new RegExp(`aria-valuenow="${Math.min(pct, 100)}"`));
    assert.match(html, /Resets on Nov 1/);
    assert.match(html, /on track to use ~90% this month/);
    assert.match(html, /Included with Hypertask · automatic features do not reduce your allowance/);
    assert.equal(html.includes("Review AI options"), pct >= 100);
    if (pct >= 100) assert.match(html, /Upgrade or add your own AI key to continue now/);
  });
}

test("usage rollback preserves both dollar lines", () => {
  const html = renderUsage(false);
  assert.match(html, /\$3.50 used · \$1.50 remaining of \$5.00/);
  assert.match(html, /\$2.25 Included with Hypertask/);
});

test("plan copy changes only the Pro allowance perk, never prices or limits", () => {
  const before = plans.subscriptionPlansFor(limits);
  const after = plans.subscriptionPlansFor(limits, true);
  const pro = after.find(plan => plan.id === "Pro");
  const perk = pro.perks.find(perk => perk.title === "LLM billing");
  assert.equal(perk.amount, "Included AI; add your own key for more");
  assert.doesNotMatch(perk.amount, /\$|overage|unlimited/i);
  assert.deepEqual(after.map(plan => plan.types), before.map(plan => plan.types));
  assert.deepEqual(after.filter(plan => plan.id !== "Pro"), before.filter(plan => plan.id !== "Pro"));
  assert.equal(before.find(plan => plan.id === "Pro").perks.find(perk => perk.title === "LLM billing").amount,
    "$15 of tokens / seat included (overage 1.2×)");
});

for (const corrected of [false, true]) {
  test(`trial table applies allowance copy with existing copy flag ${corrected}`, () => {
    const Screen = load("src/components/Modals/TrialPlan/TrialPlanComponents.tsx", {
      "@/components/Common/IconsGlobal": { IconsGlobal: { Check: () => null } },
      "@/lib/serverActions": {},
      "@/lib/subscriptionPlans": plans,
      "@/lib/flags/definitions/htpr-7686-free-plan-copy": { HTPR_7686_FREE_PLAN_COPY_FLAG: "copy" },
      "@/lib/flags/definitions/htpr-7919-allowance-percent": flagModule,
      "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": {},
      "@/hooks/useFlag": { useFlag: name => name === flag || (name === "copy" && corrected), useFlagReady: () => true },
      "@/lib/flags/keys": { HTPR_7551_START_PLAN_CHECKOUT_FLAG: "checkout" },
      "next/navigation": {},
    }).PlansTable;
    const html = renderToStaticMarkup(React.createElement(Screen));
    assert.doesNotMatch(html, /\$15|overage/);
    assert.match(html, /Included AI; add your own key for more/);
    assert.match(html, /Priority/);
    assert.match(html, /Your API keys/);
  });
}
