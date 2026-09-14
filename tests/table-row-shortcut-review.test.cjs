const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const table = fs.readFileSync(
  path.join(
    root,
    "src/components/PageComponents/Kanban/TableView/TableView.tsx",
  ),
  "utf8",
);
const commands = fs.readFileSync(
  path.join(root, "src/components/commands.tsx"),
  "utf8",
);
const fallback = fs.readFileSync(
  path.join(root, "src/lib/keyboard/taskProjectFallback.ts"),
  "utf8",
);

test("table E shortcut requires a positive notification count", () => {
  const handler = table.slice(
    table.indexOf("const archiveNotificationFromTable"),
    table.indexOf("const closeAssignModal"),
  );
  assert.match(handler, /if \(!task\._count\?\.notifications\)/);
  assert.ok(
    handler.indexOf("return;") <
      handler.indexOf("archiveTaskNotification(task.id"),
  );
  assert.ok(
    handler.indexOf("archiveTaskNotification(task.id") <
      handler.indexOf('toast("Notifications archived")'),
  );
});

test("pending table assignment clears when disabled or loading fails", () => {
  assert.match(
    table,
    /if \(!rowShortcutsEnabled\) \{\s*setAssignTask\(null\);\s*return;/,
  );
  assert.match(
    table,
    /if \(isAssignProjectError\) \{\s*setAssignTask\(null\);\s*toast\.error\("Unable to load assignees"\);/,
  );
});

test("table selection reconciles by task id and clears a missing task", () => {
  assert.match(
    table,
    /rows\.findIndex\(\s*\(row\) => isTaskRow\(row\) && row\.task\.id === selectedTaskId/,
  );
  assert.match(
    table,
    /selectedTaskIdRef\.current = null;\s*setSelectedIndex\(-1\);\s*setPersistedActiveItem\(null\);/,
  );
});

test("My Tasks fallback loads only the active modal resource", () => {
  assert.match(
    commands,
    /CommandMode\.OpenAssignModal[\s\S]*?"assign"[\s\S]*?CommandMode\.LabelModal[\s\S]*?"labels"[\s\S]*?CommandMode\.MoveToColumn[\s\S]*?"sections"/,
  );
  assert.doesNotMatch(fallback, /Promise\.all/);
});
