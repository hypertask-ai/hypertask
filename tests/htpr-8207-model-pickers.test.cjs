const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-8207-qwen-max-byok";
const modelKeys = ["glm-5.3", "gemini-3.1-pro-preview"];
const pickers = [
  "src/components/Global/ModelSelectorDropdown.tsx",
  "src/components/Modals/Settings/AiFeaturesSection.tsx",
  "src/app/agents/[agentId]/AgentConfigForm.tsx",
];
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-htpr-8207-${++jitiEntryId}.cjs`),
    { interopDefault: true, fsCache: false, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("the ticket flag stays live for Everyone so the new picker models ship on merge", () => {
  const flag = loadTs("src/lib/flags/definitions/htpr-8207-qwen-max-byok.ts");
  const definition = flag.default ?? flag;
  assert.equal(flag.HTPR_8207_QWEN_MAX_BYOK_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason);
});

test("the two new models are catalogued with the gateway ids and their own classes", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  assert.equal(catalog.getAiModelOptionById("glm-5.3").model, "zai/glm-5.3");
  assert.equal(catalog.getAiModelOptionById("gemini-3.1-pro-preview").model, "google/gemini-3.1-pro-preview");
  assert.equal(catalog.getAiModelDefinition("glm-5.3").modelClass, "glm");
  assert.equal(catalog.getAiModelDefinition("gemini-3.1-pro-preview").modelClass, "gemini-pro");
  assert.equal(catalog.getAiModelDefinition("glm-5.3-flash").modelClass, "glm-flash");
  assert.equal(catalog.getAiModelDefinition("gemini-4-argon").modelClass, "gemini-argon");
});

test("picker filtering hides both new models when the flag is Off and shows them by default", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  for (const haiku55Enabled of [false, true]) {
    const visible = (enabled) =>
      catalog.aiModelOptions.filter((option) =>
        catalog.isAiModelOptionVisible(option, haiku55Enabled, true, true, enabled));
    for (const modelKey of modelKeys) {
      const option = catalog.getAiModelOptionById(modelKey);
      assert.ok(option, modelKey);
      assert.equal(catalog.isAiModelOptionVisible(option, haiku55Enabled), true, `${modelKey} hidden by default`);
      assert.equal(visible(false).includes(option), false, `${modelKey} visible while Off`);
      assert.equal(visible(true).includes(option), true, `${modelKey} hidden while On`);
    }
    assert.deepEqual(
      visible(true).filter((option) => !modelKeys.includes(option.modelKey)),
      visible(false),
    );
  }
});

test("only the two ticket models are recognised as gated by this flag", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  for (const modelKey of modelKeys) assert.equal(catalog.isHtpr8207ModelKey(modelKey), true);
  for (const modelKey of ["glm-5.3-flash", "gemini-4-argon", "gemini-3.8-flash", undefined, null]) {
    assert.equal(catalog.isHtpr8207ModelKey(modelKey), false);
  }
});

test("every web model picker reads the flag and passes it to the visibility filter", () => {
  for (const file of pickers) {
    const source = read(file);
    assert.match(source, /useFlag\(HTPR_8207_QWEN_MAX_BYOK_FLAG\)/, file);
    assert.match(source, /isAiModelOptionVisible\(option, true, true, true, htpr8207ModelsEnabled\)/, file);
    assert.match(source, /isAiModelOptionVisible\(option, false, true, true, htpr8207ModelsEnabled\)/, file);
  }
});

test("the model watch fixture lists both new gateway ids so CI sees every picker model offered", () => {
  const fixture = JSON.parse(read("tests/fixtures/model-diff.json"));
  const ids = fixture.gateway.data.map((entry) => entry.id);
  for (const id of ["zai/glm-5.3", "google/gemini-3.1-pro-preview"]) {
    assert.ok(ids.includes(id), id);
  }
});
