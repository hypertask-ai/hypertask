const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const KEY = "htpr-7367-server-description-first";
const IDENTIFIER = "HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG";
const migration = "src/prisma/migrations/20261106120000_drop_htpr_7367_server_description_first_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(IDENTIFIER) ? [path.relative(root, file)] : [];
  });
}

test("server description in the first page load is permanent and the rollout flag is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${KEY}.ts`)), false);
  assert.deepEqual(sourceReferences(path.join(root, "src")), []);
  assert.equal(fs.readFileSync(path.join(root, migration), "utf8"), `DELETE FROM "FeatureFlag" WHERE "key" = '${KEY}';\n`);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(modes.modes, KEY), false);
  const page = fs.readFileSync(path.join(root, "src/app/detail/[...slug]/page.tsx"), "utf8");
  assert.match(page, /descriptionStart="server"/);
  assert.doesNotMatch(page, /7367|SERVER_DESCRIPTION_FIRST/);
});
