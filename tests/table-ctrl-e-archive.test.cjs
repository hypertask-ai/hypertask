const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tableView = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/Kanban/TableView/TableView.tsx",
  ),
  "utf8",
);

const archiveHelperStart = tableView.indexOf("const archiveTaskFromTable");
const archiveHelperEnd = tableView.indexOf("useEffect(() =>", archiveHelperStart);
const archiveHelper = tableView.slice(archiveHelperStart, archiveHelperEnd);
const shortcutStart = tableView.indexOf("// [ctrl/cmd]+[e]");
const nextShortcut = tableView.indexOf("// [c] creates a task", shortcutStart);
const ctrlEBranch = tableView.slice(shortcutStart, nextShortcut);

test("Table view owns Ctrl/Cmd+E and archives only the selected task once", () => {
  assert.notEqual(shortcutStart, -1, "the table archive shortcut must exist");
  assert.match(
    ctrlEBranch,
    /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "e"/,
  );

  const preventDefaultAt = ctrlEBranch.indexOf("e.preventDefault()");
  const repeatGuardAt = ctrlEBranch.indexOf(
    "if (!shouldRunArchiveShortcut(e)) return",
  );
  const selectedRowAt = ctrlEBranch.indexOf("rows[selectedIndex]");
  const archiveAt = ctrlEBranch.indexOf("archiveTaskFromTable(");

  assert.ok(preventDefaultAt >= 0, "Edge's native Ctrl+E action must be suppressed");
  assert.ok(repeatGuardAt >= 0, "held-key repeats must be ignored");
  assert.match(tableView, /from "@\/lib\/keyboard\/archiveShortcutGuard"/);
  assert.ok(selectedRowAt >= 0, "the selected table row must supply the task");
  assert.ok(archiveAt >= 0, "the selected task must be archived");
  assert.ok(
    selectedRowAt < preventDefaultAt &&
      preventDefaultAt < repeatGuardAt &&
      repeatGuardAt < archiveAt,
    "a valid selected task must be confirmed before consuming the browser shortcut",
  );
});

test("Table archive supports both board rows and cross-board My Tasks rows", () => {
  assert.notEqual(archiveHelperStart, -1, "the shared table archive helper must exist");
  assert.match(archiveHelper, /if \(_currentProject\)/);
  assert.match(archiveHelper, /removeFromListWithStatus\(/);
  assert.match(archiveHelper, /globalAPIHandlers\.archiveTask\(task\.id, "Archive"\)/);
  assert.match(archiveHelper, /router\.refresh\(\)/);
});
