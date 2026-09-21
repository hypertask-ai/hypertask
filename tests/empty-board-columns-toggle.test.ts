import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  beginEmptySectionMutation,
  getActiveEmptySectionSettingFromProject,
  getEmptySectionSettingForView,
  patchProjectViewEmptySections,
  pinProjectToUrlView,
  settleEmptySectionMutation,
} from "../src/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getFilteredEmptySections } from "../src/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import {
  createBoardReadModelSnapshot,
  materializeBoardReadModelSnapshot,
} from "../src/lib/boardSync/contract";

const root = path.resolve(__dirname, "..");

const view = (id: string, setting: "Show" | "Hidden") => ({
  id,
  board_empty_sections: setting,
});

const projectWith = ({
  unsaved,
  applied,
  defaultView,
}: {
  unsaved?: ReturnType<typeof view>;
  applied?: ReturnType<typeof view>;
  defaultView?: ReturnType<typeof view>;
}) => ({
  id: 15,
  project_view: {
    id: "project-view",
    default_view: defaultView,
    allViews: [defaultView, applied].filter(Boolean),
    user_project_views: [{ unsavedView: unsaved, appliedView: applied }],
  },
});

const beginRapidToggles = () => {
  const project = projectWith({
    unsaved: view("unsaved", "Show"),
  });
  const first = beginEmptySectionMutation(
    undefined,
    project.project_view as never,
    { id: 1, setting: "Hidden" },
  );
  const second = beginEmptySectionMutation(
    first.state,
    first.projectView,
    { id: 2, setting: "Show" },
  );
  return { project, first, second };
};

test("an optimistic empty-column setting patches the active unsaved view", () => {
  const project = projectWith({
    unsaved: view("unsaved", "Show"),
    applied: view("applied", "Show"),
    defaultView: view("default", "Show"),
  });

  const patchedView = patchProjectViewEmptySections(
    project.project_view as never,
    "Hidden",
  );
  const patchedProject = { ...project, project_view: patchedView };

  assert.equal(
    getActiveEmptySectionSettingFromProject(patchedProject as never),
    "Hidden",
  );
  assert.equal(
    patchedView.user_project_views[0].appliedView?.board_empty_sections,
    "Show",
  );
});

test("an optimistic empty-column setting patches the applied or default fallback", () => {
  const appliedProject = projectWith({
    applied: view("applied", "Show"),
    defaultView: view("default", "Show"),
  });
  const defaultProject = projectWith({
    defaultView: view("default", "Show"),
  });

  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...appliedProject,
      project_view: patchProjectViewEmptySections(
        appliedProject.project_view as never,
        "Hidden",
      ),
    } as never),
    "Hidden",
  );
  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...defaultProject,
      project_view: patchProjectViewEmptySections(
        defaultProject.project_view as never,
        "Hidden",
      ),
    } as never),
    "Hidden",
  );
});

test("a board with no user view still honors its patched default setting", () => {
  const project = projectWith({
    defaultView: view("default", "Show"),
  });
  project.project_view.user_project_views = [];

  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...project,
      project_view: patchProjectViewEmptySections(
        project.project_view as never,
        "Hidden",
      ),
    } as never),
    "Hidden",
  );
});

test("a saved Hidden view still removes empty columns after snapshot restore", () => {
  const project = {
    ...projectWith({ applied: view("speed", "Hidden") }),
    sections: [],
    tasks: [],
  };
  const snapshot = createBoardReadModelSnapshot({
    accountId: 6,
    projectId: project.id,
    payload: { project: project as never, tasks: [], allViews: [] },
  });

  assert.ok(snapshot);
  const restored = materializeBoardReadModelSnapshot(snapshot);
  const sections = [
    { sectionId: 1, visibility: true, items: [] },
    { sectionId: 2, visibility: true, items: [{ id: 20 }] },
  ];

  assert.deepEqual(
    getFilteredEmptySections(sections as never, restored.project),
    [sections[1]],
  );
});

test("a personal setting overrides shared and legacy unsaved values", () => {
  const applied = {
    ...view("speed", "Show"),
    ViewLastUsed: [{ board_empty_sections: "Hidden" }],
  };
  const project = projectWith({
    unsaved: view("unsaved", "Show"),
    applied: applied as never,
  });

  assert.equal(
    getActiveEmptySectionSettingFromProject(project as never),
    "Hidden",
  );
  assert.equal(
    getEmptySectionSettingForView(project.project_view as never, "speed"),
    "Hidden",
  );

  const legacyProject = projectWith({
    unsaved: view("unsaved", "Hidden"),
    applied: view("speed", "Show"),
  });
  assert.equal(
    getActiveEmptySectionSettingFromProject(legacyProject as never),
    "Hidden",
  );
});

test("a URL-pinned view keeps its personal setting through snapshot restore", () => {
  const canonical = { ...view("canonical", "Show"), slug: "canonical" };
  const speed = { ...view("speed", "Show"), slug: "speed-2" };
  const project = {
    ...projectWith({ applied: canonical }),
    sections: [
      { sectionId: 1, visibility: true, items: [] },
      { sectionId: 2, visibility: true, items: [{ id: 20 }] },
    ],
    tasks: [],
  };
  project.project_view.allViews = [canonical, speed];
  project.project_view = patchProjectViewEmptySections(
    project.project_view as never,
    "Hidden",
    "speed",
  ) as never;

  assert.equal(
    getActiveEmptySectionSettingFromProject(project as never),
    "Show",
    "the canonical tab must remain isolated",
  );

  const snapshot = createBoardReadModelSnapshot({
    accountId: 6,
    projectId: project.id,
    payload: { project: project as never, tasks: [], allViews: [] },
  });
  assert.ok(snapshot);
  const restored = materializeBoardReadModelSnapshot(snapshot);
  const pinned = pinProjectToUrlView(restored.project, "speed-2");

  assert.equal(getActiveEmptySectionSettingFromProject(pinned), "Hidden");
  assert.deepEqual(
    getFilteredEmptySections(project.sections as never, pinned),
    [project.sections[1]],
  );
});

