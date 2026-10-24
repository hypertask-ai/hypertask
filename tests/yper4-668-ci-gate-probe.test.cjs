const { test } = require("node:test");
const assert = require("node:assert/strict");

test("YPER4-668 ci-tests still fails a non-quarantined test", () => {
  assert.fail("YPER4-668 gate probe: this non-quarantined test must fail ci-tests");
});
