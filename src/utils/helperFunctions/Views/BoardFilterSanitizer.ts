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

/**
 * Reduces persisted board filters to the fields used by filter matching and UI rendering.
 * Clean inputs retain their original reference.
 */
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

export function sanitizeProjectViewBoardFilters<T>(projectView: T): T {
  if (!isRecord(projectView)) return projectView;

  let changed = false;
  const sanitized: Record<string, unknown> = { ...projectView };

  for (const key of ["default_view"] as const) {
    const view = sanitizeViewBoardFilters(projectView[key]);
    if (view !== projectView[key]) {
      sanitized[key] = view;
      changed = true;
    }
  }

  for (const key of ["allViews", "user_project_views"] as const) {
    const rows = projectView[key];
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

  return (changed ? sanitized : projectView) as T;
}

export function sanitizeProjectBoardFilters<T>(project: T): T {
  if (!isRecord(project) || !("project_view" in project)) return project;

  const projectView = sanitizeProjectViewBoardFilters(project.project_view);
  return (projectView === project.project_view
    ? project
    : { ...project, project_view: projectView }) as T;
}
