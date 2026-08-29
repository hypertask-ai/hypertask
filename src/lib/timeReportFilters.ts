export interface TimeReportFilters {
  teamId?: string;
  boardIds?: number[];
  taskId?: number;
  filterUserIds?: number[];
  from?: Date;
  to?: Date;
  runningOnly: boolean;
}

export type TimeReportFilterResult =
  | { success: true; filters: TimeReportFilters }
  | { success: false; filter: string };

function parsePositiveInteger(value: string | null) {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseRawList(params: URLSearchParams, key: string) {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim());
}

function parseDate(value: string | null, dateOnlyEndOfDay = false) {
  if (!value?.trim()) return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2})))?$/.exec(
      value
    );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match.map(Number);
  const hasTime = match[4] !== undefined;
  const hasNumericOffset = match[7] !== undefined;
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month - 1, day);
  calendarDay.setUTCHours(0, 0, 0, 0);
  if (
    calendarDay.getUTCFullYear() !== year ||
    calendarDay.getUTCMonth() !== month - 1 ||
    calendarDay.getUTCDate() !== day ||
    (hasTime && (hour > 23 || minute > 59 || second > 59)) ||
    (hasNumericOffset && (offsetHour > 23 || offsetMinute > 59))
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (!hasTime && dateOnlyEndOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
}

export function parseTimeReportFilters(
  params: URLSearchParams,
  userId: number
): TimeReportFilterResult {
  const scalarKeys = ["team", "task", "from", "to", "running"];
  const duplicateScalar = scalarKeys.find(
    (key) => params.getAll(key).length > 1
  );
  if (duplicateScalar) {
    return { success: false, filter: duplicateScalar };
  }
  if (params.has("team") && !params.get("team")?.trim()) {
    return { success: false, filter: "team" };
  }

  const rawBoardIds = parseRawList(params, "board");
  if (
    params.has("board") &&
    (rawBoardIds.length === 0 ||
      rawBoardIds.some((value) => parsePositiveInteger(value) === undefined))
  ) {
    return { success: false, filter: "board" };
  }
  const boardIds = [
    ...new Set(
      rawBoardIds
        .map((value) => parsePositiveInteger(value))
        .filter((value): value is number => value !== undefined)
    ),
  ];

  const rawUsers = parseRawList(params, "user");
  if (
    params.has("user") &&
    (rawUsers.length === 0 ||
      rawUsers.some(
        (value) => value !== "me" && parsePositiveInteger(value) === undefined
      ))
  ) {
    return { success: false, filter: "user" };
  }
  const filterUserIds = [
    ...new Set(
      rawUsers.map((value) =>
        value === "me" ? userId : parsePositiveInteger(value)
      )
    ),
  ].filter((value): value is number => value !== undefined);

  const taskParam = params.get("task");
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const runningParam = params.get("running")?.trim().toLowerCase();
  const taskId = parsePositiveInteger(taskParam);
  const from = parseDate(fromParam);
  const to = parseDate(toParam, true);

  if (params.has("task") && taskId === undefined) {
    return { success: false, filter: "task" };
  }
  if (params.has("from") && from === undefined) {
    return { success: false, filter: "from" };
  }
  if (params.has("to") && to === undefined) {
    return { success: false, filter: "to" };
  }
  if (from && to && from > to) {
    return { success: false, filter: "date range" };
  }
  if (
    params.has("running") &&
    !["0", "1", "false", "true"].includes(runningParam ?? "")
  ) {
    return { success: false, filter: "running" };
  }

  return {
    success: true,
    filters: {
      teamId: params.get("team")?.trim() || undefined,
      boardIds: boardIds.length ? boardIds : undefined,
      taskId,
      filterUserIds: filterUserIds.length ? filterUserIds : undefined,
      from,
      to,
      runningOnly: runningParam === "1" || runningParam === "true",
    },
  };
}
