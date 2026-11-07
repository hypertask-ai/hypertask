const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const KEY = "htpr-7367-server-description-first";
const migration = "src/prisma/migrations/20261106120000_drop_htpr_7367_server_description_first_flag/migration.sql";
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });

test("server description in the first page load is permanent and the rollout flag is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${KEY}.ts`)), false);
  assert.equal(fs.readFileSync(path.join(root, migration), "utf8"), `DELETE FROM "FeatureFlag" WHERE "key" = '${KEY}';\n`);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(modes.modes, KEY), false);
  const flags = load(path.join(root, "src/lib/flags.ts"));
  assert.equal(flags.HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG, undefined);
  assert.equal(flags.RETIRED_FEATURE_FLAG_KEYS.has(KEY), true);
});
