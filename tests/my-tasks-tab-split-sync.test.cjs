const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/my-tasks/MyTasks.tsx"),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "MyTasks.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findTimeSplitSyncDependencies(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(sourceFile) === "useEffect" &&
    node.arguments.length === 2 &&
    ts.isArrowFunction(node.arguments[0]) &&
    ts.isArrayLiteralExpression(node.arguments[1])
  ) {
    const callback = node.arguments[0].getText(sourceFile);
    if (
      callback.includes("getMyTasksSplitIndex(boardSplitSources, boardParam)") &&
      callback.includes("groupBy")
    ) {
      return node.arguments[1].elements.map((dependency) =>
        dependency.getText(sourceFile),
      );
    }
  }

  for (const child of node.getChildren(sourceFile)) {
    const result = findTimeSplitSyncDependencies(child);
    if (result) return result;
  }
  return null;
}

test("time-grouping URL sync ignores values derived from the active split", () => {
  const dependencies = findTimeSplitSyncDependencies(sourceFile);
  assert.ok(dependencies, "time-grouping URL sync effect exists");
  assert.ok(
    !dependencies.includes("filteredSections"),
    "Tab changes filteredSections before the board param updates, so this effect must not rerun on it",
  );
});
