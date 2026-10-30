const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
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
const shortcutStart = tableView.indexOf("if ((e.ctrlKey || e.metaKey) && e.keyCode");
const nextShortcut = tableView.indexOf("if (_currentProject && e.key ===", shortcutStart);
const ctrlEBranch = tableView.slice(shortcutStart, nextShortcut);

test("Table view owns Ctrl/Cmd+E and archives only the selected task once", () => {
  assert.notEqual(shortcutStart, -1, "the table archive shortcut must exist");
  assert.match(
    ctrlEBranch,
    /\(e\.ctrlKey \|\| e\.metaKey\) && e\.keyCode === KeyCodes\.E/,
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
  assert.match(tableView, /from "@\/lib\/constants\/keyboard-handler"/);
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
  assert.match(archiveHelper, /setExcludedTaskIds/);
  assert.match(tableView, /excludedTaskIds/);
  assert.match(
    tableView,
    /if \(presentIds\.has\(id\)\) next\.add\(id\);[\s\S]*else changed = true;[\s\S]*return changed \? next : previous;/,
  );
});

test("Table rows take DOM focus on hover so Ctrl+E is not blocked by leftover chat focus", () => {
  assert.match(tableView, /focusRowElement/);
  assert.match(tableView, /tabIndex=\{-1\}/);
  assert.match(
    tableView,
    /const focusRowElement[\s\S]*element instanceof HTMLElement[\s\S]*element\.focus\(\{ preventScroll: true \}\)/,
  );
  const mouseEnterStart = tableView.indexOf("const handleMouseEnter");
  const mouseEnterEnd = tableView.indexOf("const handleMouseLeave", mouseEnterStart);
  const mouseEnter = tableView.slice(mouseEnterStart, mouseEnterEnd);
  assert.match(mouseEnter, /focusRowElement\(row\.task\.id\)/);
});
