const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const key = "htpr-7924-free-file-25mb";
const identifier = "HTPR_7924_FREE_FILE_25MB_FLAG";
const migration =
  "src/prisma/migrations/20261122120000_drop_htpr_7924_free_file_25mb_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) || source.includes(identifier) ? [path.relative(root, file)] : [];
  });
}

test("the Free 25 MB file ceiling is permanent and its stored switch is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(
    sourceReferences(path.join(root, "src")).filter((file) => file !== "src/lib/flags.ts"),
    [],
  );
  const flags = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
  assert.match(flags, new RegExp(`RETIRED_FEATURE_FLAG_KEYS = new Set\\(\\[[^\\]]*"${key}"`));
  assert.match(flags, new RegExp(`"${key}": true,`));
  assert.equal(
    fs.readFileSync(path.join(root, migration), "utf8"),
    `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`,
  );
  const modes = JSON.parse(
    fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"),
  );
  assert.equal(JSON.stringify(modes).includes(key), false);
  assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false);
});

test("a Free scope may attach 25 MB with no flag read, and the plan copy says so", () => {
  const limits = load("src/lib/freePlanLimits.ts", {});
  assert.equal(limits.FREE_PLAN_MAX_FILE_BYTES, 25 * 1024 * 1024);
  assert.equal(limits.freePlanFileMegabytes(), 25);
  assert.equal("freeFileByteLimit" in limits, false);
  const copy = limits.freePlanLimitCopy({ planLimits: true, unlimitedTickets: false });
  assert.equal(copy.includes("Up to 25 MB each on tickets and comments"), true);
});
