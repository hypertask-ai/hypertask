const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { definitions } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const keys = ["htpr-7078-remove-connect-block", "htpr-7088-agent-comment-fanout", "htpr-7090-comment-link-scroll"];

test("expired batch is absent from definitions and both production mode sources", () => {
  const registry = definitions();
  const snapshot = require("../e2e/smoke/production-flag-modes.json");
  for (const key of keys) {
    assert.equal(registry.some((entry) => entry.key === key), false, key);
    assert.equal(registry.some((entry) => entry.related?.includes(key)), false, key);
    assert.equal(Object.hasOwn(snapshot.modes, key), false, key);
    assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false, key);
  }
});

test("deployment removes only the three expired switch rows", () => {
  const migration = fs.readFileSync(path.join(root, "src/prisma/migrations/20261125120000_htpr_9752_drop_expired_flags_batch_1/migration.sql"), "utf8");
  assert.equal(migration, keys.map((key) => `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`).join(""));
});
