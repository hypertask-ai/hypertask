// HTPR-5937. "Show in all views" / "Hide in all views" in the column editor.
//
// Column order and new-column visibility already follow the board (HTPR-5047,
// HTPR-5527). What was missing was switching one existing column on or off
// across every saved view at once, instead of opening each view and toggling.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const { applyColumnVisibility, isColumnVisibleInView } = jiti(
  path.join(root, "src/utils/controllers/section/viewColumnVisibility.ts"),
);
const { countViewsShowingColumn, describeViewsShowingColumn } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ColumnAllViewsHelper.ts"),
);

const qa = {
  id: 991,
  section_title: "QA",
  ranking: "A1650.000000000000000",
  projectId: 15,
};

test("showing a column a view never had appends it", () => {
  const columns = [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 2, section_title: "Done", visibility: true },
  ];
  const updated = applyColumnVisibility(columns, qa, true);
  assert.equal(updated.length, 3);
  assert.deepEqual(
    updated.map((column) => [column.id, column.visibility]),
    [
      [1, true],
      [2, true],
      [991, true],
    ],
  );
  // The caller must not be handed back its own array to mutate.
  assert.equal(columns.length, 2);
});

test("showing a column the view hid flips it back on and adds nothing", () => {
  const columns = [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 991, section_title: "QA", visibility: false },
  ];
  const updated = applyColumnVisibility(columns, qa, true);
  assert.equal(updated.length, 2);
  assert.equal(updated[1].visibility, true);
});

test("hiding a column keeps its entry so rename and reorder still find it", () => {
  const columns = [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 991, section_title: "QA", ranking: "A1650", visibility: true },
  ];
  const updated = applyColumnVisibility(columns, qa, false);
  assert.equal(updated.length, 2);
  assert.equal(updated[1].visibility, false);
  assert.equal(updated[1].ranking, "A1650");
  // Sibling columns are untouched: a view that deliberately hides something
  // else keeps hiding it.
  assert.equal(updated[0].visibility, true);
});

test("hiding a column a view never had changes nothing", () => {
  const columns = [{ id: 1, section_title: "Todo", visibility: true }];
  assert.deepEqual(applyColumnVisibility(columns, qa, false), columns);
});

test("a column with no entry counts as hidden, matching how the board reads it", () => {
  assert.equal(isColumnVisibleInView([{ id: 1, visibility: true }], 991), false);
  assert.equal(isColumnVisibleInView([{ id: 991, visibility: false }], 991), false);
  assert.equal(isColumnVisibleInView([{ id: 991, visibility: true }], 991), true);
  assert.equal(isColumnVisibleInView(undefined, 991), false);
  // Legacy view rows key the column as sectionId.
  assert.equal(isColumnVisibleInView([{ sectionId: 991, visibility: true }], 991), true);
});

test("the ticket's acceptance case: one action, every view of the board", () => {
  // A board with three saved views. One of them deliberately hides Todo.
  const board = [
    { id: "default", columns: [{ id: 1, section_title: "Todo", visibility: true }] },
    {
      id: "bugs",
      columns: [
        { id: 1, section_title: "Todo", visibility: false },
        { id: 991, section_title: "QA", visibility: false },
      ],
    },
    { id: "triage", columns: [{ id: 991, section_title: "QA", visibility: true }] },
  ];
  const sweep = (views, visible) =>
    views.map((view) => ({
      ...view,
      columns: applyColumnVisibility(view.columns, qa, visible),
    }));

  const shown = sweep(board, true);
  assert.deepEqual(
    shown.map((view) => isColumnVisibleInView(view.columns, 991)),
    [true, true, true],
    "Show in all views reaches a view that never had the column",
  );
  // The view that hides Todo keeps hiding Todo.
  assert.equal(isColumnVisibleInView(shown[1].columns, 1), false);
  assert.equal(isColumnVisibleInView(shown[0].columns, 1), true);

  const hidden = sweep(shown, false);
  assert.deepEqual(
    hidden.map((view) => isColumnVisibleInView(view.columns, 991)),
    [false, false, false],
    "Hide in all views clears it everywhere",
  );
  assert.equal(isColumnVisibleInView(hidden[1].columns, 1), false);
  assert.equal(isColumnVisibleInView(hidden[0].columns, 1), true);
});

test("the count covers saved views only, never the live unsaved working copy", () => {
  const project = {
    id: 15,
    project_view: {
      allViews: [
        { id: "default", board_columns_view: [{ id: 991, visibility: true }] },
        { id: "bugs", board_columns_view: [{ id: 991, visibility: false }] },
        { id: "triage", board_columns_view: [{ id: 1, visibility: true }] },
        // The user's in-flight overlay is a working copy, not a saved view.
        { id: "unsaved", board_columns_view: [{ id: 991, visibility: true }] },
      ],
      user_project_views: [{ unsavedView: { id: "unsaved" } }],
    },
  };
  assert.deepEqual(countViewsShowingColumn(project, 991), { visible: 1, total: 3 });
});

