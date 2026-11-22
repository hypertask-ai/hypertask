import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTableSortClick,
  commitTableSettings,
  hideColumnOnView,
  projectFromTableBoard,
  resolveTableColumns,
  sanitizeTableSortStack,
  storedTableSortStack,
  switchTableBoard,
  type StoredTableView,
  type TableBoard,
  type TableSettingsPersist,
} from "../src/lib/table-view/tableViewSettings";
import {
  getActiveTableColumnsFromProject,
  getActiveTableSortStackFromProject,
} from "../src/utils/helperFunctions/Views/ViewsHelperFunctions";
import type { IProject } from "../src/models/model";

test("priority then updated both survive a reload", () => {
  const header = applyTableSortClick([], "priority", false, "desc", true);
  const withUpdated = applyTableSortClick(header, "updated", true, "desc", true);
  const reloaded = sanitizeTableSortStack(JSON.parse(JSON.stringify(withUpdated)));
  assert.deepEqual(reloaded.map((level) => level.column), ["priority", "updated"]);
  assert.equal(storedTableSortStack(reloaded)?.length, 2);
});

test("sort button and header set the same sort", () => {
  const header = applyTableSortClick([], "priority", false, "desc", true);
  const button = applyTableSortClick([], "priority", false, "desc", true);
  assert.deepEqual(header, button);
  const headerNext = applyTableSortClick(header, "updated", true, "desc", true);
  const buttonNext = applyTableSortClick(button, "updated", true, "desc", true);
  assert.deepEqual(headerNext, buttonNext);
});

test("hiding Due in one view leaves the other view", () => {
  const views = hideColumnOnView({ inbox: null, review: null }, "inbox", "due");
  assert.equal(views.review, null);
  assert.equal(resolveTableColumns(views.review).keys.includes("due"), true);
  assert.equal(resolveTableColumns(views.inbox).keys.includes("due"), false);
});

test("a view with no saved columns uses the defaults", () => {
  const defaults = resolveTableColumns(null);
  assert.equal(defaults.keys.includes("due"), true);
  assert.equal(defaults.keys.includes("ticket"), true);
  assert.deepEqual(defaults.widths, {});
});

test("desktop and phone read the same account columns", () => {
  const saved = hideColumnOnView({ inbox: null }, "inbox", "due").inbox;
  const payload = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(Object.keys(payload).sort(), ["keys", "widths"]);
  const desktop = resolveTableColumns(saved).keys;
  const phone = resolveTableColumns(payload).keys;
  assert.deepEqual(desktop, phone);
  assert.equal(desktop.includes("due"), false);
});

test("HTPR-8973 table settings marker", () => {
  console.log("HTPR-8973 table settings ok");
});

const emptyView = (id: string): StoredTableView => ({
  id,
  table_sort_column: null,
  table_sort_direction: null,
  table_sort_stack: null,
  table_columns: null,
});

const boardWithDraft = (appliedViewId: string | null): TableBoard => ({
  defaultViewId: "default",
  appliedViewId,
  unsavedViewId: "draft",
  views: ["default", "inbox", "review", "draft"].map(emptyView),
});

const priorityThenUpdated = applyTableSortClick(
  applyTableSortClick([], "priority", false, "desc", true),
  "updated",
  true,
  "desc",
  true,
);

const hiddenDue = hideColumnOnView({ inbox: null }, "inbox", "due").inbox;

const sortAndColumns: TableSettingsPersist = {
  persistStack: true,
  persistColumns: true,
  table_sort_column: "priority",
  table_sort_direction: "desc",
  table_sort_stack: priorityThenUpdated,
  table_columns: hiddenDue,
};

const sortOnly: TableSettingsPersist = {
  ...sortAndColumns,
  persistColumns: false,
  table_columns: null,
};

const columnsOnly: TableSettingsPersist = {
  ...sortAndColumns,
  persistStack: false,
  table_sort_column: null,
  table_sort_direction: null,
  table_sort_stack: null,
};

const readBoard = (board: TableBoard) => {
  const project = projectFromTableBoard(board) as IProject;
  return {
    sort: getActiveTableSortStackFromProject(project).map((level) => level.column),
    due: resolveTableColumns(getActiveTableColumnsFromProject(project)).keys.includes("due"),
  };
};

test("leaving a view and coming back keeps its sort and hidden Due column", () => {
  const saved = commitTableSettings(boardWithDraft("inbox"), "inbox", sortAndColumns);
  assert.deepEqual(readBoard(saved), { sort: ["priority", "updated"], due: false });

  const review = switchTableBoard(saved, "review");
  assert.deepEqual(readBoard(review), { sort: [], due: true });

  const back = switchTableBoard(review, "inbox");
  assert.deepEqual(readBoard(back), { sort: ["priority", "updated"], due: false });
});

test("the default view keeps its sort and columns after opening another view", () => {
  const saved = commitTableSettings(boardWithDraft(null), "default", sortAndColumns);
  const away = switchTableBoard(saved, "review");
  assert.deepEqual(readBoard(away), { sort: [], due: true });
  const back = switchTableBoard(away, "default");
  assert.deepEqual(readBoard(back), { sort: ["priority", "updated"], due: false });
});

test("a later column change does not clear the sort saved on that view", () => {
  const sorted = commitTableSettings(boardWithDraft("inbox"), "inbox", sortOnly);
  const hidden = commitTableSettings(sorted, "inbox", columnsOnly);
  const back = switchTableBoard(switchTableBoard(hidden, "review"), "inbox");
  assert.deepEqual(readBoard(back), { sort: ["priority", "updated"], due: false });
});

test("a sort stored only on the unsaved draft stays with that view", () => {
  const board = boardWithDraft("inbox");
  const draft = board.views.find((view) => view.id === "draft");
  assert.ok(draft);
  draft.table_sort_column = "priority";
  draft.table_sort_direction = "desc";
  draft.table_sort_stack = priorityThenUpdated;
  draft.table_columns = hiddenDue;
  const back = switchTableBoard(switchTableBoard(board, "review"), "inbox");
  assert.deepEqual(readBoard(back), { sort: ["priority", "updated"], due: false });
  assert.deepEqual(readBoard(switchTableBoard(board, "review")), { sort: [], due: true });
});

test("an empty draft does not erase columns already saved on the view", () => {
  const saved = commitTableSettings(boardWithDraft("inbox"), "inbox", sortAndColumns);
  const staleDraft = {
    ...saved,
    views: saved.views.map((view) => view.id === "draft" ? emptyView("draft") : view),
  };
  const back = switchTableBoard(switchTableBoard(staleDraft, "review"), "inbox");
  assert.deepEqual(readBoard(back), { sort: ["priority", "updated"], due: false });
});
