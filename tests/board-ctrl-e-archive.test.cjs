const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const taskCard = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
  ),
  "utf8",
);

test("board cards guard Ctrl/Cmd+E archive behind shared key state", () => {
  assert.match(taskCard, /from "@\/lib\/keyboard\/archiveShortcutGuard"/);

  const branchStart = taskCard.indexOf(
    "if (e.keyCode === KeyCodes.E && cmdControl)",
  );
  assert.notEqual(branchStart, -1, "the board archive shortcut must exist");
  const branch = taskCard.slice(branchStart, branchStart + 800);

  const guardAt = branch.indexOf("if (!shouldRunArchiveShortcut(e)) return");
  const archiveAt = branch.indexOf("markAsDone(");
  assert.ok(guardAt >= 0, "held-key repeats must be blocked");
  assert.ok(archiveAt >= 0, "the selected card must be archived");
  assert.ok(guardAt < archiveAt, "the guard must run before archiving");
});