test("mutation state rejects reuse by another view", () => {
  const firstView = {
    ...view("first", "Hidden"),
    ViewLastUsed: [{ board_empty_sections: "Hidden" }],
  };
  const secondView = {
    ...view("second", "Show"),
    ViewLastUsed: [{ board_empty_sections: "Show" }],
  };
  const project = projectWith({ applied: firstView as never });
  project.project_view.allViews = [firstView, secondView] as never;

  const first = beginEmptySectionMutation(
    undefined,
    project.project_view as never,
    { id: 1, setting: "Show", viewId: "first" },
  );
  assert.throws(
    () => beginEmptySectionMutation(
      first.state,
      first.projectView,
      { id: 2, setting: "Hidden", viewId: "second" },
    ),
    /belongs to another view/,
  );
  assert.equal(first.state.viewId, "first");
  assert.deepEqual(first.state.pending.map(({ id }) => id), [1]);
});

test("two failed toggles restore the original setting", () => {
  const { project, second } = beginRapidToggles();
  const withUnrelatedChange = {
    ...second.projectView,
    user_project_views: second.projectView.user_project_views.map((row, index) =>
      index === 0
        ? {
            ...row,
            unsavedView: { ...row.unsavedView!, board_sorting_order: "Ascending" },
          }
        : row,
    ),
  };

  const firstFailure = settleEmptySectionMutation(
    second.state,
    1,
    false,
    withUnrelatedChange as never,
  );
  const secondFailure = settleEmptySectionMutation(
    firstFailure.state!,
    2,
    false,
    firstFailure.projectView,
  );

  assert.equal(secondFailure.state, undefined);
  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...project,
      project_view: secondFailure.projectView,
    } as never),
    "Show",
  );
  assert.equal(
    secondFailure.projectView.user_project_views[0].unsavedView?.board_sorting_order,
    "Ascending",
  );
});

test("a successful earlier toggle becomes the rollback baseline", () => {
  const { project, second } = beginRapidToggles();
  const savedHiddenView = patchProjectViewEmptySections(
    project.project_view as never,
    "Hidden",
  );
  const firstSuccess = settleEmptySectionMutation(
    second.state,
    1,
    true,
    savedHiddenView,
  );
  const secondFailure = settleEmptySectionMutation(
    firstSuccess.state!,
    2,
    false,
    firstSuccess.projectView,
  );

  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...project,
      project_view: firstSuccess.projectView,
    } as never),
    "Show",
  );
  assert.equal(
    getActiveEmptySectionSettingFromProject({
      ...project,
      project_view: secondFailure.projectView,
    } as never),
    "Hidden",
  );
});

test("the command toggles both directions through the optimistic shared save", () => {
  const saveHookSource = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  const saveStart = saveHookSource.indexOf("const saveEmptySectionsAPI");
  const nextFunction = saveHookSource.indexOf("const saveStalenessToViewAPI", saveStart);
  const saveSource = saveHookSource.slice(saveStart, nextFunction);
  const commandSource = fs.readFileSync(
    path.join(root, "src/components/commands.tsx"),
    "utf8",
  );
  const commandStart = commandSource.indexOf("case CommandMode.ToggleEmptyColumns");
  const nextCommand = commandSource.indexOf("case CommandMode.HideColumn", commandStart);
  const toggleSource = commandSource.slice(commandStart, nextCommand);

  assert.match(toggleSource, /saveEmptySectionsAPI/);
  assert.match(toggleSource, /current === "Hidden" \? "Show" : "Hidden"/);
  assert.match(saveSource, /beginEmptySectionMutation/);
  assert.match(saveSource, /settleEmptySectionMutation/);
  assert.ok(
    saveSource.indexOf("beginEmptySectionMutation") <
      saveSource.indexOf("apiHandler("),
    "the active board must update before the network request starts",
  );
});

test("the canonical URL view reaches the durable unsaved-view branch", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/unsaved-view.ts"),
    "utf8",
  );
  const transientGuard = source.indexOf("shouldUseTransientTabSettings(");
  const durableWrite = source.indexOf("const createUnsavedViewHandler", transientGuard);

  assert.ok(transientGuard >= 0);
  assert.ok(durableWrite > transientGuard);
  assert.match(source.slice(durableWrite), /board_empty_sections/);
});

test("the command saves against the URL-pinned view instead of the raw cache view", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  const saveStart = source.indexOf("const saveEmptySectionsAPI");
  const nextFunction = source.indexOf("const saveStalenessToViewAPI", saveStart);
  const saveSource = source.slice(saveStart, nextFunction);

  assert.match(saveSource, /project\.project_view\?\.user_project_views\[0\]\?\.appliedView/);
  assert.match(saveSource, /viewId: targetViewId/);
  assert.match(saveSource, /updateMode: PERSONAL_EMPTY_SECTIONS_UPDATE_MODE/);
  assert.doesNotMatch(saveSource, /baseViewId/);
});
