const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const { sanitizeProjectBoardFilters } = loadModule(
  "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts",
);
const { getActiveSubtaskSettingFromProject, subtaskSettingToStore } = loadModule(
  "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
);
const { persistExplicitSubtaskDraft } = loadModule(
  "src/lib/savedViews/explicitSubtaskDraft.ts",
);

const view = (id, setting, extra = {}) => ({
  id, project_view_id: "project-view", userId: 6, visibility: "Public",
  board_subtask_setting: setting, ...extra,
});

const projectWith = ({ defaultSetting, applied, draft, allViews, draftExtra }) => ({
  id: 2060, tasks: [], section: [],
  project_view: {
    id: "project-view", default_view_id: "default-view",
    default_view: view("default-view", defaultSetting),
    allViews: allViews ?? [view("default-view", defaultSetting), view("rat-stack", "Flattened")],
    user_project_views: [{
      id: "row", userId: 6, project_view_id: "project-view",
      appliedViewId: applied?.id ?? null,
      appliedView: applied ? view(applied.id, applied.setting) : null,
      unsavedViewId: draft ? "draft" : null,
      unsavedView: draft ? view("draft", draft, { visibility: "Private", ...draftExtra }) : null,
    }],
  },
});

const payload = (project, enabled) => sanitizeProjectBoardFilters(project, 6, false, enabled);
const active = (project, enabled) => getActiveSubtaskSettingFromProject(payload(project, enabled));

const countSettings = (project) => {
  const seen = [];
  const { countTasksInSavedView } = loadModule("src/lib/savedViews/savedViewTaskCounts.ts", {
    "@/utils/helperFunctions/Views/SubtaskHelperFunction": {
      applySubTaskSetting: (sections, setting) => { seen.push(setting); return sections; },
    },
  });
  const context = { legacyAgentAssigneeMatch: false };
  for (const saved of project.project_view.allViews) {
    countTasksInSavedView(saved, project, undefined, context);
  }
  return seen;
};

test("the switch is a reversible display bugfix that ships to owner and QA", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-9274-board-default-subtasks.ts");
  assert.equal(flag.key, "htpr-9274-board-default-subtasks");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("with the switch off the board payload is exactly what is stored", () => {
  const sanitized = payload(projectWith({ defaultSetting: "None", draft: "None" }), false).project_view;
  assert.equal(sanitized.board_subtask_setting_for_default_view, undefined);
  assert.equal(sanitized.default_view.board_subtask_setting, "None");
  assert.equal(sanitized.user_project_views[0].unsavedView.board_subtask_setting, "None");
});

test("the switch never rewrites a stored sub-ticket setting", () => {
  const sanitized = payload(projectWith({ defaultSetting: "None", draft: "None" }), true).project_view;
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
  assert.equal(active(projectWith({ defaultSetting: "None", draft: "None" }), true), "Flattened_Card");
});

test("an explicit hide on the main tab stays a hide", () => {
  const project = payload(projectWith({
    defaultSetting: "None", draft: "None", draftExtra: { board_subtask_explicit: true },
  }), true);
  assert.equal(getActiveSubtaskSettingFromProject(project), "None");
  assert.deepEqual(countSettings(project).slice(0, 1), ["None"]);
});

test("a draft someone picked on purpose is kept", () => {
  for (const draft of ["Parent", "Card", "Flattened"]) {
    assert.equal(active(projectWith({ defaultSetting: "None", draft }), true), draft);
  }
});

test("a board that already shows sub-tickets keeps every personal choice", () => {
  for (const draft of ["None", "Parent", "Card", "Flattened"]) {
    assert.equal(active(projectWith({ defaultSetting: "Flattened_Card", draft }), true), draft);
  }
});

test("a board default view that shows only parents is left alone", () => {
  assert.equal(active(projectWith({ defaultSetting: "Parent" }), true), "Parent");
});

test("a filtered view keeps its own sub-ticket setting", () => {
  assert.equal(active(projectWith({
    defaultSetting: "None", applied: { id: "rat-stack", setting: "Parent" },
  }), true), "Parent");
});

test("a filtered view keeps a personal draft of its sub-ticket setting", () => {
  assert.equal(active(projectWith({
    defaultSetting: "None",
    applied: { id: "rat-stack", setting: "Flattened" },
    draft: "Parent",
  }), true), "Parent");
});

test("a filtered view keeps an explicit hide draft", () => {
  assert.equal(active(projectWith({
    defaultSetting: "None",
    applied: { id: "rat-stack", setting: "Flattened" },
    draft: "None",
  }), true), "None");
});

test("a filtered view with an empty sub-ticket setting keeps the stored fallback", () => {
  const base = projectWith({
    defaultSetting: "None", applied: { id: "rat-stack", setting: "Flattened" },
  });
  base.project_view.user_project_views[0].appliedView.board_subtask_setting = null;
  assert.equal(active(base, true), "None");
  assert.notEqual(active(base, true), "Flattened_Card");
});

test("a payload with no default view does not invent a sub-ticket setting", () => {
  const base = projectWith({ defaultSetting: "None" });
  base.project_view.default_view = null;
  assert.equal(payload(base, true).project_view.board_subtask_setting_for_default_view, undefined);
});

test("an explicit hide is stored only while the switch is on and only on the main tab", () => {
  assert.equal(persistExplicitSubtaskDraft(false, true, true), false);
  assert.equal(persistExplicitSubtaskDraft(true, true, true), true);
  assert.equal(persistExplicitSubtaskDraft(true, true, false), false);
  assert.equal(persistExplicitSubtaskDraft(true, false, true), false);
});

test("a view save stores the board's own sub-ticket setting, not the display override", () => {
  const project = payload(projectWith({ defaultSetting: "None" }), true);
  assert.equal(getActiveSubtaskSettingFromProject(project), "Flattened_Card");
  assert.equal(subtaskSettingToStore(project), "None");
});

test("with the switch off the main board keeps the stored resolution", () => {
  assert.equal(active(projectWith({ defaultSetting: "None" }), false), "None");
});

test("the view tab count uses the same setting as the cards it counts", () => {
  const project = payload(projectWith({ defaultSetting: "None", draft: "None" }), true);
  assert.deepEqual(countSettings(project), ["Flattened_Card", "Flattened"]);
});

test("the main tab count stays on sub-ticket cards while another view is open", () => {
  const project = payload(projectWith({
    defaultSetting: "None", applied: { id: "rat-stack", setting: "Flattened" },
  }), true);
  assert.deepEqual(countSettings(project), ["Flattened_Card", "Flattened"]);
});
