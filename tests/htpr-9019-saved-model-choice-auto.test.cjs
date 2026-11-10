const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const switchFile = "src/lib/ai/htpr9019ModelChoiceAuto.ts";
const migrationFile = "src/prisma/migrations/20261110140000_htpr_9019_saved_model_choice_auto/migration.sql";

test("the switch covers every stored text surface and never image generation", () => {
  const source = read(switchFile);
  const listed = source.slice(source.indexOf("surfaces(surface) AS ("), source.indexOf("), choices AS ("));
  const surfaces = [...listed.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]).sort();
  const text = loadModule("src/lib/aiModelPreferences.ts").AI_MODEL_PREFERENCE_SURFACES
    .filter((surface) => surface !== "imageGeneration").sort();
  assert.deepEqual(surfaces, text);
  assert.doesNotMatch(source, /imageGeneration/);
});

test("a stored Auto choice wins per surface and a team-scoped pick beats it", () => {
  const auto = loadModule("src/lib/aiModelPreferences.ts").storedAutoModelRequested;
  assert.equal(auto({ aiChat: "auto" }, "aiChat", null), true);
  assert.equal(auto({ teams: { 12: { askAi: "auto" } } }, "askAi", 12), true);
  assert.equal(auto({ teams: { 12: { askAi: "auto" } } }, "askAi", 13), false);
  assert.equal(auto({ aiChat: "auto", teams: { 12: { aiChat: "claude-haiku-5-5" } } }, "aiChat", 12), false);
  assert.equal(auto({ aiChat: "claude-haiku-5-5" }, "aiChat", null), false);
  assert.equal(auto({ aiChat: "auto" }, "taskWriter", null), false);
});

test("the switch runs once, only with the flag on, and backs the old choice up first", () => {
  const source = read(switchFile);
  assert.ok(source.indexOf("isFeatureEnabled(HTPR_9019_SAVED_MODEL_AUTO_FLAG, userId)") < source.indexOf("prisma.$transaction"));
  assert.ok(source.indexOf("isFeatureEnabled(HTPR_7915_AUTO_MODEL_FLAG, userId)") < source.indexOf("prisma.$transaction"));
  assert.match(source, /htpr9019ModelChoiceAutoDone\.findUnique/);
  assert.match(source, /skipDuplicates: true/);
  assert.ok(source.indexOf("INSERT INTO htpr_9019_model_choice_backup") < source.indexOf('UPDATE "UserSetting"'));
  assert.match(source, /jsonb_typeof\(value\) = 'string'/);
  assert.match(source, /'"auto"'::jsonb/);
  assert.match(source, /ARRAY\['teams', team\.key, surface\]/);
  assert.ok(source.indexOf('INSERT INTO htpr_7038_model_choice_reset_done') > source.indexOf('UPDATE "UserSetting"'));
});

test("every read point switches after the Haiku reset and reads a saved Auto as Auto", () => {
  const reset = read("src/lib/ai/htpr7038ModelReset.ts");
  assert.ok(reset.indexOf("ensureHtpr9019ModelChoiceAuto(userId)") > reset.indexOf("resetSavedHaikuChoicesOnce(userId)"));
  assert.match(reset, /switched === "failed" \? "failed" : result/);
  for (const file of ["src/utils/controllers/users/fetch_preferences.ts", "src/app/api/users/preferences/route.ts", "src/app/api/ai/_lib/editorAi.ts", "src/lib/ai/chatStream/turnModel.ts"]) {
    assert.match(read(file), /ensureHtpr7038ModelReset\(/, file);
  }
  for (const file of ["src/app/api/ai/_lib/editorAi.ts", "src/lib/ai/chatStream/turnModel.ts"]) {
    assert.match(read(file), /isAutoModelChoice\(personalModelOptionId\)/);
  }
  const hook = read("src/hooks/General/useAiModelPreference.ts");
  assert.match(hook, /storedAutoModelRequested\(/);
  assert.match(hook, /toAutoModelOption\(planDefault\)/);
  const dropdown = read("src/components/Global/ModelSelectorDropdown.tsx");
  assert.match(dropdown, /savedAutoOption = savedModelAuto && \(autoFlag \|\| pickerAutoFlag\) \? toAutoModelOption\(selectedOption\)/);
  assert.match(dropdown, /autoSelected = Boolean\(autoOption \?\? savedAutoOption\)/);
  assert.match(read("src/app/api/users/preferences/route.ts"), /return !savedModelAutoEnabled;/);
  assert.match(read("src/app/api/users/preferences/route.ts"), /modelReset === "failed"/);
  assert.match(read("src/lib/ai/chatStream/turnModel.ts"), /!autoRequested && isServerChosenDefaultTurn/);
  assert.match(read("src/lib/flags/definitions/htpr-9019-saved-model-auto.ts"), /defaultMode: "OWNER_AND_QA"/);
});

test("the migration adds the switch's tables and changes no saved choice", () => {
  const migration = read(migrationFile);
  assert.match(migration, /CREATE TABLE "htpr_9019_model_choice_auto_done"/);
  assert.match(migration, /CREATE TABLE "htpr_9019_model_choice_backup"/);
  assert.doesNotMatch(migration, /UPDATE "UserSetting"|DELETE FROM|TRUNCATE|DROP TABLE/);
  const schema = read("src/prisma/schema.prisma");
  assert.match(schema, /model Htpr9019ModelChoiceAutoDone \{/);
  assert.match(schema, /model Htpr9019ModelChoiceBackup \{/);
  const undo = read("scripts/htpr-9019-undo-model-choice-auto.sql");
  assert.match(undo, /htpr_9019_model_choice_backup/);
  assert.match(undo, /preferences #> path = '"auto"'::jsonb/);
  assert.doesNotMatch(undo, /DROP TABLE|DELETE FROM/i);
});
