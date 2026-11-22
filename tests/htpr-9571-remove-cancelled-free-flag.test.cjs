const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const key = "htpr-7982-cancelled-free";
const migration =
  "src/prisma/migrations/20261122150000_drop_htpr_7982_cancelled_free_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) ? [path.relative(root, file)] : [];
  });
}

test("cancelled subscriptions stay on Free board admission and the safety switch is gone", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(
    sourceReferences(path.join(root, "src")).filter((file) => file !== "src/lib/flags.ts"),
    [],
  );
  assert.equal(
    fs.readFileSync(path.join(root, migration), "utf8"),
    `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`,
  );
  assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(modes.modes, key), false);
  const flags = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } })(
    path.join(root, "src/lib/flags.ts"),
  );
  assert.equal(flags.HTPR_7982_CANCELLED_FREE_FLAG, undefined);
  assert.equal(flags.RETIRED_FEATURE_FLAG_KEYS.has(key), true);
});
