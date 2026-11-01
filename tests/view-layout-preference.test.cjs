const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/view-layout-preference.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  buildProjectSurfaceUrl,
  clientBoardLayoutToSaved,
  enqueueBoardViewMutation,
  getSavedBoardLayoutFromActiveView,
  patchProjectViewBoardLayout,
  getBoardLayoutRequestUpdate,
  getActiveBoardLayoutPreferenceFromProject,
  replaceProjectSurface,
  resolveBoardLayoutRequest,
  resolveBoardLayoutFromSurface,
  sanitizeBoardLayout,
  savedBoardLayoutFromExplicitSurface,
  savedBoardLayoutToClient,
  waitForBoardViewMutations,
} = jiti(path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts"));

const projectWith = ({ unsaved, applied, defaultView }) => ({
  project_view: {
    default_view: defaultView,
    user_project_views: [{ unsavedView: unsaved, appliedView: applied }],
  },
});

test("saved layouts accept only Board and Table", () => {
  assert.equal(sanitizeBoardLayout("Board"), "Board");
  assert.equal(sanitizeBoardLayout("Table"), "Table");
  assert.equal(sanitizeBoardLayout("board"), null);
  assert.equal(sanitizeBoardLayout("Grid"), null);
  assert.equal(sanitizeBoardLayout(undefined), null);
});

test("client and saved layout names map without changing the DB vocabulary", () => {
  assert.equal(clientBoardLayoutToSaved("board"), "Board");
  assert.equal(clientBoardLayoutToSaved("table"), "Table");
  assert.equal(savedBoardLayoutToClient("Board"), "board");
  assert.equal(savedBoardLayoutToClient("Table"), "table");
  assert.equal(savedBoardLayoutToClient(null), null);
});

test("explicit shared-link surfaces override saved layouts in both directions", () => {
  assert.equal(resolveBoardLayoutFromSurface("board", "Table", "table"), "board");
  assert.equal(resolveBoardLayoutFromSurface("table", "Board", "board"), "table");
});

test("only an explicit URL surface becomes a saved layout override", () => {
  assert.equal(savedBoardLayoutFromExplicitSurface("board"), "Board");
  assert.equal(savedBoardLayoutFromExplicitSurface("table"), "Table");
  assert.equal(savedBoardLayoutFromExplicitSurface(null), null);
  assert.equal(savedBoardLayoutFromExplicitSurface("calendar"), null);
});

test("bare shared links inherit the saved layout and then the browser preference", () => {
  assert.equal(resolveBoardLayoutFromSurface(null, "Table", "board"), "table");
  assert.equal(resolveBoardLayoutFromSurface(undefined, null, "table"), "table");
});

test("explicit off-board navigation preserves the requested surface", () => {
  assert.equal(
    buildProjectSurfaceUrl({
      projectId: 15,
      viewSlug: "today",
      surface: "table",
    }),
    "/project?id=15&view=today&surface=table",
  );
  assert.equal(
    buildProjectSurfaceUrl({ surface: "board" }),
    "/project?surface=board",
  );
});

test("changing the active project surface performs one router replacement", () => {
  const replacements = [];
  const replace = (destination, options) => {
    replacements.push({ destination, options });
  };

  assert.equal(
    replaceProjectSurface({
      currentHref: "https://app.hypertask.ai/project?id=15&view=today#task-2",
      surface: "table",
      replace,
    }),
    true,
  );
  assert.deepEqual(replacements, [{
    destination: "/project?id=15&view=today&surface=table#task-2",
    options: { scroll: false },
  }]);

  assert.equal(
    replaceProjectSurface({
      currentHref: "https://app.hypertask.ai/project?id=15&view=today&surface=table#task-2",
      surface: "table",
      replace,
    }),
    false,
    "selecting the active surface must not create another navigation",
  );
  assert.equal(replacements.length, 1);
});

test("legacy requests preserve layouts while explicit null clears them", () => {
  assert.deepEqual(getBoardLayoutRequestUpdate({ title: "legacy" }), {});
  assert.deepEqual(getBoardLayoutRequestUpdate({ board_layout: "Table" }), {
    board_layout: "Table",
  });
  assert.deepEqual(getBoardLayoutRequestUpdate({ board_layout: null }), {
    board_layout: null,
  });
  assert.equal(resolveBoardLayoutRequest({ title: "legacy" }, "Table"), "Table");
  assert.equal(resolveBoardLayoutRequest({ board_layout: null }, "Table"), null);
  assert.equal(resolveBoardLayoutRequest({ board_layout: "Board" }, "Table"), "Board");
});

test("legacy unsaved mutations inherit the active view object without falling through null", () => {
  assert.equal(
    getSavedBoardLayoutFromActiveView({
      unsavedView: { board_layout: null },
      appliedView: { board_layout: "Table" },
      defaultView: { board_layout: "Board" },
    }),
    null,
  );
  assert.equal(
    getSavedBoardLayoutFromActiveView({
      appliedView: { board_layout: null },
      defaultView: { board_layout: "Board" },
    }),
    null,
  );
  assert.equal(
    getSavedBoardLayoutFromActiveView({
      defaultView: { board_layout: "Table" },
    }),
    "Table",
  );
});

test("layout-only cache patches preserve a synthetic tab unsaved overlay", () => {
  const transient = {
    id: "tab-unsaved:view-a",
    board_filters: { labels: ["urgent"] },
    board_layout: "Table",
  };
  const projectView = {
    id: "project-view",
    allViews: [{ id: "view-a", board_layout: "Board" }],
    default_view: { id: "view-a", board_layout: "Board" },
    user_project_views: [{
      id: "user-project-view",
      appliedView: { id: "view-a", board_layout: "Board" },
      unsavedView: transient,
      unsavedViewId: transient.id,
    }],
  };

  const patched = patchProjectViewBoardLayout(projectView, "view-a", "Table");
  assert.equal(patched.allViews[0].board_layout, "Table");
  assert.equal(patched.default_view.board_layout, "Table");
  assert.equal(patched.user_project_views[0].appliedView.board_layout, "Table");
  assert.strictEqual(patched.user_project_views[0].unsavedView, transient);
  assert.deepEqual(
    patched.user_project_views[0].unsavedView.board_filters,
    { labels: ["urgent"] },
  );
});

test("layout mutations are serialized per project while different projects stay independent", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueueBoardViewMutation(15, async () => {
    order.push("first-start");
    await firstGate;
    order.push("first-end");
  });
  const second = enqueueBoardViewMutation(15, async () => {
    order.push("second-start");
    order.push("second-end");
  });
  const otherProject = enqueueBoardViewMutation(16, async () => {
    order.push("other-project");
  });
  let saveUnblocked = false;
  const pendingSave = waitForBoardViewMutations(15).then(() => {
    saveUnblocked = true;
  });

  await Promise.resolve();
  await otherProject;
  assert.deepEqual(order, ["first-start", "other-project"]);
  assert.equal(saveUnblocked, false);

  releaseFirst();
  await Promise.all([first, second]);
  await pendingSave;
  assert.deepEqual(order, [
    "first-start",
    "other-project",
    "first-end",
    "second-start",
    "second-end",
  ]);
  assert.equal(saveUnblocked, true);
});

test("an unsaved layout wins over its applied and default views", () => {
  assert.equal(
    getActiveBoardLayoutPreferenceFromProject(projectWith({
      unsaved: { board_layout: "Table" },
      applied: { board_layout: "Board" },
      defaultView: { board_layout: "Board" },
    })),
    "Table",
  );
});

test("a null active preference inherits the browser instead of another view", () => {
  assert.equal(
    getActiveBoardLayoutPreferenceFromProject(projectWith({
      applied: { board_layout: null },
      defaultView: { board_layout: "Table" },
    })),
    null,
  );
});
