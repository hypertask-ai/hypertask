const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("the image URL bugfix has its own Everyone flag and release risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7761-chat-image-urls.ts", {}).default;
  assert.equal(definition.key, "htpr-7761-chat-image-urls");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(typeof definition.releaseRisk.reason, "string");
  assert.equal(definition.releaseRisk.reason.length > 0, true);
});
