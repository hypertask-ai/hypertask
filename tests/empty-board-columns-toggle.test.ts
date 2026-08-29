import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  beginEmptySectionMutation,
  getActiveEmptySectionSettingFromProject,
  patchProjectViewEmptySections,
  settleEmptySectionMutation,
} from "../src/utils/helperFunctions/Views/ViewsHelperFunctions";

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

test("the shared empty-column save applies the setting before starting the API write", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  const saveStart = source.indexOf("const saveEmptySectionsAPI");
  const nextFunction = source.indexOf("const saveStalenessToViewAPI", saveStart);
  const saveSource = source.slice(saveStart, nextFunction);

  assert.match(saveSource, /beginEmptySectionMutation/);
  assert.match(saveSource, /settleEmptySectionMutation/);
  assert.ok(
    saveSource.indexOf("beginEmptySectionMutation") <
      saveSource.indexOf("apiHandler("),
    "the active board must update before the network request starts",
  );
});
