const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const archiveHook = fs.readFileSync(
  path.join(root, "src/hooks/Task Detail/useArchiveAndNavigate.ts"),
  "utf8",
);
const boardUpdateHook = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/useUpdateTaskInBoards.tsx"),
  "utf8",
);

test("task-detail archive undo returns to the exact restored task", () => {
  assert.match(archiveHook, /const isUnarchiving = currentTask\.status === "Archive"/);
  assert.match(
    archiveHook,
    /undoRedirectPath: isUnarchiving[\s\S]*?\? undefined[\s\S]*?: `\/detail\/project-\$\{currentTask\.projectId\}\/\$\{currentTask\.uniqueIndex\}`/,
  );
});

test("shared archive undo restores data before following an optional return path", () => {
  const undoStart = boardUpdateHook.indexOf("const undoHandler = async");
  const undoEnd = boardUpdateHook.indexOf("async function deleteTodo", undoStart);
  const undoHandler = boardUpdateHook.slice(undoStart, undoEnd);

  assert.ok(undoStart >= 0 && undoEnd > undoStart, "undo handler must exist");
  assert.match(undoHandler, /await undoAction\("UNDO_REMOVE", data\)/);
  assert.match(undoHandler, /await queryClient\.refetchQueries/);
  assert.match(undoHandler, /typeof data\.undoRedirectPath === "string"/);
  assert.match(undoHandler, /router\.replace\(data\.undoRedirectPath\)/);

  assert.ok(
    undoHandler.indexOf('await undoAction("UNDO_REMOVE", data)') <
      undoHandler.indexOf("router.replace(data.undoRedirectPath)"),
    "the task must be restored before navigation",
  );
});
