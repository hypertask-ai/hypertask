const test = require("node:test");
const assert = require("node:assert/strict");
const { NOW, fixture, sectionIds } = require("./fixture.cjs");
const { cases } = require("./filter-cases.cjs");
const { modal } = require("../helpers/calendar-range-modal.cjs");
const { filters, views, savedProject } = require("./runtime.cjs");

for (const entry of cases) {
  test(entry.name, { todo: entry.knownBug }, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const { sections, project, runtime } = fixture();
    Object.assign(project, entry.projectSettings);
    const context = entry.noRuntime ? undefined : entry.runningIds ? { runningTaskIds: new Set(entry.runningIds) } : runtime;
    const live = entry.filters.map((filter) => ({
      ...filter,
      condition: filters.defaultConditions[filter.type],
      searchPayload: entry.calendarMode ? filter.searchPayload.map(({ fromDate, toDate }) =>
        modal(entry.calendarMode).custom({ from: new Date(fromDate), to: new Date(toDate) })) : filter.searchPayload,
    }));
    for (const overall of entry.overall ? [entry.overall] : ["ANY", "ALL"]) {
      for (const addedFilters of [live, JSON.parse(JSON.stringify(live))]) {
        assert.deepEqual(sectionIds(filters.applyFilters(sections, addedFilters, overall, project, context)), entry.expected);
      }
      for (const surface of ["board", "table"]) {
        const { project: storedProject, link } = savedProject({ board_filters: { addedFilters: live, matchFilters: overall } }, surface);
        Object.assign(storedProject, entry.projectSettings);
        const pinned = views.pinProjectToUrlView(storedProject, link.searchParams.get("view"));
        assert.equal(pinned.project_view.user_project_views[0].unsavedView, undefined);
        if (!entry.filters.some((filter) => filter.type === "RunningTimer")) {
          assert.deepEqual(sectionIds(pinned.filteredSections), entry.expected);
        }
        assert.deepEqual(sectionIds(filters.getFilteredSections(pinned.sections, pinned, undefined, {}, context)), entry.expected);
      }
    }
  });
}

test("filter registry has an exact option coverage matrix", () => {
  const covered = [...new Set(cases.flatMap((entry) => entry.filters.map((filter) => filter.type)))].filter((type) => type !== "Unknown").sort();
  assert.deepEqual(covered, Object.keys(filters.defaultConditions).sort());
});
