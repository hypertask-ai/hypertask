const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(
  __dirname, "../src/prisma/migrations/20261002170000_backfill_task_number_aliases/migration.sql",
), "utf8");
const values = migration.match(/FROM\s*\(VALUES\s*([\s\S]*?)\)\s*AS v\(p,\s*u,\s*t,\s*task\)/);
assert.ok(values, "migration must contain the alias VALUES table");
const rowPattern = /\(\s*(\d+),\s*(\d+),\s*'(HTPR-\d+)',\s*(\d+)\s*\)/g;
const rows = [...values[1].matchAll(rowPattern)].map((match) => ({
  projectId: Number(match[1]), uniqueIndex: Number(match[2]),
  ticketNumber: match[3], taskId: Number(match[4]),
}));
assert.ok(rows.length > 0, "backfill must not be empty");
assert.equal(values[1].replace(rowPattern, "").replace(/[\s,]/g, ""), "", "every VALUES row must be parsed");

test("backfill contains only board 15 historical ticket numbers", () => {
  for (const row of rows) {
    assert.equal(row.projectId, 15);
    assert.ok(row.uniqueIndex >= 6000);
    assert.equal(row.ticketNumber, `HTPR-${row.uniqueIndex}`);
    assert.ok(row.taskId > 0);
  }
});

test("backfill includes all four confirmed old-number destinations", () => {
  for (const [uniqueIndex, taskId] of [[6641, 44769], [6634, 44721], [6636, 44734], [6649, 48557]]) {
    assert.ok(rows.some(row => row.uniqueIndex === uniqueIndex && row.taskId === taskId), `missing HTPR-${uniqueIndex} -> ${taskId}`);
  }
});

test("backfill has no duplicate project/index keys", () => {
  const keys = rows.map(row => `${row.projectId}:${row.uniqueIndex}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("backfill preserves existing aliases and skips missing destination tasks", () => {
  assert.match(migration, /ON CONFLICT\s*\("projectId",\s*"uniqueIndex"\)\s*DO NOTHING;/);
  assert.match(migration, /WHERE EXISTS\s*\(SELECT 1 FROM "Task" WHERE id = v\.task\)/);
});

test("backfill is a single data-only insert with the intended column order", () => {
  const sql = migration.replace(/^--.*$/gm, "").trim();
  assert.match(sql, /^INSERT INTO "TaskNumberAlias"\s*\("projectId",\s*"uniqueIndex",\s*"ticketNumber",\s*"taskId"\)\s*SELECT v\.p, v\.u, v\.t, v\.task/);
  assert.equal(sql.split(";").filter(statement => statement.trim()).length, 1);
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|DELETE|UPDATE|TRUNCATE)\b/);
});
