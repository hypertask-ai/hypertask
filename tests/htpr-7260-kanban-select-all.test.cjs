const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

test("Kanban select-all is an independently defined feature flag", () => {
  const flag = load("src/lib/flags/definitions/htpr-7260-kanban-select-all.ts", {});
  assert.equal(flag.HTPR_7260_KANBAN_SELECT_ALL_FLAG, "htpr-7260-kanban-select-all");
  assert.equal(flag.default.key, flag.HTPR_7260_KANBAN_SELECT_ALL_FLAG);
  assert.equal(flag.default.shippedOn, "2026-10-15");
  assert.equal(flag.default.kind, "feature");
  assert.equal(flag.default.releaseRisk.risk, "new");
  assert.ok(flag.default.releaseRisk.reason.length > 0);
  assert.ok(flag.default.description.length > 0);
});
