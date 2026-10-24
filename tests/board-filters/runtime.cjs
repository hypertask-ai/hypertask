const path = require("node:path");
const { fixture, columns } = require("./fixture.cjs");
const root = path.resolve(__dirname, "../..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src"),
    "@/components/Common/UserAvatar": path.join(__dirname, "avatar-stub.cjs") },
});
const load = (file) => jiti(path.join(root, "src", file));
const filters = load("utils/helperFunctions/Views/FilterHelperFunctions.ts");
const views = load("utils/helperFunctions/Views/ViewsHelperFunctions.ts");
const board = load("utils/helperFunctions/helperFunctions.ts");
const table = load("components/PageComponents/Kanban/TableView/tableViewShared.tsx");
const sanitizer = load("utils/helperFunctions/Views/BoardFilterSanitizer.ts");
const url = load("lib/firstScreen/boardView.ts");

function savedProject(settings, surface = "board") {
  const { project } = fixture();
  const stored = JSON.stringify({
    id: "contract-view", slug: "known-tickets", project_view_id: "project-view",
    visibility: "Public", userId: 6,
    board_filters: { matchFilters: "ALL", addedFilters: [] },
    board_sorting_mode: "Manual", board_sorting_order: "Ascending", board_sorting_stack: [],
    board_columns_view: columns, board_subtask_setting: "Flattened_Card", board_empty_sections: "Show",
    table_sort_column: null, table_sort_direction: null,
    board_layout: surface === "table" ? "Table" : "Board",
    ...settings,
    ...(settings.board_filters ? { board_filters: sanitizer.sanitizeBoardFilters(settings.board_filters) } : {}),
  });
  const view = JSON.parse(stored);
  const previous = { ...view, id: "previous", slug: "previous", board_sorting_mode: "Title", board_sorting_order: "Descending",
    board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Priority", searchPayload: [{ priority_index: 4 }] }] } };
  project.project_view.allViews = [previous, view];
  project.project_view.user_project_views = [{ appliedView: previous, appliedViewId: previous.id,
    unsavedView: { ...previous, id: "draft" } }];
  const link = new URL(`https://example.invalid/project?id=15&view=${view.slug}&surface=${surface}`);
  return { project, view, link };
}

function restore(settings, surface = "board") {
  const { project, link } = savedProject(settings, surface);
  return url.pinProjectViewToUrl(project, link.searchParams.get("view"));
}

module.exports = { load, filters, views, board, table, sanitizer, url, savedProject, restore };
