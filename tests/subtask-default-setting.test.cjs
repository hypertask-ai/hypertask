const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadSubtaskHelpers() {
  const filename = path.join(
    root,
    "src/utils/helperFunctions/Views/SubtaskHelperFunction.ts",
  );
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  const stubs = {
    "@/models/Views/model": {
      DEFAULT_SUBTASK_SETTING: "Flattened_Card",
    },
    "./ViewsHelperFunctions": {
      getActiveSubtaskSettingFromProject: () => "Flattened_Card",
    },
  };

  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
  );
  return loadedModule.exports;
}

test("the application default keeps subtasks on the board", () => {
  const { applySubTaskSetting, defaultSubtaskSettings } = loadSubtaskHelpers();
  const sections = [
    {
      id: 1,
      items: [
        { id: 10, title: "Parent" },
        { id: 11, title: "Child", parentTask: { id: 10 } },
      ],
    },
  ];

  assert.equal(defaultSubtaskSettings, "Flattened_Card");
  assert.deepEqual(
    applySubTaskSetting(sections, defaultSubtaskSettings)[0].items.map(
      ({ id }) => id,
    ),
    [10, 11],
  );
});
