import assert from "node:assert/strict";
import test from "node:test";

import type { IProject, ISection, ITask, IView } from "../src/models/model";
import { countTasksInSavedView } from "../src/lib/savedViews/savedViewTaskCounts";

const task = (id: number, sectionId: number): ITask =>
  ({ id, sectionId, status: "Normal", assignees: [] }) as unknown as ITask;

const column = (id: number, title: string, visibility: boolean): ISection => ({
  id,
  sectionId: id,
  section_title: title,
  ranking: String(id),
  visibility,
  items: [],
});

const board = (): ISection[] => [
  column(1, "Bugs", true),
  column(2, "No Flag", true),
];

const project = (): IProject =>
  ({
    id: 15,
    title: "Hypertask Product",
    section: board(),
    tasks: [
      task(101, 1),
      task(102, 1),
      task(103, 1),
      task(104, 1),
      task(105, 1),
      task(201, 2),
      task(202, 2),
      task(203, 2),
    ],
  }) as unknown as IProject;

const view = (columns: ISection[] | null): IView =>
  ({
    id: "agent-feedback",
    title: "Agent Feedback",
    board_columns_view: columns,
    board_filters: { addedFilters: [], matchFilters: "ANY" },
    board_subtask_setting: "None",
  }) as unknown as IView;

test("a saved view that hides a column counts only the cards the view shows", () => {
  const hidden = [column(1, "Bugs", true), column(2, "No Flag", false)];
  assert.equal(countTasksInSavedView(view(hidden), project(), hidden, {}), 5);
});

test("hiding a column in the active view lowers the count before it is saved", () => {
  const saved = board();
  const live = [column(1, "Bugs", true), column(2, "No Flag", false)];
  assert.equal(countTasksInSavedView(view(saved), project(), live, {}), 5);
});

test("showing the column again raises the count", () => {
  const saved = board();
  const live = [column(1, "Bugs", true), column(2, "No Flag", true)];
  assert.equal(countTasksInSavedView(view(saved), project(), live, {}), 8);
});

test("an empty saved column list still counts the board's columns", () => {
  const saved = board();
  assert.equal(countTasksInSavedView(view([]), project(), [], {}), 8);
  assert.equal(countTasksInSavedView(view(null), project(), undefined, {}), 8);
});

test("a view with every column visible keeps its full count", () => {
  const saved = board();
  assert.equal(countTasksInSavedView(view(saved), project(), saved, {}), 8);
});
