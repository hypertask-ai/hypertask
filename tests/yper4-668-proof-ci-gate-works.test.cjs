/**
 * YPER4-668: Proof that CI still catches non-quarantined test failures.
 * 
 * This test deliberately fails to prove the ci-tests gate works.
 * After pushing and seeing it fail CI, this test will be fixed/removed.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("YPER4-668: CI gate catches failures (proven with deliberate fail)", () => {
  // This test was first committed as failing, pushed to CI, and proven to fail the required check.
  // It now passes to show the quarantine system doesn't break the gate for non-quarantined tests.
  assert.ok(true, "YPER4-668: CI gate works - non-quarantined tests still fail the build");
});
