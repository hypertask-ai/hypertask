import type { SortingMode, SortingOrder, ViewVisibility } from "@prisma/client";

export type CalendarDisplay = "month" | "week" | "day";

export type CalendarSettings = {
  weekStartsOn: "monday" | "sunday";
  showWeekends: boolean;
};

export type CalendarTaskFilters = {
  assignedToMe: boolean;
  updatedBy: number[];
  createdBy: number[];
  priority: number[];
  assignees: number[];
  assigneeAgents: string[];
  updatedByAgents: string[];
  labels: string[];
  size: number[];
  matchFilters: "ALL" | "ANY";
};

export type CalendarSort = {
  mode: SortingMode;
  order: SortingOrder;
};

export type LegacyCalendarSavedView = {
  id: string;
  title: string;
  checkedProjects: number[];
  taskFilters: CalendarTaskFilters;
  settings: CalendarSettings & { view: CalendarDisplay };
  sort: CalendarSort | null;
};

export type CalendarSavedView = LegacyCalendarSavedView & {
  createdAt: string;
  updatedAt: string;
  userId: number;
  visibility: ViewVisibility;
};

/** Overwritten state of the built-in Everything split (no id). */
export type CalendarEverythingOverride = Omit<
  LegacyCalendarSavedView,
  "id" | "title"
> & { title?: string };

export type CalendarViewsPreference = {
  views: LegacyCalendarSavedView[];
  appliedViewId: string | null;
  everything?: CalendarEverythingOverride | null;
};

export type CalendarViewsOperation =
  | { type: "create"; view: LegacyCalendarSavedView; apply: boolean }
  | { type: "update"; view: LegacyCalendarSavedView; apply: boolean }
  | { type: "delete"; viewId: string }
  | { type: "setAppliedViewId"; appliedViewId: string | null }
  | { type: "setEverything"; everything: CalendarEverythingOverride | null };

export type CalendarViewCreateInput = {
  title: string;
  visibility: ViewVisibility;
  projectIds: number[];
  taskFilters: CalendarTaskFilters;
  settings: CalendarSettings & { view: CalendarDisplay };
  sort: CalendarSort | null;
};

export type CalendarViewPatchInput = Partial<CalendarViewCreateInput>;

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  weekStartsOn: "monday",
  showWeekends: false,
};

export const DEFAULT_CALENDAR_TASK_FILTERS: CalendarTaskFilters = {
  assignedToMe: false,
  updatedBy: [],
  createdBy: [],
  priority: [],
  assignees: [],
  assigneeAgents: [],
  updatedByAgents: [],
  labels: [],
  size: [],
  matchFilters: "ANY",
};

export const DEFAULT_CALENDAR_VIEWS: CalendarViewsPreference = {
  views: [],
  appliedViewId: null,
};

const SORTING_MODES = [
  "Manual",
  "Priority",
  "DueDate",
  "Size",
  "CreatedAt",
  "UpdatedAt",
  "SectionChangedAt",
  "LastCommentAt",
  "Assignee",
  "Title",
  "TicketNumber",
  "TimeInColumn",
  "TimeOnBoard",
  "TimeWithoutComment",
] as const satisfies readonly SortingMode[];

const SORTING_ORDERS = [
  "Ascending",
  "Descending",
] as const satisfies readonly SortingOrder[];

type AssertNever<T extends never> = T;
type _AllSortingModesHandled = AssertNever<
  Exclude<SortingMode, (typeof SORTING_MODES)[number]>
>;
type _AllSortingOrdersHandled = AssertNever<
  Exclude<SortingOrder, (typeof SORTING_ORDERS)[number]>
>;

const sortingModes = new Set<string>(SORTING_MODES);
const sortingOrders = new Set<string>(SORTING_ORDERS);

const isNumberArray = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every((item) => Number.isInteger(item));

const isStringArray = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every((item) => typeof item === "string" && item.length <= 100);

const isTaskFilters = (
  value: unknown,
  narrow = false,
): value is CalendarTaskFilters => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const filters = value as Record<string, unknown>;
  return (
    (!narrow ||
      hasOnlyKeys(filters, [
        "assignedToMe",
        "updatedBy",
        "createdBy",
        "priority",
        "assignees",
        "assigneeAgents",
        "updatedByAgents",
        "labels",
        "size",
        "matchFilters",
      ])) &&
    typeof filters.assignedToMe === "boolean" &&
    isNumberArray(filters.updatedBy) &&
    isNumberArray(filters.createdBy) &&
    isNumberArray(filters.priority) &&
    isNumberArray(filters.assignees) &&
    isStringArray(filters.assigneeAgents) &&
    isStringArray(filters.updatedByAgents) &&
    isStringArray(filters.labels) &&
    isNumberArray(filters.size) &&
    (filters.matchFilters === "ALL" || filters.matchFilters === "ANY")
  );
};

