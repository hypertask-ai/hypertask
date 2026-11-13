const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const { sanitizeProjectBoardFilters } = loadModule(
  "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts",
);

const projectWith = ({ defaultSetting, draft, applied, allViews }) => ({
  id: 2060,
  project_view: {
    id: "project-view",
    default_view_id: "default-view",
    default_view: { id: "default-view", project_view_id: "project-view", board_subtask_setting: defaultSetting },
    allViews: allViews ?? [
      { id: "default-view", project_view_id: "project-view", board_subtask_setting: defaultSetting },
      { id: "rat-stack", project_view_id: "project-view", board_subtask_setting: "Flattened" },
    ],
    user_project_views: [{
      id: "row",
      userId: 6,
      project_view_id: "project-view",
      appliedViewId: applied?.id ?? null,
      appliedView: applied
        ? {
            id: applied.id,
            project_view_id: "project-view",
            board_subtask_setting: applied.setting,
            visibility: "Public",
            userId: 6,
          }
        : null,
      unsavedViewId: draft ? "draft" : null,
      unsavedView: draft
        ? {
            id: "draft",
            project_view_id: "project-view",
            userId: 6,
            visibility: "Private",
            board_subtask_setting: draft,
          }
        : null,
    }],
  },
});

const settings = (project) => {
  const view = project.project_view;
  return {
    default: view.default_view.board_subtask_setting,
    applied: view.user_project_views[0].appliedView?.board_subtask_setting ?? null,
    draft: view.user_project_views[0].unsavedView?.board_subtask_setting ?? null,
    ratStack: view.allViews.find((row) => row.id === "rat-stack").board_subtask_setting,
  };
};

test("with the switch off the board payload keeps every stored sub-ticket setting", () => {
  const project = projectWith({ defaultSetting: "None", draft: "None" });

  assert.deepEqual(settings(sanitizeProjectBoardFilters(project, 6, false, false)), {
    default: "None",
    applied: null,
    draft: "None",
    ratStack: "Flattened",
  });
});

test("a board default view that hides sub-tickets shows them with the switch on", () => {
  const project = projectWith({ defaultSetting: "None", draft: "None" });
  const sanitized = settings(sanitizeProjectBoardFilters(project, 6, false, true));

  assert.equal(sanitized.default, "Flattened_Card");
  assert.equal(sanitized.draft, "Flattened_Card");
  assert.equal(sanitized.ratStack, "Flattened");
});

test("a draft that hides sub-tickets stops hiding them on that board", () => {
  for (const draft of ["None", "Parent", "Card"]) {
    const project = projectWith({ defaultSetting: "None", draft });
    assert.equal(settings(sanitizeProjectBoardFilters(project, 6, false, true)).draft, "Flattened_Card");
  }
});

test("the tab count list follows the same rule as the board", () => {
  const project = projectWith({ defaultSetting: "None" });
  const sanitized = sanitizeProjectBoardFilters(project, 6, false, true).project_view;

  assert.equal(
    sanitized.allViews.find((row) => row.id === "default-view").board_subtask_setting,
    "Flattened_Card",
  );
});

test("a board that already shows sub-tickets keeps every personal setting", () => {
  for (const draft of ["None", "Parent", "Card", "Flattened"]) {
    const project = projectWith({ defaultSetting: "Flattened_Card", draft });
    assert.deepEqual(settings(sanitizeProjectBoardFilters(project, 6, false, true)), {
      default: "Flattened_Card",
      applied: null,
      draft,
      ratStack: "Flattened",
    });
  }
});

test("a filtered view keeps its own sub-ticket setting", () => {
  const project = projectWith({
    defaultSetting: "None",
    applied: { id: "rat-stack", setting: "Parent" },
  });

  assert.equal(settings(sanitizeProjectBoardFilters(project, 6, false, true)).applied, "Parent");
});

test("the switch is a reversible display bugfix released to the owner and QA first", () => {
  const { default: flag } = loadModule(
    "src/lib/flags/definitions/htpr-9274-board-default-subtasks.ts",
  );

  assert.equal(flag.key, "htpr-9274-board-default-subtasks");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
