const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const WALLET_MESSAGE =
  "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')";

const walletMessages = [
  WALLET_MESSAGE,
  "undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
  "Uncaught TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
  "Cannot set properties of undefined (setting 'selectedAddress')",
  'can\'t set property "selectedAddress" of undefined',
];

const applicationMessages = [
  "Cannot set properties of undefined (setting 'id')",
  "Cannot read properties of undefined (reading 'title')",
  "Cannot read properties of undefined (reading 'id')",
];

function readSource(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function loadMessageGuard(relative, until) {
  const source = readSource(relative);
  const start = source.indexOf("const INJECTED_WALLET_EXCEPTION");
  assert.ok(start >= 0, `${relative} has no injected wallet filter`);
  const end = source.indexOf(until, start);
  assert.ok(end > start, `${relative} wallet filter is not a standalone function`);
  const javascript = source
    .slice(start, end)
    .replace(/export function isInjectedWalletExceptionMessage\(message: unknown\)/, "function isInjectedWalletExceptionMessage(message)")
    .replace(/function dropInjectedWalletException\(event: \{[\s\S]*?\} \| null\)/, "function dropInjectedWalletException(event)");
  const context = {};
  vm.runInNewContext(
    `${javascript}\nthis.isInjectedWalletExceptionMessage = typeof isInjectedWalletExceptionMessage === "function" ? isInjectedWalletExceptionMessage : null;\nthis.dropInjectedWalletException = typeof dropInjectedWalletException === "function" ? dropInjectedWalletException : null;`,
    context,
  );
  return context;
}

test("an injected wallet error never reaches PostHog or an error ticket", () => {
  const source = readSource("src/lib/errors/reportError.ts");
  const guardAt = source.indexOf("if (isInjectedWalletExceptionMessage(unredactedReport.message)) return;");
  const captureAt = source.indexOf("await capturePostHogException");
  assert.ok(guardAt >= 0 && captureAt > guardAt, "reportError still records the wallet error");
  const { isInjectedWalletExceptionMessage } = loadMessageGuard(
    "src/lib/errors/reportError.ts",
    "\nexport async function reportError",
  );
  assert.equal(typeof isInjectedWalletExceptionMessage, "function");
  for (const message of walletMessages) assert.equal(isInjectedWalletExceptionMessage(message), true);
  for (const message of applicationMessages) assert.equal(isInjectedWalletExceptionMessage(message), false);
  assert.equal(isInjectedWalletExceptionMessage(undefined), false);
});

test("PostHog drops a wallet exception and keeps a real browser exception", () => {
  const { dropInjectedWalletException } = loadMessageGuard(
    "src/components/Analytics/PostHogAnalytics.tsx",
    "\nconst AUTHENTICATED_ANALYTICS_PAINT_SETTLE_MS",
  );
  assert.equal(typeof dropInjectedWalletException, "function");
  const exceptionEvent = (entries) => ({
    event: "$exception",
    properties: { $exception_list: entries.map((value) => ({ type: "TypeError", value })) },
  });
  const wallet = exceptionEvent(walletMessages);
  assert.equal(dropInjectedWalletException(wallet), null);
  const crash = exceptionEvent(applicationMessages);
  assert.equal(dropInjectedWalletException(crash), crash);
  const mixed = exceptionEvent([WALLET_MESSAGE, applicationMessages[0]]);
  assert.equal(dropInjectedWalletException(mixed), mixed);
  const pageview = { event: "$pageview", properties: {} };
  assert.equal(dropInjectedWalletException(pageview), pageview);
  assert.equal(dropInjectedWalletException(null), null);
  const empty = exceptionEvent([]);
  assert.equal(dropInjectedWalletException(empty), empty);
});
