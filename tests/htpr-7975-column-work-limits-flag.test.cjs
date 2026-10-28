const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { default: definition, HTPR_7975_COLUMN_WORK_LIMITS_FLAG } = load("src/lib/flags/definitions/htpr-7975-column-work-limits.ts", {});
const { formatKanbanStalenessLine } = load("src/lib/staleness.ts", {});

test("column work limits ship for everyone with a reversible improvement flag", () => {
  assert.equal(HTPR_7975_COLUMN_WORK_LIMITS_FLAG, "htpr-7975-column-work-limits");
  assert.equal(definition.key, HTPR_7975_COLUMN_WORK_LIMITS_FLAG);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("flag Off keeps fresh ages hidden while stale ages remain visible", () => {
  const fresh = { daysOnBoard: 3, daysInColumn: 1, daysSinceLastComment: 0, level: "none", commentLevel: "none" };
  assert.equal(formatKanbanStalenessLine(fresh), null);
  assert.equal(formatKanbanStalenessLine(fresh, false), null);
  assert.equal(formatKanbanStalenessLine(fresh, true), "3d on board · 1d in column");
  const stale = { ...fresh, daysOnBoard: 30, daysInColumn: 8, level: "warn" };
  assert.equal(formatKanbanStalenessLine(stale, false), "30d on board · 8d in column");
});
