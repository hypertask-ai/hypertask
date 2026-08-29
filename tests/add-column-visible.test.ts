// HTPR-5527. Add Column: typing a name and pressing Enter closed the dialog and
// left the board unchanged, with no error.
//
// Two things caused it. The section was written to the database and then hidden:
// appendSectionToAllViews stored `visibility: <is this view mine?>` on the new
// column, and the board only renders view columns with `visibility: true`, so a
// board whose active view belongs to anyone else (its default view, a shared
// public view) swallowed the column. And the dialog computed the new column's
// rank from /api/section/getProjectSections first, an endpoint that answers 200
// with an error body, so a bad read made Enter do nothing at all.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildViewColumnEntry } from "../src/utils/controllers/section/viewColumnEntry";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// What getCurrentProject does with a view's board_columns_view before the board
// renders it: hidden columns never reach the screen.
const renderedColumns = (columns: Array<{ visibility?: boolean; section_title?: string }>) =>
  columns.filter((column) => column.visibility).map((column) => column.section_title);

const newSection = {
  id: 991,
  section_title: "Verify Queue",
  ranking: "A1650.000000000000000",
  projectId: 15,
  visibility: true,
  deleted: false,
  isDone: null,
};

test("a new column renders in a view owned by someone else", () => {
  const existing = [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 2, section_title: "Doing", visibility: true },
    { id: 3, section_title: "Done", visibility: true },
  ];
  // The board's default view, created by whoever made the board.
  const defaultViewColumns = [...existing, buildViewColumnEntry(newSection)];

  assert.deepStrictEqual(renderedColumns(defaultViewColumns), [
    "Todo",
    "Doing",
    "Done",
    "Verify Queue",
  ]);
});

test("the new column keeps its section title and ranking for the view", () => {
  const entry = buildViewColumnEntry(newSection);
  assert.strictEqual(entry.title, "Verify Queue");
  assert.strictEqual(entry.section_title, "Verify Queue");
  assert.strictEqual(entry.ranking, "A1650.000000000000000");
  assert.strictEqual(entry.id, 991);
});

test("appending a section to views never keys visibility off the acting user", () => {
  const helpers = read("src/utils/controllers/section/viewHelpers.ts");
  const append = helpers.slice(helpers.indexOf("export async function appendSectionToAllViews"));
  const body = append.slice(0, append.indexOf("\n}"));
  assert.ok(
    !/visibility:\s*(isOwnedByCurrentUser|[^t\n]*currentUserId)/.test(body),
    "new columns must be visible in every view, not only the creator's",
  );
});

test("Add Column does not compute its own rank from getProjectSections", () => {
  const dialog = read("src/components/Modals/commands/addColumn.tsx");
  assert.ok(
    !dialog.includes("getProjectSections"),
    "the dialog must not depend on a read that can answer 200 with an error body",
  );
  assert.ok(
    !dialog.includes("generateRank"),
    "the server appends the column after the last section; the client must not rank it",
  );
});

test("the create route accepts a column with no ranking", () => {
  const route = read("src/pages/api/section/create.ts");
  assert.ok(
    !route.includes("Missing ranking or after_section_id"),
    "omitting ranking must append the column, not fail the request",
  );
  assert.ok(
    route.includes('return res.status(400).json({ message: "Missing projectId or title" })'),
    "projectId and title stay required",
  );
});

test("a failed create reports an error instead of closing silently", () => {
  const commands = read("src/components/commands.tsx");
  const start = commands.indexOf("const createColumn = async");
  const createColumn = commands.slice(start, commands.indexOf("const updateBoard", start));
  assert.ok(
    /catch\s*\(error\)\s*{[\s\S]*toast\.error\("Error creating column"\)/.test(createColumn),
    "axios rejects on 4xx/5xx, so the rejection must surface to the user",
  );
});
