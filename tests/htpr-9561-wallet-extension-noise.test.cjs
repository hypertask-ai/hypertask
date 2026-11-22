const test = require("node:test");
const assert = require("node:assert/strict");

const { dropInjectedWalletException } = require("../src/lib/analytics/injectedWalletNoise.mjs");

const WALLET_MESSAGE =
  "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')";

const exceptionEvent = (entries) => ({
  uuid: "event-1",
  event: "$exception",
  properties: {
    $current_url: "https://app.hypertask.ai/detail/project-15/9561",
    $lib: "web",
    $exception_list: entries.map((entry, index) => ({
      ...entry,
      mechanism: { exception_id: index, handled: false, synthetic: false, type: "generic" },
    })),
  },
});

test("the Safari wallet assignment behind HTPR-9561 never reaches PostHog", () => {
  const wallet = exceptionEvent([
    { type: "TypeError", value: WALLET_MESSAGE },
    {
      type: "TypeError",
      value: "undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
    },
    { type: "TypeError", value: "Cannot set properties of undefined (setting 'selectedAddress')" },
  ]);
  assert.equal(dropInjectedWalletException(wallet), null);
  const alone = exceptionEvent([{ type: "Error", value: WALLET_MESSAGE }]);
  assert.equal(dropInjectedWalletException(alone), null);
  const pageview = { event: "$pageview", properties: {} };
  assert.equal(dropInjectedWalletException(pageview), pageview);
  assert.equal(dropInjectedWalletException(null), null);
  const empty = exceptionEvent([]);
  assert.equal(dropInjectedWalletException(empty), empty);
});

test("a real browser exception still reaches PostHog", () => {
  const crash = exceptionEvent([
    { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
  ]);
  assert.equal(dropInjectedWalletException(crash), crash);
  const settingAnotherProperty = exceptionEvent([
    { type: "TypeError", value: "Cannot set properties of undefined (setting 'id')" },
  ]);
  assert.equal(dropInjectedWalletException(settingAnotherProperty), settingAnotherProperty);
  const mixed = exceptionEvent([
    { type: "TypeError", value: WALLET_MESSAGE },
    { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
  ]);
  assert.equal(dropInjectedWalletException(mixed), mixed);
});