export const isCalendarViewsPreference = (
  value: unknown,
): value is CalendarViewsPreference => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preference = value as Record<string, unknown>;
  if (
    !Array.isArray(preference.views) ||
    preference.views.length > 20 ||
    (preference.appliedViewId !== null &&
      typeof preference.appliedViewId !== "string")
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const value of preference.views) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const view = value as Record<string, unknown>;
    if (
      typeof view.id !== "string" ||
      !view.id ||
      view.id.length > 100 ||
      ids.has(view.id) ||
      typeof view.title !== "string" ||
      !view.title.trim() ||
      view.title.length > 60 ||
      !isViewBody(view)
    ) {
      return false;
    }
    ids.add(view.id);
  }

  if (
    preference.everything !== undefined &&
    preference.everything !== null &&
    !isEverythingOverride(preference.everything)
  ) {
    return false;
  }

  // The applied pointer may reference a shared view stored in Calendar_View,
  // not the legacy per-user array being validated here.
  return true;
};

/** Shared body checks for saved views and the Everything override.
 * Deliberately not a type predicate: narrowing the views-loop variable to
 * the id-less override type would break the id/title checks around it. */
const isViewBody = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const view = value as Record<string, unknown>;
  const settings = view.settings as Record<string, unknown> | undefined;
  const sort = view.sort as Record<string, unknown> | null;
  return (
    isNumberArray(view.checkedProjects) &&
    isTaskFilters(view.taskFilters) &&
    !!settings &&
    (settings.weekStartsOn === "monday" ||
      settings.weekStartsOn === "sunday") &&
    typeof settings.showWeekends === "boolean" &&
    (settings.view === "week" ||
      settings.view === "month" ||
      settings.view === "day") &&
    (sort === null ||
      (!!sort &&
        typeof sort.mode === "string" &&
        sortingModes.has(sort.mode) &&
        typeof sort.order === "string" &&
        sortingOrders.has(sort.order)))
  );
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const isEverythingOverride = (
  value: unknown,
): value is CalendarEverythingOverride => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const everything = value as Record<string, unknown>;
  const hasTitle = Object.prototype.hasOwnProperty.call(everything, "title");
  const title = everything.title;
  return (
    hasOnlyKeys(
      everything,
      hasTitle
        ? ["checkedProjects", "taskFilters", "settings", "sort", "title"]
        : ["checkedProjects", "taskFilters", "settings", "sort"],
    ) &&
    (!hasTitle ||
      (typeof title === "string" &&
        title.length <= 120 &&
        title.trim().length >= 1 &&
        title.trim().length <= 60)) &&
    isViewBody(everything)
  );
};

export const sanitizeCalendarViewsPreference = (
  value: unknown,
): CalendarViewsPreference | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { everything, ...preference } = value as Record<string, unknown>;
  if (!isCalendarViewsPreference(preference)) return null;
  if (
    everything === undefined ||
    everything === null ||
    isEverythingOverride(everything)
  ) {
    return value as CalendarViewsPreference;
  }
  return preference;
};

const isViewId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 100;

export const isCalendarViewsOperation = (
  value: unknown,
): value is CalendarViewsOperation => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = value as Record<string, unknown>;

  if (operation.type === "create" || operation.type === "update") {
    if (
      !hasOnlyKeys(operation, ["type", "view", "apply"]) ||
      typeof operation.apply !== "boolean" ||
      !operation.view ||
      typeof operation.view !== "object" ||
      Array.isArray(operation.view)
    ) {
      return false;
    }
    const view = operation.view as Record<string, unknown>;
    return (
      isViewId(view.id) &&
      isCalendarViewsPreference({
        views: [operation.view],
        appliedViewId: view.id,
      })
    );
  }

  if (operation.type === "delete") {
    return (
      hasOnlyKeys(operation, ["type", "viewId"]) && isViewId(operation.viewId)
    );
  }

  if (operation.type === "setEverything") {
    return (
      hasOnlyKeys(operation, ["type", "everything"]) &&
      (operation.everything === null ||
        isEverythingOverride(operation.everything))
    );
  }

  return (
    operation.type === "setAppliedViewId" &&
    hasOnlyKeys(operation, ["type", "appliedViewId"]) &&
    (operation.appliedViewId === null || isViewId(operation.appliedViewId))
  );
};