test("the count reads as a sentence, never \"all 10 of 10\"", () => {
  assert.equal(describeViewsShowingColumn({ visible: 6, total: 10 }), "Visible in 6 of 10 views");
  assert.equal(describeViewsShowingColumn({ visible: 10, total: 10 }), "Visible in all 10 views");
  assert.equal(describeViewsShowingColumn({ visible: 0, total: 10 }), "Hidden in all 10 views");
  assert.equal(describeViewsShowingColumn({ visible: 1, total: 1 }), "Visible in the only view");
  assert.equal(describeViewsShowingColumn({ visible: 0, total: 1 }), "Hidden in the only view");
  assert.equal(describeViewsShowingColumn({ visible: 0, total: 0 }), "No views yet");
});

const { NextRequest } = require("next/server");
const { createColumnViewVisibilityHandler } = jiti(
  path.join(root, "src/lib/sections/columnViewVisibilityHandler.ts"),
);

const request = (body) =>
  new NextRequest("https://example.test/api/sections/view-visibility", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const handler = (overrides = {}) => {
  const calls = { lookups: [], writes: [], broadcasts: [] };
  const POST = createColumnViewVisibilityHandler({
    session: async () => ({ userId: 6 }),
    featureEnabled: async () => true,
    findSection: async (userId, sectionId) => {
      calls.lookups.push([userId, sectionId]);
      return { id: sectionId, projectId: 15, section_title: "QA", ranking: "A1650" };
    },
    setVisibility: async (section, visible) => {
      calls.writes.push([section.id, visible]);
    },
    afterChange: (projectId, userId) => calls.broadcasts.push([projectId, userId]),
    ...overrides,
  });
  return { POST, calls };
};

test("a signed-out caller cannot switch a column and nothing is looked up", async () => {
  const { POST, calls } = handler({ session: async () => null });
  const response = await POST(request({ sectionId: 991, visible: true }));
  assert.equal(response.status, 401);
  assert.deepEqual(calls.lookups, []);
  assert.deepEqual(calls.writes, []);
});

test("the feature flag gates the write on the server, not only in the UI", async () => {
  const { POST, calls } = handler({ featureEnabled: async () => false });
  const response = await POST(request({ sectionId: 991, visible: true }));
  assert.equal(response.status, 403);
  assert.deepEqual(calls.lookups, []);
  assert.deepEqual(calls.writes, []);
});

test("a column on a board the caller cannot reach is not switched", async () => {
  const { POST, calls } = handler({ findSection: async () => null });
  const response = await POST(request({ sectionId: 991, visible: false }));
  assert.equal(response.status, 404);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.broadcasts, []);
});

test("visible must be a real boolean, so \"false\" cannot switch a column on", async () => {
  for (const body of [
    { sectionId: 991, visible: "false" },
    { sectionId: 991 },
    { sectionId: 0, visible: true },
    { sectionId: -1, visible: true },
  ]) {
    const { POST, calls } = handler();
    const response = await POST(request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(calls.writes, []);
  }
});

test("an allowed caller switches the column and the board is told", async () => {
  const { POST, calls } = handler();
  const response = await POST(request({ sectionId: 991, visible: false }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    sectionId: 991,
    visible: false,
  });
  assert.deepEqual(calls.lookups, [[6, 991]]);
  assert.deepEqual(calls.writes, [[991, false]]);
  assert.deepEqual(calls.broadcasts, [[15, 6]]);
});

test("every view of the board is switched in one transaction", () => {
  const helpers = read("src/utils/controllers/section/viewHelpers.ts");
  const start = helpers.indexOf("export async function setSectionVisibilityInAllViews");
  assert.notEqual(start, -1, "the helper must still be exported under this name");
  // Bounded to this helper: a match belonging to a neighbouring function would
  // make these guards vacuous.
  const ends = ["\nexport ", "\nfunction ", "\nconst ", "\nasync function "]
    .map((needle) => helpers.indexOf(needle, start + 1))
    .filter((at) => at !== -1);
  const helper = helpers.slice(start, ends.length ? Math.min(...ends) : undefined);
  assert.match(helper, /prisma\.\$transaction\(async \(tx\)/);
  // Read and write inside the same locked transaction. board_columns_view is a
  // whole JSON document, so a snapshot read before the transaction would
  // discard any concurrent rename or reorder on every view of the board.
  assert.match(helper, /FOR UPDATE OF v/);
  assert.match(helper, /await tx\.view\.findMany/);
  assert.doesNotMatch(helper, /await prisma\.view\./);
  // The stored array is written through unsorted: sorting it would compare
  // legacy entries that carry no ranking and scramble every saved view.
  assert.doesNotMatch(helper, /sortByStringParam/);
});
