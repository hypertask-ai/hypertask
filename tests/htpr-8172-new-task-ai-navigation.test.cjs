const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./helpers/flag-files.cjs");

test("New Task keyboard navigation fix defaults to Everyone with a small reversible risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-8172-new-task-ai-navigation.ts");
  assert.equal(definition.key, "htpr-8172-new-task-ai-navigation");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
