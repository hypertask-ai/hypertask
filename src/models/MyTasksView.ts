export type MyTasksDueDatePreset =
  | "overdue"
  | "today"
  | "this_week"
  | "next_7_days"
  | "no_due_date";

export type MyTasksDateRange = {
  from: string;
  to: string;
};

export type MyTasksSortField =
  | "dueDate"
  | "priority"
  | "createdAt"
  | "updatedAt"
  | "title"
  | "board";

export type MyTasksGroupBy = "time" | "board";

export type MyTasksViewConfig = {
  boardIds: number[] | null;
  filters: {
    priorityIds: number[];
    // Label.id is a UUID in this schema; numeric ids remain accepted for old/test data.
    labelIds: Array<string | number>;
    sizeIds: number[];
    sectionIds: number[];
    starred: boolean | null;
    dueDate: MyTasksDueDatePreset | MyTasksDateRange | null;
    createdRange: MyTasksDateRange | null;
    updatedRange: MyTasksDateRange | null;
    showDone: boolean;
  };
  sort: {
    field: MyTasksSortField;
    direction: "asc" | "desc";
  };
  /** Optional so older saved views keep working. Flag-off UI ignores this and stays on board. */
  groupBy?: MyTasksGroupBy;
};

export type MyTasksSavedView = {
  id: number;
  name: string;
  position: number;
  isDefault: boolean;
  config: MyTasksViewConfig;
};

export type MyTasksBoardMetadata = {
  id: number;
  title: string;
  sections: Array<{
    id: number;
    title: string;
    isDone: boolean | null;
  }>;
  labels: Array<{
    id: string;
    name: string;
  }>;
};

export const DEFAULT_MY_TASKS_VIEW_CONFIG: MyTasksViewConfig = {
  boardIds: null,
  filters: {
    priorityIds: [],
    labelIds: [],
    sizeIds: [],
    sectionIds: [],
    starred: null,
    dueDate: null,
    createdRange: null,
    updatedRange: null,
    showDone: false,
  },
  sort: {
    field: "dueDate",
    direction: "asc",
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberIds = (value: unknown, allowZero = true): number[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is number =>
          Number.isSafeInteger(id) && (allowZero ? id >= 0 : id > 0),
      ),
    ),
  ];
};

const labelIds = (value: unknown): Array<string | number> => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string | number =>
          (typeof id === "string" && id.length > 0 && id.length <= 100) ||
          (typeof id === "number" && Number.isSafeInteger(id) && id >= 0),
      ),
    ),
  ];
};

const dateRange = (value: unknown): MyTasksDateRange | null => {
  if (!isRecord(value) || typeof value.from !== "string" || typeof value.to !== "string") {
    return null;
  }
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null;
  return { from: value.from, to: value.to };
};

const DUE_DATE_PRESETS = new Set<MyTasksDueDatePreset>([
  "overdue",
  "today",
  "this_week",
  "next_7_days",
  "no_due_date",
]);

const dueDateFilter = (
  value: unknown,
): MyTasksDueDatePreset | MyTasksDateRange | null => {
  if (typeof value === "string" && DUE_DATE_PRESETS.has(value as MyTasksDueDatePreset)) {
    return value as MyTasksDueDatePreset;
  }
  return dateRange(value);
};

const SORT_FIELDS = new Set<MyTasksSortField>([
  "dueDate",
  "priority",
  "createdAt",
  "updatedAt",
  "title",
  "board",
]);

const GROUP_BY_VALUES = new Set<MyTasksGroupBy>(["time", "board"]);

const groupByValue = (value: unknown): MyTasksGroupBy | undefined =>
  typeof value === "string" && GROUP_BY_VALUES.has(value as MyTasksGroupBy)
    ? (value as MyTasksGroupBy)
    : undefined;

/**
 * Flag-off always returns board. Flag-on uses the saved value, or time when
 * the field is missing so My Tasks defaults to a personal to-do layout.
 */
export function effectiveMyTasksGroupBy(
  config: Pick<MyTasksViewConfig, "groupBy">,
  flagEnabled: boolean,
): MyTasksGroupBy {
  if (!flagEnabled) return "board";
  return config.groupBy ?? "time";
}

/** Returns a complete, safe config for persisted JSON or untrusted API input. */
export function parseMyTasksViewConfig(json: unknown): MyTasksViewConfig {
  const value = isRecord(json) ? json : {};
  const filters = isRecord(value.filters) ? value.filters : {};
  const sort = isRecord(value.sort) ? value.sort : {};
  const boardIds = Array.isArray(value.boardIds)
    ? numberIds(value.boardIds, false)
    : null;
  const sortField =
    typeof sort.field === "string" && SORT_FIELDS.has(sort.field as MyTasksSortField)
      ? (sort.field as MyTasksSortField)
      : DEFAULT_MY_TASKS_VIEW_CONFIG.sort.field;
  const groupBy = groupByValue(value.groupBy);

  return {
    boardIds: value.boardIds === undefined ? null : boardIds,
    filters: {
      priorityIds: numberIds(filters.priorityIds),
      labelIds: labelIds(filters.labelIds),
      sizeIds: numberIds(filters.sizeIds ?? filters.estimateIds),
      sectionIds: numberIds(filters.sectionIds),
      starred: typeof filters.starred === "boolean" ? filters.starred : null,
      dueDate: dueDateFilter(filters.dueDate),
      createdRange: dateRange(filters.createdRange),
      updatedRange: dateRange(filters.updatedRange),
      showDone: filters.showDone === true,
    },
    sort: {
      field: sortField,
      direction: sort.direction === "desc" ? "desc" : "asc",
    },
    ...(groupBy ? { groupBy } : {}),
  };
}
