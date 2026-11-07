const test = require("node:test");
const assert = require("node:assert/strict");
const { views, filters, url, savedProject, load } = require("./runtime.cjs");
const { sectionIds } = require("./fixture.cjs");
const { applyTransientTabSettings } = load("utils/helperFunctions/Views/TransientTabView.ts");

for (const slug of ["default", "known-tickets"]) {
  test(`queued settings target the open ${slug} view, not the canonical cache view`, () => {
    const { project, view } = savedProject({});
    project.project_view.default_view = { ...view, id: "default-id", slug: null };
    project.project_view.default_view_id = "default-id";
    const original = structuredClone(project);
    const openProject = url.pinProjectViewToUrl(project, slug);
    const queued = views.getProjectForViewMutation(project, openProject);
    const row = queued.project_view.user_project_views[0];
    assert.equal(row.appliedView?.id ?? null, slug === "default" ? null : view.id);
    assert.equal(row.unsavedView, undefined);
    assert.deepEqual(views.getActiveFiltersFromProject(queued), view.board_filters);
    assert.deepEqual(project, original);
  });
}

test("queued settings preserve the latest draft when its base is still selected", () => {
  const { project } = savedProject({});
  const row = project.project_view.user_project_views[0];
  const queued = views.getProjectForViewMutation(project, project);
  assert.equal(queued, project);
  assert.equal(views.getViewFromProject(queued).view, row.unsavedView);
});

for (const includeScalarId of [true, false]) {
  test(`transient response excludes persisted draft tabs with scalar id ${includeScalarId}`, () => {
    const { project, view } = savedProject({});
    const pv = project.project_view;
    const row = pv.user_project_views[0];
    if (includeScalarId) row.unsavedViewId = row.unsavedView.id;
    pv.allViews.push(row.unsavedView);
    const original = structuredClone(pv);
    const tagFilters = { matchFilters: "ALL", addedFilters: [{ type: "Labels", searchPayload: [{ id: "red" }] }] };
    const response = applyTransientTabSettings(pv, 6, null, { board_filters: tagFilters }, true);
    assert.deepEqual(response.allViews.map(v => v.id), ["previous", view.id]);
    assert.equal(response.user_project_views[0].appliedView, undefined);
    assert.deepEqual(response.user_project_views[0].unsavedView.board_filters, tagFilters);
    const active = { ...project, project_view: response };
    assert.equal(url.pinProjectViewToUrl(active, "default"), active);
    assert.deepEqual(views.getActiveFiltersFromProject(active), tagFilters);
    assert.deepEqual(sectionIds(filters.getFilteredSections(active.sections, active)), ["a", "c", "h", "e"]);
    assert.deepEqual(pv, original);
  });
}
