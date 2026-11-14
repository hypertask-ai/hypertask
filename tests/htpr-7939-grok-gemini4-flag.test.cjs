const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7939-grok-gemini4-models";
const modelKeys = ["grok-4.7", "gemini-4-argon"];
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-htpr-7939-${++jitiEntryId}.cjs`),
    { interopDefault: true, fsCache: false, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("the ticket flag is live for Owner and QA by default and money high risk", () => {
  const flag = loadTs("src/lib/flags/definitions/htpr-7939-grok-gemini4-models.ts");
  const definition = flag.default ?? flag;
  assert.equal(flag.HTPR_7939_GROK_GEMINI4_MODELS_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.ok(definition.releaseRisk.reason);
  assert.match(definition.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test("picker filtering hides both models when Off and shows them when On", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  for (const haiku55Enabled of [false, true]) {
    const visible = (enabled) =>
      catalog.aiModelOptions.filter((option) =>
        catalog.isAiModelOptionVisible(option, haiku55Enabled, true, enabled));
    for (const modelKey of modelKeys) {
      const option = catalog.getAiModelOptionById(modelKey);
      assert.ok(option, modelKey);
      assert.equal(catalog.isAiModelOptionVisible(option, haiku55Enabled, true), false);
      assert.equal(visible(false).includes(option), false, `${modelKey} visible while Off`);
      assert.equal(visible(true).includes(option), true, `${modelKey} hidden while On`);
    }
    assert.deepEqual(
      visible(true).filter((option) => !modelKeys.includes(option.modelKey)),
      visible(false),
    );
  }
});

test("only the two ticket models are recognised as flagged", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  for (const modelKey of modelKeys) assert.equal(catalog.isGrokGemini4ModelKey(modelKey), true);
  for (const modelKey of ["gemini-3.8-flash", "gpt-6-luna", "deepseek-v4.1-flash", undefined, null]) {
    assert.equal(catalog.isGrokGemini4ModelKey(modelKey), false);
  }
});

test("Android composer config lists the models only when the flag is On", () => {
  const source = read("src/app/api/android/ai/composer/config.ts");
  assert.match(source, /isAiModelOptionVisible\(option, Boolean\(input\.haiku55Enabled\), false, Boolean\(input\.grokGemini4Enabled\)\)/);
  assert.match(read("src/app/api/android/ai/composer/route.ts"), /HTPR_7939_GROK_GEMINI4_MODELS_FLAG, ctx\.user\.id/);
});

test("server model selection falls back to the plan default when the flag is Off", () => {
  for (const file of ["src/lib/ai/chatStream/turnModel.ts", "src/app/api/ai/_lib/editorAi.ts"]) {
    const source = read(file);
    assert.match(source, /isFeatureEnabled\(HTPR_7939_GROK_GEMINI4_MODELS_FLAG, /, file);
    assert.match(
      source,
      /if \(!grokGemini4Enabled && isGrokGemini4ModelKey\(selection\.modelOption\?\.modelKey\)\) \{\s*selection = selectionFromModelOption\(\s*filterModelOptionForTeam\(requestDefaultModelOption,/,
      file,
    );
  }
});

test("team feature models drop a saved or requested flagged choice when Off", () => {
  const source = read("src/pages/api/teams/aiFeatureModels.ts");
  assert.match(source, /isFeatureEnabled\(HTPR_7939_GROK_GEMINI4_MODELS_FLAG, user\.id\)/);
  assert.match(source, /!grokGemini4Enabled && isGrokGemini4ModelKey\(savedModelKey\)/);
  assert.match(source, /!grokGemini4Enabled && isGrokGemini4ModelKey\(selectedModelKey\)/);
  assert.match(source, /!grokGemini4Enabled && isGrokGemini4ModelKey\(resolved\.modelKey\)/);
});

test("web pickers, the xAI key row, the xAI provider row and both xAI commands follow the flag", () => {
  for (const file of [
    "src/components/Global/ModelSelectorDropdown.tsx",
    "src/components/Modals/Settings/AiFeaturesSection.tsx",
    "src/app/agents/[agentId]/AgentConfigForm.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /useFlag\(HTPR_7939_GROK_GEMINI4_MODELS_FLAG\)/, file);
    assert.match(source, /grokGemini4Enabled\s*\?\s*flagModelOptions\s*:\s*flagModelOptions\.filter\(\(option\) => !isGrokGemini4ModelKey\(option\.modelKey\)\)/, file);
    assert.match(source, /isAiModelOptionVisible\(option, true, true, true\)/, file);
    assert.match(source, /isAiModelOptionVisible\(option, false, true, true\)/, file);
  }
  assert.match(read("src/components/Modals/Settings/ApiKeysSection.tsx"), /grokGemini4Enabled \? providerRows : providerRows\.filter\(\(row\) => row\.source !== "xai"\)/);
  assert.match(read("src/components/Modals/Settings/AiModelsSection.tsx"), /grokGemini4Enabled \? rows : rows\.filter\(\(provider\) => provider\.key !== "xai"\)/);
  const commands = read("src/components/Modals/commands/HTC/commands.tsx");
  assert.match(commands, /if \(!grokGemini4Enabled\) hiddenXaiCommandKeys = "settingsApiKeysXaiApiKey settingsAiModelsXai"/);
});
