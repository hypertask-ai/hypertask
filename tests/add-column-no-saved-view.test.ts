// HTPR-5542. Add Column: the dialog closed, the section was created, and the
// board still showed only Todo / Doing / Done until a reload.
//
// A board that has never saved a view has no Project_View row, so
// /api/section/create answers `project_view: null`. The client only wrote the
// refreshed view back into the cache, so a null view meant no cache update at
// all. The board falls back to `project.section` when there is no view, and
// that list was never given the new column.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { IProject, ISection } from "../src/models/model";
import { appendCreatedSectionToProject } from "../src/utils/helperFunctions/Views/appendCreatedSection";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// The column source the board resolves, mirroring getActiveColumnsViewFromProject:
// the unsaved view, else the applied view, else the default view, else the
// project's own sections. A board with no saved view lands on that last branch.
const resolvedColumns = (project: IProject): ISection[] => {
  const view = project.project_view?.user_project_views?.[0];
  return (
    (view?.unsavedView?.board_columns_view as ISection[]) ??
    (view?.appliedView?.board_columns_view as ISection[]) ??
    (project.project_view?.default_view?.board_columns_view as ISection[]) ??
    project.section ??
    []
  );
};

const column = (id: number, title: string, ranking: string): ISection => ({
  id,
  section_title: title,
  ranking,
  visibility: true,
  items: [],
});

// A board with no saved view: project_view is absent, project.section is the
// only source the board can render from.
const boardWithNoView = (): IProject =>
  ({
    id: 15,
    tasks: [],
    sections: [],
    filteredSections: [],
    section: [
      column(1, "Todo", "A1000.000000000000000"),
      column(2, "Doing", "A2000.000000000000000"),
      column(3, "Done", "A3000.000000000000000"),
    ],
  } as unknown as IProject);

const created = column(4, "Verify Queue 1787215297479", "A4000.000000000000000");

const titles = (project: IProject) =>
  resolvedColumns(project)
    .filter((col) => col.visibility)
    .map((col) => col.section_title);

test("a new column renders on a board that has never saved a view", () => {
  const before = boardWithNoView();
  assert.deepStrictEqual(titles(before), ["Todo", "Doing", "Done"]);

  const after = appendCreatedSectionToProject(before, created);
  assert.deepStrictEqual(titles(after), [
    "Todo",
    "Doing",
    "Done",
    "Verify Queue 1787215297479",
  ]);
});

test("appending never mutates the cached project in place", () => {
  const before = boardWithNoView();
  const after = appendCreatedSectionToProject(before, created);
  assert.notStrictEqual(after, before);
  assert.strictEqual(before.section?.length, 3);
  assert.strictEqual(after.section?.length, 4);
});

test("a repeated create does not duplicate the column", () => {
  const once = appendCreatedSectionToProject(boardWithNoView(), created);
  const twice = appendCreatedSectionToProject(once, created);
  assert.strictEqual(twice, once);
  assert.strictEqual(twice.section?.length, 4);
});

test("no created section leaves the project untouched", () => {
  const before = boardWithNoView();
  assert.strictEqual(appendCreatedSectionToProject(before, undefined), before);
  assert.strictEqual(appendCreatedSectionToProject(before, null), before);
});

test("the board still falls back to project.section when no view exists", () => {
  const helpers = read("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts");
  assert.ok(
    helpers.includes("unsaved ?? applied ?? defaultView ?? project.section ?? []"),
    "the fallback this fix relies on must stay in getActiveColumnsViewFromProject",
  );
});

test("the cache update runs even when the create answers with no view", () => {
  const hook = read("src/hooks/MultiPages/useUpdateTaskInBoards.tsx");
  assert.ok(
    hook.includes("if (updatedProjectView || createdSection) {"),
    "a null project_view must still recompute the board's sections",
  );
  assert.ok(
    hook.includes("appendCreatedSectionToProject(projectToUpdate, createdSection)"),
    "the created section must reach project.section, the no-view fallback",
  );
});

test("createColumn hands the created section to the cache update", () => {
  const commands = read("src/components/commands.tsx");
  const start = commands.indexOf("const createColumn = async");
  const createColumn = commands.slice(start, commands.indexOf("const updateBoard", start));
  assert.ok(
    /updateProjectView\(\s*projectToUpdateIndex,\s*response\.data\.project_view,/.test(
      createColumn,
    ),
    "the created section must be passed alongside the refreshed view",
  );
});
