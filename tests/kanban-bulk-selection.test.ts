import assert from "node:assert/strict";
import test from "node:test";

import { CommandMode } from "../src/models/enums";
import { getAllCommands } from "../src/components/Modals/commands/HTC/AllCommands";
import {
  getInclusiveRange,
  getSharedProjectId,
  getTaskIdsByGroup,
  toggleId,
  toggleVisibleIds,
} from "../src/lib/kanbanBulkSelection";

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

test("table range groups keep My Tasks boards separate", () => {
  const groups = getTaskIdsByGroup(
    [
      { id: 11, projectId: 3 },
      { id: 12, projectId: 3 },
      { id: 21, projectId: 4 },
    ],
    (task) => task.projectId,
  );
  assert.deepEqual(getInclusiveRange(groups.get(3) ?? [], 11, 12), [11, 12]);
  assert.deepEqual(getInclusiveRange(groups.get(4) ?? [], 11, 21), [21]);
});

test("select all toggles only the visible task ids", () => {
  assert.deepEqual([...toggleVisibleIds(new Set([99]), [11, 12])], [99, 11, 12]);
  assert.deepEqual([...toggleVisibleIds(new Set([99, 11, 12]), [11, 12])], [99]);
});

test("project-scoped bulk actions require one shared board", () => {
  assert.equal(getSharedProjectId([{ projectId: 3 }, { projectId: 3 }]), 3);
  assert.equal(getSharedProjectId([{ projectId: 3 }, { projectId: 4 }]), null);
  assert.equal(getSharedProjectId([]), null);
});

test("table range selection follows visible order inside one board", () => {
  const groups = getTaskIdsByGroup(
    [
      { id: 31, projectId: 3 },
      { id: 41, projectId: 4 },
      { id: 32, projectId: 3 },
      { id: 33, projectId: 3 },
    ],
    (task) => task.projectId,
  );

  assert.deepEqual(getInclusiveRange(groups.get(3) ?? [], 31, 33), [
    31,
    32,
    33,
  ]);
});

test("select all leaves hidden selections intact when no rows are visible", () => {
  assert.deepEqual([...toggleVisibleIds(new Set([99]), [])], [99]);
});

test("project-scoped actions reject tasks with no board", () => {
  assert.equal(
    getSharedProjectId([{ projectId: 3 }, { projectId: undefined }]),
    null,
  );
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
