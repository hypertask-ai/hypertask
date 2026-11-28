const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadSubtaskHelpers() {
  return loadModule("src/utils/helperFunctions/Views/SubtaskHelperFunction.ts", {
    "@/models/Views/model": {
      DEFAULT_SUBTASK_SETTING: "Flattened_Card",
    },
    "./ViewsHelperFunctions": {
      getActiveSubtaskSettingFromProject: () => "Flattened_Card",
    },
  });
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
