import {
  DEFAULT_TABLE_COLUMNS,
  TABLE_COLUMN_KEYS,
  isCustomFieldColumnKey,
  normalizeTableVisibleColumns,
  type TableColumnKey,
} from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";

export const TABLE_SORT_LEVEL_LIMIT = 3;
export const TABLE_COLUMN_WIDTH_MIN = 60;
export const TABLE_COLUMN_WIDTH_MAX = 2000;

export type TableSortLevel = { column: string; direction: "asc" | "desc" };
export type TableColumnSettings = { keys: string[]; widths: Record<string, number> };

const STATIC_KEYS = new Set<string>(TABLE_COLUMN_KEYS);
const DIRECTIONS = new Set(["asc", "desc"]);

export const isTableColumnKey = (column: string): boolean =>
  STATIC_KEYS.has(column) || /^customField:[0-9a-f-]{36}$/i.test(column);

export const sanitizeTableSortStack = (value: unknown): TableSortLevel[] => {
  if (!Array.isArray(value)) return [];
  const stack: TableSortLevel[] = [];
  const seen = new Set<string>();
  for (const level of value) {
    if (stack.length === TABLE_SORT_LEVEL_LIMIT) break;
    if (!level || typeof level !== "object") continue;
    const column = (level as { column?: unknown }).column;
    const direction = (level as { direction?: unknown }).direction;
    if (typeof column !== "string" || !isTableColumnKey(column) || seen.has(column)) continue;
    if (typeof direction !== "string" || !DIRECTIONS.has(direction)) continue;
    seen.add(column);
    stack.push({ column, direction: direction as "asc" | "desc" });
  }
  return stack;
};

export const storedTableSortStack = (value: unknown): TableSortLevel[] | null => {
  const stack = sanitizeTableSortStack(value);
  return stack.length ? stack : null;
};

export const applyTableSortClick = (
  sortState: readonly TableSortLevel[],
  column: string,
  shiftKey: boolean,
  initial: "asc" | "desc",
  allowStack: boolean,
): TableSortLevel[] => {
  const existingIndex = sortState.findIndex((level) => level.column === column);
  if (shiftKey && allowStack) {
    if (existingIndex >= 0) {
      return sortState.map((level, index) =>
        index === existingIndex
          ? { ...level, direction: level.direction === "asc" ? "desc" : "asc" }
          : level,
      );
    }
    if (sortState.length === TABLE_SORT_LEVEL_LIMIT) return [...sortState];
    return [...sortState, { column, direction: initial }];
  }
  if (sortState[0]?.column !== column) return [{ column, direction: initial }];
  if (sortState[0].direction === initial) {
    return [{ column, direction: initial === "asc" ? "desc" : "asc" }];
  }
  return [];
};

const isStoredColumnKey = (key: string): boolean =>
  (TABLE_COLUMN_KEYS as readonly string[]).includes(key) || isCustomFieldColumnKey(key);

export const sanitizeTableColumns = (value: unknown): TableColumnSettings | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { keys?: unknown; widths?: unknown };
  if (!Array.isArray(record.keys) || record.keys.length === 0) return null;
  const validKeys = record.keys.filter((key): key is string => typeof key === "string" && isStoredColumnKey(key));
  if (!validKeys.length) return null;
  const keys = normalizeTableVisibleColumns(validKeys);
  const widths: Record<string, number> = {};
  if (record.widths && typeof record.widths === "object" && !Array.isArray(record.widths)) {
    for (const [key, width] of Object.entries(record.widths as Record<string, unknown>)) {
      if (!isStoredColumnKey(key) || typeof width !== "number" || !Number.isFinite(width)) continue;
      widths[key] = Math.max(TABLE_COLUMN_WIDTH_MIN, Math.min(TABLE_COLUMN_WIDTH_MAX, Math.round(width)));
    }
  }
  return { keys, widths };
};

export const resolveTableColumns = (saved: TableColumnSettings | null): TableColumnSettings =>
  saved ?? { keys: [...DEFAULT_TABLE_COLUMNS], widths: {} };

export const hideTableColumn = (settings: TableColumnSettings, key: TableColumnKey | string): TableColumnSettings => {
  if (key === "ticket" || key === "title") return settings;
  return { ...settings, keys: settings.keys.filter((column) => column !== key) };
};

export const hideColumnOnView = (
  views: Record<string, TableColumnSettings | null>,
  viewId: string,
  key: string,
): Record<string, TableColumnSettings | null> => ({
  ...views,
  [viewId]: hideTableColumn(resolveTableColumns(views[viewId] ?? null), key),
});
