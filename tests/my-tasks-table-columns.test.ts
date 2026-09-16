import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  effectiveMyTasksTableVisibleColumns,
  parseMyTasksViewConfig,
} from "../src/models/MyTasksView";
import {
  DEFAULT_MY_TASKS_TABLE_COLUMNS,
  DEFAULT_TABLE_COLUMNS,
  normalizeMyTasksTableVisibleColumns,
  normalizeTableVisibleColumns,
  withForcedStatusWhileSorted,
} from "../src/utils/helperFunctions/Views/TableColumnsHelperFunctions";

test("My Tasks default columns match today's board table default snapshot", () => {
  assert.deepEqual(DEFAULT_MY_TASKS_TABLE_COLUMNS, DEFAULT_TABLE_COLUMNS);
});

test("normalizeMyTasksTableVisibleColumns keeps board/labels and rejects board-only keys", () => {
  assert.deepEqual(
    normalizeMyTasksTableVisibleColumns([
      "ticket",
      "title",
      "board",
      "labels",
      "status",
    ]),
    ["ticket", "title", "board", "labels", "status"],
  );
  assert.deepEqual(
    normalizeMyTasksTableVisibleColumns(["ticket", "title", "inColumn"]),
    [...DEFAULT_MY_TASKS_TABLE_COLUMNS],
  );
  assert.deepEqual(
    normalizeMyTasksTableVisibleColumns(["ticket", "title", "board", "board", "due"]),
    ["ticket", "title", "board", "due"],
  );
});

test("board normalize still rejects My Tasks-only keys", () => {
  assert.deepEqual(
    normalizeTableVisibleColumns(["ticket", "title", "board"]),
    [...DEFAULT_TABLE_COLUMNS],
  );
});

test("parseMyTasksViewConfig preserves tableVisibleColumns when flag-unrelated fields change", () => {
  const saved = parseMyTasksViewConfig({
    tableVisibleColumns: ["ticket", "title", "board", "due"],
    filters: { showDone: true },
  });
  assert.deepEqual(saved.tableVisibleColumns, ["ticket", "title", "board", "due"]);

  const afterUnrelatedEdit = parseMyTasksViewConfig({
    ...saved,
    filters: { ...saved.filters, starred: true },
  });
  assert.deepEqual(afterUnrelatedEdit.tableVisibleColumns, [
    "ticket",
    "title",
    "board",
    "due",
  ]);
  assert.equal(afterUnrelatedEdit.filters.starred, true);
  assert.equal(afterUnrelatedEdit.filters.showDone, true);
});

test("missing tableVisibleColumns uses today's default; malformed falls back", () => {
  assert.equal(parseMyTasksViewConfig({}).tableVisibleColumns, undefined);
  assert.deepEqual(
    effectiveMyTasksTableVisibleColumns(parseMyTasksViewConfig({})),
    [...DEFAULT_MY_TASKS_TABLE_COLUMNS],
  );
  assert.deepEqual(
    parseMyTasksViewConfig({ tableVisibleColumns: ["nope"] }).tableVisibleColumns,
    [...DEFAULT_MY_TASKS_TABLE_COLUMNS],
  );
  assert.deepEqual(parseMyTasksViewConfig(null), DEFAULT_MY_TASKS_VIEW_CONFIG);
});

test("My Tasks does not force status back while sorted; board table still does", () => {
  const withoutStatus = ["ticket", "title", "board", "due"];
  assert.deepEqual(
    withForcedStatusWhileSorted(withoutStatus, true, false),
    withoutStatus,
  );
  assert.deepEqual(
    withForcedStatusWhileSorted(withoutStatus, true, true),
    ["ticket", "title", "status", "board", "due"],
  );
});
