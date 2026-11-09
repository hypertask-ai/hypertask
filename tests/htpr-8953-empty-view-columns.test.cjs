const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

const views = load("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", {
  "@/lib/firstScreen/boardView": {},
  "@/utils/helperFunctions/helperFunctions": {},
  "./FilterHelperFunctions": {},
  "./TableColumnsHelperFunctions": {},
  "./SubtaskHelperFunction": {},
  "./EmptySectionsHelperFunction": {},
});
const { getActiveColumnsViewFromProject, columnListOrBoardColumns } = views;

const column = (id, title, ranking, visibility = true) => ({
  id,
  sectionId: id,
  section_title: title,
  ranking,
  visibility,
  items: [],
});

const boardColumns = [
  column(1, "Backlog", "A1"),
  column(2, "In Progress", "A2"),
  column(3, "Done", "A3"),
];

const project = (viewColumns, extra = {}) => ({
  id: 15,
  section: boardColumns.map((entry) => ({ ...entry })),
  project_view: {
    default_view: { board_columns_view: null },
    user_project_views: [
      {
        appliedView: { board_columns_view: viewColumns },
        unsavedView: null,
      },
    ],
  },
  ...extra,
});

test("a saved view with an empty column list shows the board's columns", () => {
  const resolved = getActiveColumnsViewFromProject(project([]));
  assert.deepEqual(
    resolved.map((entry) => entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
  assert.ok(resolved.every((entry) => entry.visibility === true));
});

test("a saved view with no column list at all shows the board's columns", () => {
  assert.deepEqual(
    getActiveColumnsViewFromProject(project(null)).map((entry) => entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
  const missing = project(null);
  delete missing.project_view.user_project_views[0].appliedView;
  assert.deepEqual(
    getActiveColumnsViewFromProject(missing).map((entry) => entry.title ?? entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
});

test("a saved view with columns keeps its own list, visibility and board order", () => {
  const resolved = getActiveColumnsViewFromProject(
    project([
      { id: 3, section_title: "Done", ranking: "A3", visibility: false },
      { id: 1, section_title: "Backlog", ranking: "A1", visibility: true },
    ])
  );
  assert.deepEqual(
    resolved.map((entry) => [entry.section_title, entry.visibility]),
    [
      ["Backlog", true],
      ["Done", false],
    ]
  );
});

test("an unsaved view column list wins over the applied view", () => {
  const withUnsaved = project([]);
  withUnsaved.project_view.user_project_views[0].unsavedView = {
    board_columns_view: [{ id: 2, section_title: "In Progress", ranking: "A2", visibility: true }],
  };
  assert.deepEqual(
    getActiveColumnsViewFromProject(withUnsaved).map((entry) => entry.section_title),
    ["In Progress"]
  );
  withUnsaved.project_view.user_project_views[0].unsavedView = { board_columns_view: [] };
  assert.deepEqual(
    getActiveColumnsViewFromProject(withUnsaved).map((entry) => entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
});

test("a board with no columns still resolves to an empty list", () => {
  assert.deepEqual(getActiveColumnsViewFromProject(project([], { section: [] })), []);
  assert.deepEqual(columnListOrBoardColumns([], undefined), []);
});

test("the board keeps its columns when the view lists them out of order", () => {
  const resolved = getActiveColumnsViewFromProject(
    project([
      { id: 2, section_title: "In Progress", ranking: "A2", visibility: true },
      { id: 1, section_title: "Backlog", ranking: "A1", visibility: true },
      { id: 3, section_title: "Done", ranking: "A3", visibility: true },
    ])
  );
  assert.deepEqual(
    resolved.map((entry) => entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
});

test("view tab counts use the same fallback as the board", () => {
  const hook = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/Homepage/Views/useRenderedViews.ts"),
    "utf8"
  );
  assert.ok(
    hook.includes("savedColumns.length > 0"),
    "a view with an empty column list must count its tickets against the board's columns"
  );
  assert.ok(
    !hook.includes("board_columns_view as ISection[] | undefined) ?? project?.section ?? []"),
    "the raw nullish fallback leaves an empty list counting zero tickets"
  );
});

const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(__dirname, "..", "src") },
  interopDefault: true,
  cache: false,
});
const { viewColumnsToWrite } = jiti(
  path.join(__dirname, "..", "src/utils/controllers/section/viewColumnVisibility.ts")
);

test("a save with no column list keeps the stored columns", () => {
  assert.equal(viewColumnsToWrite(undefined), null);
  assert.equal(viewColumnsToWrite(null), null);
  assert.equal(viewColumnsToWrite([]), null);
});

test("a new view with no column list stores the board's columns", () => {
  assert.deepEqual(
    viewColumnsToWrite(undefined, boardColumns).map((entry) => entry.section_title),
    ["Backlog", "In Progress", "Done"]
  );
  assert.equal(viewColumnsToWrite([], []), null);
  assert.deepEqual(
    viewColumnsToWrite([{ id: 9 }], boardColumns),
    [{ id: 9 }],
    "a real saved list is written as it came in"
  );
});

test("a column change rewrites a view that lost its columns instead of leaving it empty", async () => {
  const writes = [];
  const prismaStub = {
    $transaction: async (operation) => operation(prismaStub),
    $queryRaw: async () => [],
    section: {
      findMany: async () => [
        { id: 1, section_title: "Backlog", ranking: "A1", projectId: 15, deleted: false },
        { id: 2, section_title: "In Progress", ranking: "A2", projectId: 15, deleted: false },
        { id: 3, section_title: "Done", ranking: "A3", projectId: 15, deleted: false },
      ],
    },
    view: {
      findMany: async () => [
        { id: "broken", board_columns_view: [] },
        { id: "healthy", board_columns_view: [{ id: 1, section_title: "Backlog", ranking: "A1", visibility: true }] },
      ],
      update: async (args) => {
        writes.push(args);
        return args.data;
      },
    },
  };
  const helpers = load("src/utils/controllers/section/viewHelpers.ts", {
    "@/lib/prisma": { __esModule: true, default: prismaStub },
  });
  await helpers.removeSectionFromAllViews(2, 15);
  const broken = writes.find((write) => write.where.id === "broken");
  const healthy = writes.find((write) => write.where.id === "healthy");
  assert.deepEqual(
    broken.data.board_columns_view.map((column) => column.id),
    [1, 3],
    "a view with no stored columns gets the board's columns, minus the deleted one"
  );
  assert.deepEqual(
    healthy.data.board_columns_view.map((column) => column.id),
    [1]
  );
});

test("adding a column writes it once into a view that had no stored columns", async () => {
  const writes = [];
  const boardSections = [
    { id: 1, section_title: "Backlog", ranking: "A1", projectId: 15, deleted: false },
    { id: 4, section_title: "QA", ranking: "A4", projectId: 15, deleted: false },
  ];
  const prismaStub = {
    $transaction: async (operation) => operation(prismaStub),
    $queryRaw: async () => [],
    section: { findMany: async () => boardSections },
    view: {
      findMany: async () => [{ id: "broken", board_columns_view: [] }],
      update: async (args) => {
        writes.push(args);
        return args.data;
      },
    },
  };
  const helpers = load("src/utils/controllers/section/viewHelpers.ts", {
    "@/lib/prisma": { __esModule: true, default: prismaStub },
  });
  await helpers.appendSectionToAllViews(15, boardSections[1]);
  assert.deepEqual(
    writes[0].data.board_columns_view.map((column) => column.id),
    [1, 4]
  );
});
