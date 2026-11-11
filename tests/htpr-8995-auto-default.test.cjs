const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const picker = load(path.join(root, "src/lib/taskWriterPickerAuto.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));

const haiku = catalog.getAiModelOptionById("claude-haiku-5-5", true);

test("Auto is the default for the surfaces that offer it", () => {
  assert.equal(picker.autoDefaultForSurface("taskWriter", true, false), true);
  assert.equal(picker.autoDefaultForSurface("taskWriter", false, false), false);
  assert.equal(picker.autoDefaultForSurface("aiChat", false, true), true);
  assert.equal(picker.autoDefaultForSurface("aiChat", false, false), false);
  assert.equal(picker.autoDefaultForSurface("writeWithAi", true, true), false);
  assert.equal(picker.autoDefaultForSurface("imageGeneration", true, true), false);
});

test("an unsaved model resolves to Auto without losing the model behind it", () => {
  const option = picker.preferredPickerOption(haiku, true);
  assert.equal(option.id, "auto");
  assert.equal(option.title, "Auto");
  assert.equal(option.source, haiku.source);
  assert.equal(option.model, haiku.model);
  assert.equal(option.modelKey, haiku.modelKey);
});

test("a saved model is not replaced by Auto and stays a real catalog option", () => {
  const saved = catalog.getAiModelOptionById("gpt-6-luna");
  assert.ok(saved);
  const storedPick = saved.id;
  const usesPlanDefault = !catalog.getAiModelOptionById(storedPick, true);
  assert.equal(usesPlanDefault, false);
  const autoDefault = usesPlanDefault && picker.autoDefaultForSurface("taskWriter", true, true);
  const option = picker.preferredPickerOption(saved, autoDefault);
  assert.equal(option.id, storedPick);
  assert.notEqual(option.id, "auto");
});

console.log("auto default passed");
