const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./helpers/flag-files.cjs");

test("Docs routing improvement defaults to Everyone with a small reversible risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7780-docs-routing.ts");
  assert.equal(definition.key, "htpr-7780-docs-routing");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
