import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  beginEmptySectionMutation,
  getActiveEmptySectionSettingFromProject,
  getActiveEmptySectionSettingFromProjectView,
  getEmptySectionSettingForView,
  maskPersonalEmptySectionsForUnsavedView,
  patchProjectViewEmptySections,
  pinProjectToUrlView,
  settleEmptySectionMutation,
} from "../src/utils/helperFunctions/Views/ViewsHelperFunctions";
import {
  getFilteredEmptySections,
  shouldHoldEmptySectionsAutoShowAttempt,
} from "../src/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import {
  createBoardReadModelSnapshot,
  materializeBoardReadModelSnapshot,
} from "../src/lib/boardSync/contract";

const root = path.resolve(__dirname, "..");

const view = (
  id: string,
  setting: "Show" | "Hidden",
  staged = false,
) => ({
  id,
  board_empty_sections: setting,
  board_empty_sections_staged: staged,
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
    board_empty_sections_staging_enabled:
      unsaved?.board_empty_sections_staged === true,
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

test("the empty columns become visible when the last task leaves a Hidden board", () => {
  const sections = [
    { sectionId: 1, visibility: true, items: [] },
    { sectionId: 2, visibility: true, items: [] },
  ];
  const project = {
    ...projectWith({ applied: view("speed", "Hidden") }),
    sections,
    tasks: [],
  };

  assert.deepEqual(
    getFilteredEmptySections(sections as never, project as never),
    sections,
  );
});

test("a filter that hides every task does not reveal empty columns", () => {
  const filteredSections = [
    { sectionId: 1, visibility: true, items: [] },
    { sectionId: 2, visibility: true, items: [] },
  ];
  const project = {
    ...projectWith({ applied: view("speed", "Hidden") }),
    sections: [
      { ...filteredSections[0], items: [{ id: 20 }] },
      filteredSections[1],
    ],
    tasks: [{ id: 20 }],
  };

  assert.deepEqual(
    getFilteredEmptySections(filteredSections as never, project as never),
    [],
  );
});

test("an optimistic Show render keeps the automatic save attempt latched", () => {
  const attempt = {
    attemptedBoardId: 15,
    attemptedViewId: "speed",
    boardHasTasks: false,
    cause: "actually_empty" as const,
    currentBoardId: 15,
    currentViewId: "speed",
  };

  assert.equal(shouldHoldEmptySectionsAutoShowAttempt(attempt), true);
  assert.equal(
    shouldHoldEmptySectionsAutoShowAttempt({
      ...attempt,
      boardHasTasks: true,
    }),
    false,
  );
  assert.equal(
    shouldHoldEmptySectionsAutoShowAttempt({
      ...attempt,
      currentViewId: "planning",
    }),
    false,
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
    getActiveEmptySectionSettingFromProjectView(
      maskPersonalEmptySectionsForUnsavedView(project.project_view as never, true),
    ),
    "Hidden",
    "ordinary unsaved edits must keep the personal preference",
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

test("a staged unsaved choice outranks but does not erase the personal setting", () => {
  const applied = {
    ...view("speed", "Show"),
    ViewLastUsed: [{ board_empty_sections: "Hidden" }],
  };
  const project = projectWith({
    unsaved: view("unsaved", "Show", true),
    applied: applied as never,
  });

  const masked = maskPersonalEmptySectionsForUnsavedView(
    project.project_view as never,
    true,
  );

  assert.equal(
    getActiveEmptySectionSettingFromProjectView(masked),
    "Show",
  );
  const disabled = maskPersonalEmptySectionsForUnsavedView(
    project.project_view as never,
    false,
  );
  assert.equal(
    getActiveEmptySectionSettingFromProjectView(disabled),
    "Hidden",
  );
  assert.equal(
    disabled.user_project_views[0].unsavedView,
    undefined,
    "disabling the flag removes a staged-only unsaved view",
  );
  assert.equal(
    getActiveEmptySectionSettingFromProject(project as never),
    "Show",
  );

  const resetProject = projectWith({ applied: applied as never });
  assert.equal(
    getActiveEmptySectionSettingFromProject(resetProject as never),
    "Hidden",
  );
  assert.equal(
    getActiveEmptySectionSettingFromProjectView(
      maskPersonalEmptySectionsForUnsavedView(
        resetProject.project_view as never,
        true,
      ),
    ),
    "Hidden",
    "removing the unsaved view must reveal the retained personal setting",
  );
  assert.equal(applied.ViewLastUsed[0].board_empty_sections, "Hidden");
});

test("disabling staging preserves unrelated unsaved edits", () => {
  const applied = {
    ...view("speed", "Show"),
    board_sorting_order: "Descending",
    ViewLastUsed: [{ board_empty_sections: "Hidden" }],
  };
  const project = projectWith({
    unsaved: {
      ...view("unsaved", "Show", true),
      board_sorting_order: "Ascending",
    } as never,
    applied: applied as never,
  });

  const disabled = maskPersonalEmptySectionsForUnsavedView(
    project.project_view as never,
    false,
  );

  assert.equal(
    disabled.user_project_views[0].unsavedView?.board_empty_sections,
    "Hidden",
  );
  assert.equal(
    disabled.user_project_views[0].unsavedView?.board_empty_sections_staged,
    false,
  );
  assert.equal(
    disabled.user_project_views[0].unsavedView?.board_sorting_order,
    "Ascending",
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

test("a staged optimistic toggle patches the existing unsaved view", () => {
  const applied = {
    ...view("speed", "Show"),
    ViewLastUsed: [{ board_empty_sections: "Show" }],
  };
  const project = projectWith({
    unsaved: view("unsaved", "Hidden", true),
    applied: applied as never,
  });

  const mutation = beginEmptySectionMutation(
    undefined,
    project.project_view as never,
    { id: 1, setting: "Show", viewId: "speed", staged: true },
  );

  assert.equal(
    getActiveEmptySectionSettingFromProjectView(mutation.projectView),
    "Show",
  );
  assert.equal(
    mutation.projectView.user_project_views[0].unsavedView?.board_empty_sections,
    "Show",
  );
  assert.equal(
    mutation.projectView.user_project_views[0].unsavedView?.board_empty_sections_staged,
    true,
  );
});

test("a failed rapid staged toggle returns to the last successful choice", () => {
  const applied = {
    ...view("speed", "Show"),
    ViewLastUsed: [{ board_empty_sections: "Show" }],
  };
  const project = projectWith({ applied: applied as never });
  const first = beginEmptySectionMutation(
    undefined,
    project.project_view as never,
    { id: 1, setting: "Hidden", viewId: "speed", staged: true },
  );
  const second = beginEmptySectionMutation(
    first.state,
    first.projectView,
    { id: 2, setting: "Show", viewId: "speed", staged: true },
  );
  const persistedHidden = projectWith({
    unsaved: view("unsaved", "Hidden", true),
    applied: applied as never,
  }).project_view as never;

  const firstSuccess = settleEmptySectionMutation(
    second.state,
    1,
    true,
    persistedHidden,
  );
  const secondFailure = settleEmptySectionMutation(
    firstSuccess.state!,
    2,
    false,
    firstSuccess.projectView,
  );

  assert.equal(firstSuccess.state?.baseline, "Hidden");
  assert.equal(
    getActiveEmptySectionSettingFromProjectView(secondFailure.projectView),
    "Hidden",
  );
});

test("the legacy command fallback keeps its optimistic personal save", () => {
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
  const legacySource = saveSource.slice(saveSource.indexOf("const mutationId"));
  assert.ok(
    legacySource.indexOf("beginEmptySectionMutation") <
      legacySource.indexOf("enqueueBoardViewMutation("),
    "the legacy active board must update before its network request starts",
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

test("the flagged command stages empty-column changes in the save-view routine", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  const saveStart = source.indexOf("const saveEmptySectionsAPI");
  const nextFunction = source.indexOf("const saveStalenessToViewAPI", saveStart);
  const saveSource = source.slice(saveStart, nextFunction);

  assert.match(source, /useFlag\(HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG\)/);
  assert.match(saveSource, /if \(emptyColumnsSaveViewEnabled/);
  assert.match(saveSource, /buildUnsavedBody\(queuedProject, \{\s*board_empty_sections: emptySection/);
  assert.match(saveSource, /updateMode: STAGED_EMPTY_SECTIONS_UPDATE_MODE/);
  assert.match(saveSource, /updateMode: PERSONAL_EMPTY_SECTIONS_UPDATE_MODE/);
  assert.ok(
    saveSource.indexOf("beginEmptySectionMutation") <
      saveSource.indexOf("updateMode: STAGED_EMPTY_SECTIONS_UPDATE_MODE"),
    "the staged path must update optimistically before its queued request",
  );
  assert.ok(
    saveSource.indexOf("if (emptyColumnsSaveViewEnabled)") <
      saveSource.indexOf("updateMode: PERSONAL_EMPTY_SECTIONS_UPDATE_MODE"),
    "the flagged save-view path must run before the legacy personal auto-save",
  );

  const unsavedRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/unsaved-view.ts"),
    "utf8",
  );
  assert.match(unsavedRoute, /isFeatureEnabled\(\s*HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG/);
  assert.match(unsavedRoute, /req\.body\.updateMode === STAGED_EMPTY_SECTIONS_UPDATE_MODE/);
  assert.match(unsavedRoute, /return res\.status\(409\)/);
  assert.match(unsavedRoute, /board_empty_sections_staged: stagesEmptySections/);
  assert.match(unsavedRoute, /\? \{ board_empty_sections_staged: true \}/);
  assert.match(
    unsavedRoute,
    /personalEmptySections \?\? comparisonView\.board_empty_sections/,
  );
  assert.doesNotMatch(unsavedRoute, /view_Last_Used\.updateMany/);
  assert.doesNotMatch(unsavedRoute, /clearProjectViewPersonalEmptySections/);

  const projectViewReader = fs.readFileSync(
    path.join(root, "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts"),
    "utf8",
  );
  assert.match(projectViewReader, /isFeatureEnabled\(\s*HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG/);
  assert.match(projectViewReader, /maskPersonalEmptySectionsForUnsavedView/);
  assert.match(projectViewReader, /persistDisabledStagedEmptySections/);
  assert.match(projectViewReader, /data: \{ unsavedViewId: null \}/);
  assert.match(projectViewReader, /board_empty_sections_staged: false/);

  const boardReader = fs.readFileSync(
    path.join(root, "src/utils/controllers/projects/getBoardTasks.ts"),
    "utf8",
  );
  assert.match(boardReader, /HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG/);
  assert.match(boardReader, /maskPersonalEmptySectionsForUnsavedView/);

  const schema = fs.readFileSync(
    path.join(root, "src/prisma/schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260919100000_stage_empty_sections_in_unsaved_view/migration.sql",
    ),
    "utf8",
  );
  assert.match(schema, /board_empty_sections_staged Boolean\s+@default\(false\)/);
  assert.match(migration, /ADD COLUMN "board_empty_sections_staged" BOOLEAN NOT NULL DEFAULT false/);

  const updateRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/update-view.ts"),
    "utf8",
  );
  assert.match(updateRoute, /isFeatureEnabled\(\s*HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG/);
  assert.match(updateRoute, /board_empty_sections_staged: false/);
  assert.match(updateRoute, /data: \{ board_empty_sections: null \}/);

  const createRoute = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/create-view.ts"),
    "utf8",
  );
  assert.match(createRoute, /isFeatureEnabled\(\s*HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG/);
  assert.match(createRoute, /board_empty_sections_staged: false/);
  assert.match(createRoute, /data: \{ board_empty_sections: null \}/);
});
