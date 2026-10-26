const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { createJiti } = require("jiti");

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
const { FreePlanLimitLines } = jiti(path.join(root, "src/components/Modals/Settings/SettingsBillingRow.tsx"));
process.on("exit", () => {
  if (previousReact === undefined) delete global.React;
  else global.React = previousReact;
});

const legacy = { planLimits: false, unlimitedTickets: false };
const capped = { planLimits: true, unlimitedTickets: false };
const boardsAndFilesOnly = { planLimits: true, unlimitedTickets: true };

function text(flags) {
  return renderToStaticMarkup(React.createElement(FreePlanLimitLines, { flags }))
    .replace(/&#x27;|&#39;|&apos;/g, "'");
}

function freeAmounts(flags) {
  return plans.subscriptionPlansFor(flags)
    .find((plan) => plan.id === "Free")
    .perks
    .filter((perk) => ["Boards", "Open tickets", "Files", "Teams already over a limit"].includes(perk.title))
    .map((perk) => perk.amount);
}

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
