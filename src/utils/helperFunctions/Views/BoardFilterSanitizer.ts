const BOARD_FILTER_KEYS = new Set(["addedFilters", "matchFilters"]);
const FILTER_ENTRY_KEYS = new Set(["match", "searchPayload", "type"]);
const SEARCH_PAYLOAD_KEYS = new Set([
  "Priority_Value",
  "condition",
  "displayName",
  "dynamicRange",
  "estimate_index",
  "estimate_value",
  "fromDate",
  "id",
  "photoURL",
  "priority_index",
  "selectedDate",
  "toDate",
  "uid",
  "value",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonPrimitive = (value: unknown) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

function sanitizeSearchPayloadItem(item: unknown): unknown {
  if (!isRecord(item)) return item;

  let changed = false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(item)) {
    if (SEARCH_PAYLOAD_KEYS.has(key) && isJsonPrimitive(value)) {
      sanitized[key] = value;
    } else {
      changed = true;
    }
  }

  return changed ? sanitized : item;
}

function sanitizeFilterEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;

  let changed = false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (!FILTER_ENTRY_KEYS.has(key)) {
      changed = true;
      continue;
    }

    if (key !== "searchPayload") {
      sanitized[key] = value;
      continue;
    }

    if (!Array.isArray(value)) {
      changed = true;
      sanitized.searchPayload = [];
      continue;
    }

    const searchPayload = value.map(sanitizeSearchPayloadItem);
    if (searchPayload.some((item, index) => item !== value[index])) {
      changed = true;
    }
    sanitized.searchPayload = changed ? searchPayload : value;
  }

  return changed ? sanitized : entry;
}

export function sanitizeBoardFilters<T>(boardFilters: T): T {
  if (!isRecord(boardFilters)) return boardFilters;

  let changed = false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(boardFilters)) {
    if (!BOARD_FILTER_KEYS.has(key)) {
      changed = true;
      continue;
    }

    if (key !== "addedFilters") {
      sanitized[key] = value;
      continue;
    }

    if (!Array.isArray(value)) {
      changed = true;
      sanitized.addedFilters = [];
      continue;
    }

    const addedFilters = value.map(sanitizeFilterEntry);
    if (addedFilters.some((entry, index) => entry !== value[index])) {
      changed = true;
    }
    sanitized.addedFilters = changed ? addedFilters : value;
  }

  return (changed ? sanitized : boardFilters) as T;
}

export function sanitizeViewBoardFilters<T>(view: T): T {
  if (!isRecord(view) || !("board_filters" in view)) return view;

  const boardFilters = sanitizeBoardFilters(view.board_filters);
  return (boardFilters === view.board_filters
    ? view
    : { ...view, board_filters: boardFilters }) as T;
}

export function projectVisibleViewRelations<T>(projectView: T, userId: number | undefined, publicOnly = false): T {
  if (!isRecord(projectView)) return projectView;
  const visible = (view: unknown, draft = false) => isRecord(view) &&
    typeof projectView.id === "string" && view.project_view_id === projectView.id &&
    (draft
      ? !publicOnly && userId !== undefined && view.userId === userId
      : view.visibility === "Public" || (!publicOnly && userId !== undefined && view.userId === userId));
  const defaultView = visible(projectView.default_view) ? projectView.default_view : null;
  const rows = projectView.user_project_views;
  return {
    ...projectView,
    default_view: defaultView,
    ...("default_view_id" in projectView && !defaultView ? { default_view_id: null } : {}),
    ...(Array.isArray(rows) ? { user_project_views: rows.map(row => {
      if (!isRecord(row)) return row;
      const appliedView = visible(row.appliedView) ? row.appliedView : null;
      const unsavedView = visible(row.unsavedView, true) ? row.unsavedView : null;
      return {
        ...row, appliedView,
        ...("unsavedView" in row ? { unsavedView } : {}),
        ...("appliedViewId" in row && !appliedView ? { appliedViewId: null } : {}),
        ...("unsavedViewId" in row && !unsavedView ? { unsavedViewId: null } : {}),
      };
    }) } : {}),
  } as T;
}

export function sanitizeProjectViewBoardFilters<T>(projectView: T, userId?: number, publicOnly = false): T {
  if (!isRecord(projectView)) return projectView;
  const visibleProjectView = userId !== undefined || publicOnly
    ? projectVisibleViewRelations(projectView, userId, publicOnly) : projectView;

  let changed = false;
  const sanitized: Record<string, unknown> = { ...visibleProjectView };

  for (const key of ["default_view"] as const) {
    const view = sanitizeViewBoardFilters(visibleProjectView[key]);
    if (view !== visibleProjectView[key]) {
      sanitized[key] = view;
      changed = true;
    }
  }

  for (const key of ["allViews", "user_project_views"] as const) {
    const rows = visibleProjectView[key];
    if (!Array.isArray(rows)) continue;

    const sanitizedRows = rows.map((row) => {
      if (key === "allViews") return sanitizeViewBoardFilters(row);
      if (!isRecord(row)) return row;

      const appliedView = sanitizeViewBoardFilters(row.appliedView);
      const unsavedView = sanitizeViewBoardFilters(row.unsavedView);
      if (appliedView === row.appliedView && unsavedView === row.unsavedView) {
        return row;
      }
      return { ...row, appliedView, unsavedView };
    });

    if (sanitizedRows.some((row, index) => row !== rows[index])) {
      sanitized[key] = sanitizedRows;
      changed = true;
    }
  }

  return (changed ? sanitized : visibleProjectView) as T;
}

export function sanitizeProjectBoardFilters<T>(project: T, userId?: number, publicOnly = false): T {
  if (!isRecord(project) || !("project_view" in project)) return project;

  const projectView = sanitizeProjectViewBoardFilters(project.project_view, userId, publicOnly);
  return (projectView === project.project_view
    ? project
    : { ...project, project_view: projectView }) as T;
}
