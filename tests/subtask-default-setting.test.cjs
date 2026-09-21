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

  const parentCard = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/Kanban/KanbanTaskComponents/CardSubTasks.tsx",
    ),
    "utf8",
  );
  const childCard = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/Kanban/KanbanTaskComponents/FlattenedParentTask.tsx",
    ),
    "utf8",
  );
  assert.match(parentCard, /currentSetting === "Flattened_Card"/);
  assert.match(childCard, /currentSetting === "Flattened_Card"/);
});

test("every fallback and the database default use the combined mode", () => {
  const model = fs.readFileSync(
    path.join(root, "src/models/Views/model.ts"),
    "utf8",
  );
  const resolver = fs.readFileSync(
    path.join(
      root,
      "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
    ),
    "utf8",
  );
  const schema = fs.readFileSync(
    path.join(root, "src/prisma/schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260813130000_default_subtask_flattened_card/migration.sql",
    ),
    "utf8",
  );
  const renderedViews = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useRenderedViews.ts"),
    "utf8",
  );
  const mcpViewService = fs.readFileSync(
    path.join(root, "src/lib/mcp/views/services.ts"),
    "utf8",
  );

  assert.match(
    model,
    /DEFAULT_SUBTASK_SETTING:\s*TBoardSubtaskSetting\s*=\s*"Flattened_Card"/,
  );
  assert.equal(
    resolver.match(/DEFAULT_SUBTASK_SETTING/g)?.length,
    3,
    "the import and both fallback branches should share one default",
  );
  assert.match(schema, /board_subtask_setting SubtaskSetting\s+@default\(Flattened_Card\)/);
  assert.match(migration, /SET DEFAULT 'Flattened_Card'/);
  assert.doesNotMatch(migration, /UPDATE\s+"View"/i);
  assert.match(
    renderedViews,
    /view\.board_subtask_setting \?\? DEFAULT_SUBTASK_SETTING/,
  );
  assert.match(
    mcpViewService,
    /input\.subtask_setting \?\? DEFAULT_SUBTASK_SETTING/,
  );
});
