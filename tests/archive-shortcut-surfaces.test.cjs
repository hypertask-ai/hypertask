const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Ctrl/Cmd+E archives and then advances the selection, so every surface that
// binds it must block held keys through the same shared key state.
// Guarding only the board leaves the sibling lists able to wipe a run of tasks
// from a single long press.
const SURFACES = [
  "src/components/PageComponents/Starred/StarredRowComp.tsx",
  "src/app/all-tasks/AllTasks.tsx",
  "src/app/scheduled/index.tsx",
  "src/app/detail/[...slug]/TaskDetailComp.tsx",
  "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
  "src/components/PageComponents/Kanban/TableView/TableView.tsx",
];

for (const relative of SURFACES) {
  test(`${relative} guards Ctrl/Cmd+E archive`, () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", relative),
      "utf8",
    );
    assert.match(source, /from "@\/lib\/keyboard\/archiveShortcutGuard"/);

    const branchStart = source.search(
      /KeyCodes\.E && cmdControl|e\.key\.toLowerCase\(\) === "e"/,
    );
    assert.notEqual(branchStart, -1, "the archive shortcut must exist");
    const branch = source.slice(branchStart, branchStart + 600);

    const guardAt = branch.indexOf("shouldRunArchiveShortcut(");
    const archiveAt = branch.search(
      /markAsDone\(|archiveTaskHandler\(|archiveTaskFromTable\(/,
    );
    assert.ok(guardAt >= 0, "held-key repeats must be blocked");
    assert.ok(archiveAt >= 0, "the selected task must be archived");
    assert.ok(guardAt < archiveAt, "the guard must run before archiving");
  });
}
