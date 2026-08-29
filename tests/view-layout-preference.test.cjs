const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("the additive migration leaves every existing view nullable", () => {
  const migration = fs.readFileSync(
    path.join(root, "src/prisma/migrations/20260809190000_add_view_board_layout/migration.sql"),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN "board_layout" TEXT/);
  assert.doesNotMatch(migration, /NOT NULL|DEFAULT/i);
});

test("create, update, unsaved, and Save View all carry board_layout", () => {
  for (const relative of [
    "src/pages/api/projects/views/create-view.ts",
    "src/pages/api/projects/views/update-view.ts",
    "src/pages/api/projects/views/unsaved-view.ts",
    "src/components/Modals/ViewModals/SaveViewModal.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /board_layout/, relative);
  }
  const updateRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/update-view.ts"),
    "utf8",
  );
  assert.match(updateRoute, /hasBoardLayout/);
  assert.match(
    updateRoute,
    /members:[\s\S]*?some: \{ userId: currentUser\.id, status: "Accepted" \}/,
    "only accepted board members may update a shared view",
  );

  const layoutBranch = updateRoute.indexOf("if (layoutOnly)");
  const unsavedCleanup = updateRoute.indexOf("updatedUserProjectView.unsavedViewId");
  assert.ok(layoutBranch >= 0 && unsavedCleanup > layoutBranch);
  assert.match(
    updateRoute.slice(layoutBranch, unsavedCleanup),
    /return res\.status\(200\)\.json\(\{ viewId, board_layout: boardLayout \}\)/,
    "layout-only updates must return before generic Save View cleanup",
  );

  const manageViews = fs.readFileSync(
    path.join(root, "src/components/Modals/ViewModals/ManageViewsModals.tsx"),
    "utf8",
  );
  assert.match(manageViews, /updateViewLayout\(currentProject\.id, editView\.id, layoutPreference\)/);

  const createRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/create-view.ts"),
    "utf8",
  );
  assert.match(
    createRoute,
    /accessibleProject[\s\S]*?members: \{ some: \{ userId, status: "Accepted" \} \}/,
    "creating or replacing a saved view requires accepted board access",
  );
  assert.match(
    createRoute,
    /visibility === "Private"[\s\S]*?\{ userId, visibility: "Private" as const \}[\s\S]*?OR: \[\{ visibility: "Public" as const \}, \{ userId \}\]/,
    "Save for me must not overwrite a same-title team view",
  );
  assert.match(
    createRoute,
    /\.\.\.getBoardLayoutRequestUpdate\(view_settings\)/,
    "an older client updating a saved view must not clear its layout",
  );

  const unsavedRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/unsaved-view.ts"),
    "utf8",
  );
  assert.match(
    unsavedRoute,
    /prisma\.project\.findFirst[\s\S]*?some: \{ userId: currentUser\.id, status: "Accepted" \}/,
    "unsaved snapshots require accepted board access before reading board data",
  );
  assert.match(
    unsavedRoute,
    /const inheritedBoardLayout[\s\S]*?getSavedBoardLayoutFromActiveView\([\s\S]*?const resolvedBoardLayout = resolveBoardLayoutRequest\([\s\S]*?req\.body,[\s\S]*?inheritedBoardLayout/,
    "an older client must inherit the current unsaved or base layout",
  );
  assert.equal(
    (unsavedRoute.match(/board_layout: resolvedBoardLayout/g) ?? []).length,
    3,
    "comparison, create, and update must use the same resolved layout",
  );
});

test("saved overrides and browser inheritance use separate Recoil atoms", () => {
  const source = fs.readFileSync(path.join(root, "src/store/index.ts"), "utf8");
  assert.match(source, /boardLayoutPreferenceAtom/);
  assert.match(source, /key: "boardLayout"/);
  assert.match(source, /key: "activeBoardLayout"/);
});

test("surface navigation never dirties a saved view", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  assert.match(
    source,
    /if \(isBuiltinView\(view\)\)[\s\S]*?replaceCurrentSurface\(boardLayoutPreference\);[\s\S]*?setBoardLayout\(boardLayoutPreference\);[\s\S]*?return;/,
    "built-ins must align their URL with the browser layout without creating an unsaved view",
  );
  const navigationStart = source.indexOf("const changeBoardLayout");
  const navigationEnd = source.indexOf("// ============ reset view", navigationStart);
  assert.ok(navigationStart >= 0 && navigationEnd > navigationStart);
  const navigation = source.slice(navigationStart, navigationEnd);
  assert.match(navigation, /setBoardLayoutPreference\(nextLayout\)/);
  assert.match(navigation, /replaceCurrentSurface\(nextLayout\)/);
  assert.match(navigation, /setBoardLayout\(nextLayout\)/);
  assert.doesNotMatch(navigation, /apiHandler|unsavedViewAPIRoute|setPendingBoardLayouts/);
  assert.match(
    source,
    /const apiHandler[\s\S]*?enqueueBoardViewMutation\(baseProject\.id/,
    "all full-snapshot unsaved mutations must share the per-project queue",
  );
  assert.match(
    source,
    /await enqueueBoardViewMutation\(project\.id,[\s\S]*?switchViewAPIRoute/,
    "view switches must serialize with pending unsaved mutations",
  );
  assert.match(
    source,
    /const buildUnsavedBody[\s\S]*?board_layout: boardLayoutForRequest\(queuedProject\)/,
    "every execution-time snapshot must carry the pending layout override",
  );
  assert.match(
    source,
    /const boardLayoutForRequest[\s\S]*?savedBoardLayoutFromExplicitSurface[\s\S]*?window\.location\.search/,
    "shared-link surface intent must survive later filter and sort mutations",
  );
  assert.match(
    source,
    /setBoardLayout\(nextLayout\);[\s\S]*?replaceCurrentSurface\(nextLayout\);/,
    "a user layout change must make the current URL explicitly shareable",
  );
  assert.match(
    source,
    /replaceProjectSurface\([\s\S]*?router\.replace\(destination, options\)/,
    "surface navigation must use one Next router replacement",
  );
  assert.ok(
    (source.match(/\(queuedProject\) => buildUnsavedBody\(queuedProject/g) ?? []).length >= 6,
    "every sibling settings mutation must rebuild from the latest queued project",
  );
  assert.match(
    source,
    /const resetView[\s\S]*?enqueueBoardViewMutation\(project\.id/,
    "reset must serialize with pending full-snapshot mutations",
  );
  assert.match(
    source,
    /const saveAsDefaultHandler[\s\S]*?cacheUpdateHandler\([\s\S]*?response\.data\.project_view_updated[\s\S]*?updateCookieAndURL\(body\.projectId, view\);[\s\S]*?applyBoardLayoutPreference\(body\.view_settings\.board_layout\);/,
    "new/default saves must patch their view before removing explicit URL intent",
  );
});

test("Save View waits for queued view edits and reads explicit surface intent", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/Modals/ViewModals/SaveViewModal.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /const getExplicitBoardLayout[\s\S]*?savedBoardLayoutFromExplicitSurface[\s\S]*?window\.location\.search/,
    "Save View must resolve explicit link intent at submit time",
  );
  assert.match(source, /waitForBoardViewMutations\(project\.id\)/);
  assert.match(
    source,
    /const latestProject = getLatestProject\(\)[\s\S]*?const latestBody = buildCreateBody\(latestProject\)/,
    "Save current must build its body after the pending mutation queue drains",
  );
  assert.equal(
    (source.match(/buildCreateBody\(getLatestProject\(\)\)/g) ?? []).length,
    2,
    "default and new-view saves must also read the post-queue project",
  );
});
