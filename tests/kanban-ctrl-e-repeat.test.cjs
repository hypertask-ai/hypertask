// HTPR-5197: holding Ctrl/Cmd+E on a kanban card repeatedly archived every
// task the advancing focus selected. Browser key repeat must never repeat a
// destructive shortcut, while a fresh press must still archive one task.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const taskCard = fs.readFileSync(
  path.join(
    root,
    "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
  ),
  "utf8",
);

const shortcutStart = taskCard.indexOf("// [ctrl]+[e]");
const nextShortcut = taskCard.indexOf(
  "// [s] for size / estimate",
  shortcutStart,
);
const ctrlEBranch = taskCard.slice(shortcutStart, nextShortcut);

test("Ctrl/Cmd+E archives only on the initial keydown", () => {
  assert.notEqual(shortcutStart, -1, "the kanban archive shortcut must exist");
  assert.match(
    ctrlEBranch,
    /e\.keyCode === KeyCodes\.E && cmdControl/,
    "the intended Ctrl/Cmd+E binding must remain available",
  );

  const preventDefaultAt = ctrlEBranch.indexOf("e.preventDefault()");
  // The repeat check lives in the shared archive key-state guard, which also
  // blocks platforms that deliver a held key as discrete presses.
  const repeatGuardAt = ctrlEBranch.indexOf("shouldRunArchiveShortcut(");
  const archiveAt = ctrlEBranch.indexOf("markAsDone(");

  assert.ok(
    preventDefaultAt >= 0,
    "the browser default must remain suppressed",
  );
  assert.ok(repeatGuardAt >= 0, "held-key repeats must be ignored");
  assert.ok(archiveAt >= 0, "a fresh key press must still archive the task");
  assert.ok(
    preventDefaultAt < repeatGuardAt && repeatGuardAt < archiveAt,
    "repeat events must be stopped before the archive mutation",
  );
});
