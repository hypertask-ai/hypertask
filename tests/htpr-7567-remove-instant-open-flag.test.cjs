const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const key = "htpr-6752-instant-ticket-open";
const identifier = "HTPR_6752_INSTANT_TICKET_OPEN_FLAG";
const migration = "src/prisma/migrations/20261022110000_drop_htpr_6752_instant_ticket_open_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) || source.includes(identifier) ? [path.relative(root, file)] : [];
  });
}

test("instant ticket opening is permanent and the stored rollout is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(sourceReferences(path.join(root, "src")), []);
  assert.equal(fs.readFileSync(path.join(root, migration), "utf8"), `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(JSON.stringify(modes).includes(key), false);
});
