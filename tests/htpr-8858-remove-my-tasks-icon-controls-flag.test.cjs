const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const key = "htpr-6938-my-tasks-icon-controls";
const identifier = "HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG";
const migration = "src/prisma/migrations/20261106120000_drop_htpr_6938_my_tasks_icon_controls_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) || source.includes(identifier) ? [path.relative(root, file)] : [];
  });
}

test("my tasks icon controls are permanent and the stored rollout is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(sourceReferences(path.join(root, "src")), ["src/lib/flags.ts"]);
  assert.equal(fs.readFileSync(path.join(root, migration), "utf8"), `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(modes.modes, key), false);
});
