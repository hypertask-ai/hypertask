const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertSafeHarnessConfig,
  TEST_CONFIRMATION,
} = require("../scripts/lib/stripe-harness-guards.cjs");

const safe = {
  stripeSecretKey: "sk_test_placeholder",
  confirmation: TEST_CONFIRMATION,
};

test("billing harness accepts only an explicitly confirmed test configuration", () => {
  assert.doesNotThrow(() => assertSafeHarnessConfig(safe));
});

test("billing harness rejects a live Stripe key", () => {
  assert.throws(
    () => assertSafeHarnessConfig({ ...safe, stripeSecretKey: "sk_live_nope" }),
    /test-mode key/,
  );
});

test("the harness cleans up deletable fixtures and tags retained invoices", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/stripe-seat-billing-harness.cjs"),
    "utf8",
  );
  assert.match(source, /stripe\.subscriptions\.cancel/);
  assert.match(source, /stripe\.customers\.del/);
  assert.match(source, /stripe\.prices\.update/);
  assert.match(source, /stripe\.products\.update/);
  assert.doesNotMatch(source, /\bprisma\b/);
  assert.match(
    source,
    /stripe\.invoices\.update\(invoice\.id, \{ metadata \}\)/,
  );
  assert.match(source, /syncSeatBillingOnJoin\(teamId, adapter, passthroughSeatBillingLock\)/);
  assert.match(source, /idempotencyKey: `\$\{runId\}:customer`/);
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /for await \(const item of list\(\)\)/);
  assert.match(source, /item\.metadata\?\.run_id === runId/);
  assert.doesNotMatch(source, /created: \{ gte:/);
  assert.match(source, /line\.price\?\.id === price\.id && line\.proration/);
  assert.match(source, /total \+ line\.amount/);
  assert.match(source, /process\.once\("SIGINT", handleSignal\)/);
  assert.match(source, /process\.once\("SIGTERM", handleSignal\)/);
  assert.match(source, /await cleanupOnce\(\)/);
});