const isTitle = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length >= 2 &&
  value.trim().length <= 60;

const isVisibility = (value: unknown): value is ViewVisibility =>
  value === "Public" || value === "Private";

const isProjectIds = (value: unknown): value is number[] =>
  isNumberArray(value) &&
  (value as number[]).every((projectId) => projectId > 0) &&
  new Set(value as number[]).size === (value as number[]).length;

const isCalendarSettings = (
  value: unknown,
): value is CalendarViewCreateInput["settings"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (
    hasOnlyKeys(settings, ["weekStartsOn", "showWeekends", "view"]) &&
    (settings.weekStartsOn === "monday" ||
      settings.weekStartsOn === "sunday") &&
    typeof settings.showWeekends === "boolean" &&
    (settings.view === "week" ||
      settings.view === "month" ||
      settings.view === "day")
  );
};

const isCalendarSort = (value: unknown): value is CalendarSort | null => {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sort = value as Record<string, unknown>;
  return (
    hasOnlyKeys(sort, ["mode", "order"]) &&
    typeof sort.mode === "string" &&
    sortingModes.has(sort.mode) &&
    typeof sort.order === "string" &&
    sortingOrders.has(sort.order)
  );
};

export const isCalendarViewCreateInput = (
  value: unknown,
): value is CalendarViewCreateInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    hasOnlyKeys(input, [
      "title",
      "visibility",
      "projectIds",
      "taskFilters",
      "settings",
      "sort",
    ]) &&
    isTitle(input.title) &&
    isVisibility(input.visibility) &&
    isProjectIds(input.projectIds) &&
    // A public view must name at least one board. Empty private views retain
    // the existing "all visible boards" behavior for their owner.
    (input.visibility !== "Public" || input.projectIds.length > 0) &&
    isTaskFilters(input.taskFilters, true) &&
    isCalendarSettings(input.settings) &&
    isCalendarSort(input.sort)
  );
};

export const isCalendarViewPatchInput = (
  value: unknown,
): value is CalendarViewPatchInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowedKeys = [
    "title",
    "visibility",
    "projectIds",
    "taskFilters",
    "settings",
    "sort",
  ];
  if (keys.length === 0 || keys.some((key) => !allowedKeys.includes(key))) {
    return false;
  }
  return (
    (input.title === undefined || isTitle(input.title)) &&
    (input.visibility === undefined || isVisibility(input.visibility)) &&
    (input.projectIds === undefined || isProjectIds(input.projectIds)) &&
    (input.visibility !== "Public" ||
      input.projectIds === undefined ||
      input.projectIds.length > 0) &&
    (input.taskFilters === undefined ||
      isTaskFilters(input.taskFilters, true)) &&
    (input.settings === undefined || isCalendarSettings(input.settings)) &&
    (input.sort === undefined || isCalendarSort(input.sort))
  );
};

export const applyCalendarViewsOperation = (
  current: CalendarViewsPreference,
  operation: CalendarViewsOperation,
): CalendarViewsPreference | null => {
  let next: CalendarViewsPreference;

  if (operation.type === "create") {
    next = {
      ...current,
      views: [...current.views, operation.view],
      appliedViewId: operation.apply
        ? operation.view.id
        : current.appliedViewId,
    };
  } else if (operation.type === "update") {
    const exists = current.views.some((view) => view.id === operation.view.id);
    if (!exists) return null;
    next = {
      ...current,
      views: current.views.map((view) =>
        view.id === operation.view.id ? operation.view : view,
      ),
      appliedViewId: operation.apply
        ? operation.view.id
        : current.appliedViewId,
    };
  } else if (operation.type === "delete") {
    next = {
      ...current,
      views: current.views.filter((view) => view.id !== operation.viewId),
      appliedViewId:
        current.appliedViewId === operation.viewId
          ? null
          : current.appliedViewId,
    };
  } else if (operation.type === "setEverything") {
    next = { ...current, everything: operation.everything };
  } else {
    next = { ...current, appliedViewId: operation.appliedViewId };
  }

  return isCalendarViewsPreference(next) ? next : null;
};
