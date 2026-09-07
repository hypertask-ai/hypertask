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
  // Neither the caller's array nor the objects inside it are touched.
  assert.deepEqual(columns, [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 2, section_title: "Done", visibility: true },
  ]);
});

test("showing a column the view hid flips it back on and adds nothing", () => {
  const columns = [
    { id: 1, section_title: "Todo", visibility: true },
    { id: 991, section_title: "QA", visibility: false },
  ];
  const updated = applyColumnVisibility(columns, qa, true);
  assert.equal(updated.length, 2);
  assert.equal(updated[1].visibility, true);
  // The stored entry the caller passed in is left as it was.
  assert.equal(columns[1].visibility, false);
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

test("a legacy entry keyed as sectionId is flipped, never duplicated", () => {
  // Older stored rows key the column as sectionId. Appending a second entry for
  // the same column would write a duplicate into every view's JSON document.
  const columns = [{ sectionId: 991, section_title: "QA", visibility: false }];
  const shown = applyColumnVisibility(columns, qa, true);
  assert.equal(shown.length, 1);
  assert.equal(isColumnVisibleInView(shown, 991), true);
  const hidden = applyColumnVisibility(shown, qa, false);
  assert.equal(hidden.length, 1);
  assert.equal(isColumnVisibleInView(hidden, 991), false);
});

test("hiding a column a view never had changes nothing", () => {
  const columns = [{ id: 1, section_title: "Todo", visibility: true }];
  const before = structuredClone(columns);
  assert.deepEqual(applyColumnVisibility(columns, qa, false), before);
  // Compared against the snapshot, not against itself: an implementation that
  // mutated in place and returned the same reference would pass that.
  assert.deepEqual(columns, before);
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
    setVisibility: async (section, visible, actingUserId) => {
      calls.writes.push([section.id, visible, actingUserId]);
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
  // The acting user is threaded through: the write leaves other people's
  // unsaved working copies alone but must reach the caller's own.
  assert.deepEqual(calls.writes, [[991, false, 6]]);
  assert.deepEqual(calls.broadcasts, [[15, 6]]);
});

test("every board_columns_view write is locked and read inside its transaction", () => {
  const helpers = read("src/utils/controllers/section/viewHelpers.ts");
  const slice = (name) => {
    const start = helpers.indexOf(name);
    assert.notEqual(start, -1, `${name} must still exist under this name`);
    const ends = ["\nexport ", "\nfunction ", "\nasync function ", "\nconst "]
      .map((needle) => helpers.indexOf(needle, start + 1))
      .filter((at) => at !== -1);
    const text = helpers.slice(start, ends.length ? Math.min(...ends) : undefined);
    // A truncated slice would make every doesNotMatch below pass on a stub, so
    // the slice must reach the function's own closing brace.
    assert.ok(
      text.includes("\n}") && text.length > 100,
      `${name} slice looks truncated: ${text.length} chars`,
    );
    return text;
  };

  // One writer, so a rename and a visibility switch on the same board cannot
  // each read a stale copy of the same JSON document and overwrite each other.
  const writer = slice("async function updateBoardViewColumns");
  assert.match(writer, /prisma\.\$transaction\(async \(tx\)/);
  // On the transaction client: the same query on the base client would take
  // the lock on another connection and release it immediately, which is the
  // lost update this test is named after.
  assert.match(writer, /tx\.\$queryRaw[\s\S]*FOR UPDATE OF v/);
  assert.match(writer, /await tx\.view\.findMany/);
  assert.match(writer, /await tx\.view\.update/);

  for (const name of [
    "export async function appendSectionToAllViews",
    "export async function updateSectionInAllViews",
    "export async function removeSectionFromAllViews",
    "export async function setSectionVisibilityInAllViews",
  ]) {
    const helper = slice(name);
    assert.match(helper, /updateBoardViewColumns\(/, `${name} must use the locked writer`);
    assert.doesNotMatch(helper, /prisma\.view\./, `${name} must not read or write views directly`);
  }

  // Other people's in-flight working copies are private; only the caller's own
  // is swept along so the action is visible without switching views.
  const visibility = slice("export async function setSectionVisibilityInAllViews");
  assert.match(visibility, /unsaved_User_Project_View: \{ none: \{\} \}/);
  assert.match(visibility, /unsaved_User_Project_View: \{ some: \{ userId: actingUserId \} \}/);
  assert.doesNotMatch(
    visibility,
    /sortByStringParam/,
    "showing or hiding a column must not reorder the stored columns",
  );
});
