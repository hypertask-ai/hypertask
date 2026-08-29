const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

// Loads a TS source file with the "@/..." aliases resolved back to src/.
function loadTsModule(relativePath) {
  const filename = path.join(__dirname, "..", relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (request) =>
    request.startsWith("@/")
      ? loadTsModule(path.join("src", request.slice(2) + ".ts"))
      : require(request);
  loaded._compile(javascript, filename);
  return loaded.exports;
}

const { sortViewsByOrder } = loadTsModule(
  "src/utils/helperFunctions/Views/ViewOrderHelperFunctions.ts",
);
const { BUILTIN_VIEW_IDS, BUILTIN_VIEWS } = loadTsModule(
  "src/lib/constants/builtinViews.ts",
);

const savedView = (id, createdAt) => ({ id, title: id, createdAt });
const ids = (views) => views.map((view) => view.id);

test("built-in views default to the end of the bar, in declaration order", () => {
  const views = [
    ...BUILTIN_VIEWS,
    savedView("default", "2024-01-01"),
    savedView("saved-b", "2024-03-01"),
    savedView("saved-a", "2024-02-01"),
  ];

  assert.deepEqual(ids(sortViewsByOrder(views, undefined, "default")), [
    "default",
    "saved-a",
    "saved-b",
    ...BUILTIN_VIEWS.map((view) => view.id),
  ]);
});

test("a dragged built-in keeps its new position ahead of saved views", () => {
  const views = [
    ...BUILTIN_VIEWS,
    savedView("default", "2024-01-01"),
    savedView("saved-a", "2024-02-01"),
    savedView("saved-b", "2024-03-01"),
  ];
  // What the tab bar persists after dragging Overdue up onto the first row.
  const order = [
    "default",
    BUILTIN_VIEW_IDS.overdue,
    "saved-a",
    "saved-b",
    BUILTIN_VIEW_IDS.myTasks,
    BUILTIN_VIEW_IDS.blocked,
    BUILTIN_VIEW_IDS.agents,
  ];

  assert.deepEqual(ids(sortViewsByOrder(views, order, "default")), order);
});

test("the default view stays first even if the order says otherwise", () => {
  const views = [savedView("default", "2024-01-01"), savedView("saved-a", "2024-02-01")];
  assert.equal(
    ids(sortViewsByOrder(views, ["saved-a", "default"], "default"))[0],
    "default",
  );
});
