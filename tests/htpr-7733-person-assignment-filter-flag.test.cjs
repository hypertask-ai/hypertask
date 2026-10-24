const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

test("person-assignment filter is a low-risk bugfix on for Everyone by default", () => {
  const definition = load("src/lib/flags/definitions/htpr-7733-person-assignment-filter.ts", {});
  const flag = definition.default;
  assert.equal(definition.HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG, "htpr-7733-person-assignment-filter");
  assert.equal(flag.key, definition.HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason.length > 0);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
