const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const { sanitizeProjectBoardFilters } = loadModule(
  "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts",
);
const { getActiveSubtaskSettingFromProject } = loadModule(
  "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
);

const view = (id, setting, extra = {}) => ({
  id,
  project_view_id: "project-view",
  userId: 6,
  visibility: "Public",
  board_subtask_setting: setting,
  ...extra,
});

const projectWith = ({ defaultSetting, applied, draft, allViews }) => ({
  id: 2060,
  tasks: [],
  section: [],
  project_view: {
    id: "project-view",
    default_view_id: "default-view",
    default_view: view("default-view", defaultSetting),
    allViews: allViews ?? [
      view("default-view", defaultSetting),
      view("rat-stack", "Flattened"),
    ],
    user_project_views: [{
      id: "row",
      userId: 6,
      project_view_id: "project-view",
      appliedViewId: applied?.id ?? null,
      appliedView: applied ? view(applied.id, applied.setting) : null,
      unsavedViewId: draft ? "draft" : null,
      unsavedView: draft ? view("draft", draft, { visibility: "Private" }) : null,
    }],
  },
});

const payload = (project, enabled) =>
  sanitizeProjectBoardFilters(project, 6, false, enabled);

test("the switch is a reversible display bugfix that ships to owner and QA", () => {
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

test("with the switch off the board payload is exactly what is stored", () => {
  const project = projectWith({ defaultSetting: "None", draft: "None" });
  const sanitized = payload(project, false).project_view;

  assert.equal(sanitized.board_subtask_setting_for_default_view, undefined);
  assert.equal(sanitized.default_view.board_subtask_setting, "None");
  assert.equal(sanitized.user_project_views[0].unsavedView.board_subtask_setting, "None");
});

test("the switch never rewrites a stored sub-ticket setting", () => {
  const project = projectWith({ defaultSetting: "None", draft: "None" });
  const sanitized = payload(project, true).project_view;

  assert.equal(sanitized.default_view.board_subtask_setting, "None");
  assert.equal(sanitized.allViews[0].board_subtask_setting, "None");
  assert.equal(sanitized.user_project_views[0].unsavedView.board_subtask_setting, "None");
});

test("a board default view that hides sub-tickets shows them on the main board", () => {
  const project = payload(projectWith({ defaultSetting: "None" }), true);

  assert.equal(project.project_view.board_subtask_setting_for_default_view, "Flattened_Card");
  assert.equal(getActiveSubtaskSettingFromProject(project), "Flattened_Card");
});

test("a draft inherited from that board default stops hiding sub-tickets", () => {
  const project = payload(projectWith({ defaultSetting: "None", draft: "None" }), true);

  assert.equal(getActiveSubtaskSettingFromProject(project), "Flattened_Card");
});

test("a draft someone picked on purpose is kept", () => {
  for (const draft of ["Parent", "Card", "Flattened"]) {
    const project = payload(projectWith({ defaultSetting: "None", draft }), true);
    assert.equal(getActiveSubtaskSettingFromProject(project), draft);
  }
});

test("a board that already shows sub-tickets keeps every personal choice", () => {
  for (const draft of ["None", "Parent", "Card", "Flattened"]) {
    const project = payload(projectWith({ defaultSetting: "Flattened_Card", draft }), true);
    assert.equal(getActiveSubtaskSettingFromProject(project), draft);
  }
});

test("a board default view that shows only parents is left alone", () => {
  const project = payload(projectWith({ defaultSetting: "Parent" }), true);

  assert.equal(getActiveSubtaskSettingFromProject(project), "Parent");
});

test("a filtered view keeps its own sub-ticket setting", () => {
  const project = payload(
    projectWith({ defaultSetting: "None", applied: { id: "rat-stack", setting: "Parent" } }),
    true,
  );

  assert.equal(getActiveSubtaskSettingFromProject(project), "Parent");
});

test("a filtered view keeps a personal draft of its sub-ticket setting", () => {
  const project = payload(
    projectWith({
      defaultSetting: "None",
      applied: { id: "rat-stack", setting: "Flattened" },
      draft: "Parent",
    }),
    true,
  );

  assert.equal(getActiveSubtaskSettingFromProject(project), "Parent");
});

test("a filtered view keeps an explicit hide draft", () => {
  const project = payload(
    projectWith({
      defaultSetting: "None",
      applied: { id: "rat-stack", setting: "Flattened" },
      draft: "None",
    }),
    true,
  );

  assert.equal(getActiveSubtaskSettingFromProject(project), "None");
});

test("a filtered view with an empty sub-ticket setting keeps the stored fallback", () => {
  const base = projectWith({
    defaultSetting: "None",
    applied: { id: "rat-stack", setting: "Flattened" },
  });
  base.project_view.user_project_views[0].appliedView.board_subtask_setting = null;
  const project = payload(base, true);

  assert.equal(getActiveSubtaskSettingFromProject(project), "None");
  assert.notEqual(getActiveSubtaskSettingFromProject(project), "Flattened_Card");
});

test("a payload with no default view does not invent a sub-ticket setting", () => {
  const base = projectWith({ defaultSetting: "None" });
  base.project_view.default_view = null;
  const sanitized = payload(base, true).project_view;

  assert.equal(sanitized.board_subtask_setting_for_default_view, undefined);
});

test("with the switch off the main board keeps the stored resolution", () => {
  const project = payload(projectWith({ defaultSetting: "None" }), false);

  assert.equal(getActiveSubtaskSettingFromProject(project), "None");
});

test("the view tab count uses the same setting as the cards it counts", () => {
  const seen = [];
  const { countTasksInSavedView } = loadModule("src/lib/savedViews/savedViewTaskCounts.ts", {
    "@/utils/helperFunctions/Views/SubtaskHelperFunction": {
      applySubTaskSetting: (sections, setting) => {
        seen.push(setting);
        return sections;
      },
    },
  });
  const project = payload(projectWith({ defaultSetting: "None", draft: "None" }), true);
  const context = { legacyAgentAssigneeMatch: false };

  countTasksInSavedView(project.project_view.allViews[0], project, undefined, context);
  countTasksInSavedView(project.project_view.allViews[1], project, undefined, context);

  assert.deepEqual(seen, ["Flattened_Card", "Flattened"]);
});

test("the main tab count stays on sub-ticket cards while another view is open", () => {
  const seen = [];
  const { countTasksInSavedView } = loadModule("src/lib/savedViews/savedViewTaskCounts.ts", {
    "@/utils/helperFunctions/Views/SubtaskHelperFunction": {
      applySubTaskSetting: (sections, setting) => {
        seen.push(setting);
        return sections;
      },
    },
  });
  const project = payload(
    projectWith({ defaultSetting: "None", applied: { id: "rat-stack", setting: "Flattened" } }),
    true,
  );
  const context = { legacyAgentAssigneeMatch: false };

  countTasksInSavedView(project.project_view.allViews[0], project, undefined, context);
  countTasksInSavedView(project.project_view.allViews[1], project, undefined, context);

  assert.deepEqual(seen, ["Flattened_Card", "Flattened"]);
});
