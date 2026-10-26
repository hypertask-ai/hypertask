const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { createJiti } = require("jiti");
const { load } = require("./helpers/agent-connection.cjs");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});

const limits = jiti(path.join(root, "src/lib/freePlanLimits.ts"));
const plans = jiti(path.join(root, "src/lib/subscriptionPlans.ts"));
const previousReact = global.React;
global.React = React;
process.on("exit", () => {
  if (previousReact === undefined) delete global.React;
  else global.React = previousReact;
});

const legacy = { planLimits: false, unlimitedTickets: false };
const capped = { planLimits: true, unlimitedTickets: false };
const boardsAndFilesOnly = { planLimits: true, unlimitedTickets: true };

function text(flags, showCopy = true) {
  const lines = limits.visibleFreePlanCopy(showCopy, flags);
  return renderToStaticMarkup(React.createElement("span", null, lines.map((line) => React.createElement("span", { key: line }, line))))
    .replace(/&#x27;|&#39;|&apos;/g, "'");
}

function freeAmounts(flags) {
  return plans.subscriptionPlansFor(flags)
    .find((plan) => plan.id === "Free")
    .perks
    .filter((perk) => ["Boards", "Open tickets", "Files", "Teams already over a limit"].includes(perk.title))
    .map((perk) => perk.amount);
}

test("free plan lines stay hidden until the copy flag is on", () => {
  assert.deepEqual(limits.visibleFreePlanCopy(false, legacy), []);
  assert.deepEqual(limits.visibleFreePlanCopy(false, capped), []);
  assert.equal(text(capped, false).includes("Up to 2 boards"), false);
  assert.equal(text(legacy, false).includes("Unlimited tickets"), false);
  assert.deepEqual(limits.visibleFreePlanCopy(true, legacy), limits.freePlanLimitCopy(legacy));
});

test("free plan copy with the limits flag off matches the legacy rule and states no file size", () => {
  const lines = limits.freePlanLimitCopy(legacy);
  assert.deepEqual(lines, [
    "Up to 3 boards (archived don't count)",
    "Unlimited tickets",
  ]);
  assert.equal(lines[0], `Up to ${limits.FREE_BOARD_LIMIT} boards (archived don't count)`);
  assert.equal(text(legacy).includes("Up to 3 boards"), true);
  assert.equal(text(legacy).includes("Unlimited tickets"), true);
  assert.equal(/MB|250|Up to 2 boards/.test(text(legacy)), false);
  assert.deepEqual(freeAmounts(legacy), lines);
  assert.deepEqual(freeAmounts({ planLimits: false, unlimitedTickets: true }), lines);
});

test("free plan copy with the limits flag on uses the enforced board, ticket and file values", () => {
  const lines = limits.freePlanLimitCopy(capped);
  const megabytes = limits.FREE_PLAN_MAX_FILE_BYTES / (1024 * 1024);
  assert.deepEqual(lines.slice(0, 3), [
    `Up to ${limits.FREE_PLAN_MAX_BOARDS} boards (archived don't count)`,
    `Up to ${limits.FREE_PLAN_MAX_TICKETS} open tickets`,
    `Up to ${megabytes} MB each on tickets and comments`,
  ]);
  assert.equal(lines[0], "Up to 2 boards (archived don't count)");
  assert.equal(lines[1], "Up to 250 open tickets");
  assert.equal(lines[2], "Up to 10 MB each on tickets and comments");
  assert.equal(lines.includes("Unlimited tickets"), false);
  const shown = text(capped);
  assert.equal(shown.includes("Up to 2 boards (archived don't count)"), true);
  assert.equal(shown.includes("Up to 250 open tickets"), true);
  assert.equal(shown.includes("Up to 10 MB each on tickets and comments"), true);
  assert.equal(shown.includes("Unlimited tickets"), false);
  assert.deepEqual(freeAmounts(capped), lines);
});

test("an enabled ticket-cap bypass keeps board and file limits and says tickets are unlimited", () => {
  const lines = limits.freePlanLimitCopy(boardsAndFilesOnly);
  assert.equal(lines[0], "Up to 2 boards (archived don't count)");
  assert.equal(lines[1], "Unlimited tickets");
  assert.equal(lines[2], "Up to 10 MB each on tickets and comments");
  assert.equal(lines.some((line) => line.includes("250")), false);
  const shown = text(boardsAndFilesOnly);
  assert.equal(shown.includes("Unlimited tickets"), true);
  assert.equal(shown.includes("Up to 10 MB each"), true);
  assert.equal(shown.includes("250"), false);
  assert.deepEqual(freeAmounts(boardsAndFilesOnly), lines);
});

test("shown BYOK and Pro prices are $10 or $20 monthly and $96 or $192 yearly", () => {
  const byok = plans.storeSubscriptionPlans.find((plan) => plan.id === "BYOK");
  const pro = plans.storeSubscriptionPlans.find((plan) => plan.id === "Pro");
  assert.deepEqual(byok.types.map((type) => [type.title, type.price]), [
    ["Monthly", "$10"],
    ["Annually", "$96"],
  ]);
  assert.deepEqual(pro.types.map((type) => [type.title, type.price]), [
    ["Monthly", "$20"],
    ["Annually", "$192"],
  ]);
  assert.equal(Number(byok.types[1].price.slice(1)) / 12, 8);
  assert.equal(Number(pro.types[1].price.slice(1)) / 12, 16);
  assert.equal(byok.types[0].description, "per user / month");
  assert.equal(byok.types[1].description, "per user / year");
  assert.equal(pro.types[0].description, "per user / month");
  assert.equal(pro.types[1].description, "per user / year");
});

test("trial comparison keeps production columns until the copy flag is on", () => {
  const off = plans.trialComparisonColumns(false);
  assert.equal(plans.trialPlanBlurb(false).includes("unlimited AI"), true);
  assert.equal(off.sharedTitles.some((perk) => perk.title === "LLM billing"), true);
  assert.equal(off.starter.some((perk) => perk.amount.includes("$15 of tokens")), true);
  assert.equal(off.starter.some((perk) => perk.amount === "Priority"), true);
  assert.equal(off.proWithAi.some((perk) => perk.amount.includes("Your API keys")), true);
  assert.equal(off.proWithAi.some((perk) => perk.amount === "Email"), true);

  const on = plans.trialComparisonColumns(true);
  assert.equal(plans.trialPlanBlurb(true), "Risk free, cancel anytime.");
  assert.equal(plans.trialPlanBlurb(true).toLowerCase().includes("unlimited ai"), false);
  assert.equal(on.sharedTitles, null);
  assert.equal(on.starter.some((perk) => perk.title === "LLM billing" && perk.amount.includes("Your API keys")), true);
  assert.equal(on.starter.some((perk) => perk.title === "Support" && perk.amount === "Email"), true);
  assert.equal(on.starter.some((perk) => perk.amount.includes("$15")), false);
  assert.equal(on.proWithAi.some((perk) => perk.title === "Support" && perk.amount === "Priority"), true);
  assert.equal(on.proWithAi.some((perk) => perk.amount.includes("Your API keys")), false);
  assert.equal(on.proWithAi.some((perk) => perk.amount.includes("$15 of tokens")), false);
  assert.equal(on.proWithAi.some((perk) => perk.title === "LLM billing"), false);
});

test("the trial table renders each plan's own features only when the copy flag is on", () => {
  const shown = { corrected: false };
  const table = load("src/components/Modals/TrialPlan/TrialPlanComponents.tsx", {
    "@/components/Common/IconsGlobal": { IconsGlobal: { Check: ({ variant }) => React.createElement("i", { "data-check": variant }) } },
    "@/lib/serverActions": { getTeamById: async () => null },
    "@/lib/subscriptionPlans": plans,
    "@/lib/flags/definitions/htpr-7686-free-plan-copy": { HTPR_7686_FREE_PLAN_COPY_FLAG: "htpr-7686-free-plan-copy" },
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": { StartPlanButton: () => null, requestCheckout: async () => "" },
    "@/hooks/useFlag": { useFlag: (name) => name === "htpr-7686-free-plan-copy" && shown.corrected, useFlagReady: () => true },
    "@/lib/flags/keys": { HTPR_7551_START_PLAN_CHECKOUT_FLAG: "htpr-7551-start-plan-checkout" },
    "next/navigation": { useRouter: () => ({ push() {} }) },
  }).PlansTable;
  const markup = (corrected) => {
    shown.corrected = corrected;
    return renderToStaticMarkup(React.createElement(table));
  };
  const off = markup(false);
  const on = markup(true);
  assert.equal(off.includes("unlimited AI"), true);
  assert.equal(off.includes("$15 of tokens"), true);
  assert.equal(on.includes("unlimited AI"), false);
  assert.equal(on.includes("Risk free, cancel anytime."), true);
  assert.equal(on.includes("$15 of tokens"), false);
  assert.equal(on.includes("Your API keys"), true);
  assert.equal(on.includes("Priority"), true);
  const starter = on.slice(on.indexOf("Starter"), on.indexOf("Pro with "));
  const pro = on.slice(on.indexOf("Pro with "));
  assert.equal(starter.includes("Your API keys"), true);
  assert.equal(starter.includes("Priority"), false);
  assert.equal(pro.includes("Priority"), true);
  assert.equal(pro.includes("Your API keys"), false);
  assert.equal(starter.includes('data-check="gray"'), true);
  assert.equal(starter.includes('data-check="black"'), false);
  assert.equal(starter.includes('data-check="purple"'), false);
  assert.equal(pro.includes('data-check="purple"'), true);
  assert.equal(pro.includes('data-check="black"'), true);
  assert.equal(pro.includes('data-check="gray"'), false);
  assert.equal(off.includes('data-check="gray"'), true);
  assert.equal(off.includes('data-check="purple"'), true);
  assert.equal(off.includes('data-check="black"'), true);
});
