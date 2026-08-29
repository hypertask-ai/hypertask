import assert from "node:assert/strict";
import test from "node:test";

import { CommandMode } from "../src/models/enums";
import { getAllCommands } from "../src/components/Modals/commands/HTC/AllCommands";
import { getInclusiveRange, toggleId } from "../src/lib/kanbanBulkSelection";

test("range selection includes every card between the anchor and target", () => {
  assert.deepEqual(getInclusiveRange([11, 12, 13, 14], 13, 11), [11, 12, 13]);
});

test("range selection falls back to the target when the anchor is not in the column", () => {
  assert.deepEqual(getInclusiveRange([11, 12, 13], 99, 12), [12]);
});

test("toggling selection adds and removes one task without changing others", () => {
  const selected = new Set([11, 13]);
  assert.deepEqual([...toggleId(selected, 12)], [11, 13, 12]);
  assert.deepEqual([...toggleId(selected, 11)], [13]);
});

test("the command center exposes batch actions only when tasks are selected", () => {
  const selectedGroup = getAllCommands({
    context: "Kanban",
    bulkSelectionCount: 2,
  }).find((group) => group.group === "Selected tasks");
  const emptyGroup = getAllCommands({ context: "Kanban" }).find(
    (group) => group.group === "Selected tasks",
  );

  assert.deepEqual(
    selectedGroup?.commandLists.map((command) => command.commandMode),
    [
      CommandMode.MoveToColumn,
      CommandMode.OpenAssignModal,
      CommandMode.LabelModal,
      CommandMode.ArchiveTask,
    ],
  );
  assert.equal(emptyGroup, undefined);
});
