export const ALL_TASKS_DATE_RANGES = [
  { value: "24", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All" },
] as const;

export type AllTasksDateRange = (typeof ALL_TASKS_DATE_RANGES)[number]["value"];

export const DEFAULT_ALL_TASKS_DATE_RANGE: AllTasksDateRange = "7";

export const parseAllTasksDateRange = (value: unknown): AllTasksDateRange => {
  const candidate = Array.isArray(value) ? value[0] : value;

  return ALL_TASKS_DATE_RANGES.some((range) => range.value === candidate)
    ? (candidate as AllTasksDateRange)
    : DEFAULT_ALL_TASKS_DATE_RANGE;
};

export const isAllTasksDateRange = (
  value: unknown,
): value is AllTasksDateRange =>
  typeof value === "string" &&
  ALL_TASKS_DATE_RANGES.some((range) => range.value === value);
