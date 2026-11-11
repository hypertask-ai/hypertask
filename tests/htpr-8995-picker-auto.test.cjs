const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const picker = load(path.join(root, "src/lib/taskWriterPickerAuto.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));

const base = catalog.defaultAiModelOption;
const haiku = catalog.getAiModelOptionById("claude-haiku-5-5", true);

test("Auto is the New Task default until a real model is saved", () => {
  assert.equal(picker.taskWriterShowsAuto(undefined, true), true);
  assert.equal(picker.taskWriterShowsAuto("auto", false), true);
  assert.equal(picker.taskWriterShowsAuto(haiku.id, false), false);
  assert.equal(picker.taskWriterShowsAuto("not-a-model", false), false);
  const options = picker.withTaskWriterAutoOption(
    [haiku, catalog.getAiModelOptionById("gpt-6-luna")],
    base,
  );
  assert.equal(options[0].id, "auto");
  assert.equal(options[0].title, "Auto");
  assert.equal(options.filter((option) => option.id === haiku.id).length, 1);
  assert.equal(options.some((option) => option.id === "gpt-6-luna"), true);
});

test("Auto waits for the team model query and never sends a loading fallback as a pick", () => {
  assert.equal(picker.taskWriterDefersModel(true, true, null, false), true);
  assert.equal(picker.taskWriterDefersModel(true, true, null, true), false);
  assert.equal(picker.taskWriterDefersModel(true, true, true, false), false);
  assert.equal(picker.taskWriterDefersModel(true, false, null, false), false);
  assert.equal(picker.taskWriterDefersModel(false, true, null, false), false);
});

test("a New Task Auto choice is stored only for that surface, and the request names Auto or a real model", () => {
  assert.equal(picker.autoModelPreferenceAllowed("aiChat", "auto", false), true);
  assert.equal(picker.autoModelPreferenceAllowed("taskWriter", "auto", true), true);
  assert.equal(picker.autoModelPreferenceAllowed("taskWriter", "auto", false), false);
  assert.equal(picker.autoModelPreferenceAllowed("writeWithAi", "auto", true), false);
  assert.equal(picker.autoModelPreferenceAllowed("taskWriter", haiku.id, true), false);
  assert.equal(picker.taskWriterPickerOption(null, null), null);
  assert.equal(picker.taskWriterPickerOption("auto", haiku.id), "auto");
  assert.equal(picker.taskWriterPickerOption(null, haiku.id, true).id, haiku.id);
  assert.equal(picker.taskWriterPickerOption("missing", null), null);
  console.log("picker auto default passed");
});
