const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { default: definition, HTPR_8231_AGENT_ARCHIVE_DONE_FLAG } = load(
  "src/lib/flags/definitions/htpr-8231-agent-archive-done.ts",
  {},
);

test("agent archive of Done tickets ships to Everyone and still refuses deletion", () => {
  assert.equal(HTPR_8231_AGENT_ARCHIVE_DONE_FLAG, "htpr-8231-agent-archive-done");
  assert.equal(definition.key, HTPR_8231_AGENT_ARCHIVE_DONE_FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.match(definition.releaseRisk.reason, /cannot delete/);
  assert.match(definition.description, /archive/i);
});
