const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const key = "htpr-7551-start-plan-checkout";
const identifier = "HTPR_7551_START_PLAN_CHECKOUT_FLAG";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) || source.includes(identifier) ? [path.relative(root, file)] : [];
  });
}

test("start-plan checkout stays on and its saved switch is removed", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(sourceReferences(path.join(root, "src")), []);
  const migrations = fs.readdirSync(path.join(root, "src/prisma/migrations"))
    .map((name) => path.join(root, "src/prisma/migrations", name, "migration.sql"))
    .filter((file) => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(key));
  assert.deepEqual(migrations.map((file) => fs.readFileSync(file, "utf8")), [
    `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`,
  ]);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(modes.modes, key), false);
  const button = fs.readFileSync(path.join(root, "src/components/PageComponents/Kanban/HeaderComponents/StartPlanButton.tsx"), "utf8");
  assert.match(button, /Start a Hypertask plan/);
  assert.doesNotMatch(button, /useFlag|flagReady/);
  const checkout = fs.readFileSync(path.join(root, "src/utils/controllers/stripe/createAuthorizedCheckoutSession.ts"), "utf8");
  assert.match(checkout, /ownerUserId: userId/);
  assert.match(checkout, /fourteenDayTrial \? 14 : 7/);
  assert.doesNotMatch(checkout, /Start plan is not available|HTPR_7551/);
});
