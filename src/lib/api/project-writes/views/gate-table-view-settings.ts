import { Prisma } from "@prisma/client";
import { isFeatureEnabled } from "@/lib/flags";
import {
  sanitizeTableColumns,
  sanitizeTableSortStack,
  storedTableSortStack,
  type TableColumnSettings,
  type TableSortLevel,
} from "@/lib/table-view/tableViewSettings";
import { sanitizeTableSort } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

export type TableViewSettingsWrite = {
  table_sort_column: string | null;
  table_sort_direction: string | null;
  table_sort_stack: TableSortLevel[] | null;
  table_columns: TableColumnSettings | null;
  persistStack: boolean;
  persistColumns: boolean;
};

export const toJsonField = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

export const tableViewWriteData = (settings: TableViewSettingsWrite) => ({
  table_sort_column: settings.table_sort_column,
  table_sort_direction: settings.table_sort_direction,
  ...tableViewChangedJson(settings),
  ...(!settings.persistStack && settings.table_sort_stack != null
    ? { table_sort_stack: settings.table_sort_stack }
    : {}),
  ...(!settings.persistColumns && settings.table_columns != null
    ? { table_columns: settings.table_columns }
    : {}),
});

export const tableViewChangedJson = (settings: TableViewSettingsWrite) => ({
  ...(settings.persistStack ? { table_sort_stack: toJsonField(settings.table_sort_stack) } : {}),
  ...(settings.persistColumns ? { table_columns: toJsonField(settings.table_columns) } : {}),
});

export const tableViewCompareData = (settings: TableViewSettingsWrite) => ({
  table_sort_column: settings.table_sort_column,
  table_sort_direction: settings.table_sort_direction,
  table_sort_stack: settings.table_sort_stack,
  table_columns: settings.table_columns,
});

export async function tableViewSettingsForWrite(
  userId: number,
  body: Record<string, unknown>,
  inherited: { table_sort_stack?: unknown; table_columns?: unknown } | null | undefined,
): Promise<TableViewSettingsWrite> {
  const primary = sanitizeTableSort(body.table_sort_column, body.table_sort_direction);
  const hasStack = Object.prototype.hasOwnProperty.call(body, "table_sort_stack");
  const hasColumns = Object.prototype.hasOwnProperty.call(body, "table_columns");
  if ((hasStack || hasColumns) && await isFeatureEnabled("htpr-8973-table-sort-columns", userId)) {
    const stack = hasStack
      ? sanitizeTableSortStack(body.table_sort_stack)
      : sanitizeTableSortStack(inherited?.table_sort_stack);
    const head = stack[0];
    return {
      table_sort_column: hasStack ? head?.column ?? null : primary.column,
      table_sort_direction: hasStack ? head?.direction ?? null : primary.direction,
      table_sort_stack: storedTableSortStack(stack),
      table_columns: hasColumns
        ? sanitizeTableColumns(body.table_columns)
        : sanitizeTableColumns(inherited?.table_columns),
      persistStack: hasStack,
      persistColumns: hasColumns,
    };
  }
  return {
    table_sort_column: primary.column,
    table_sort_direction: primary.direction,
    table_sort_stack: storedTableSortStack(inherited?.table_sort_stack),
    table_columns: sanitizeTableColumns(inherited?.table_columns),
    persistStack: false,
    persistColumns: false,
  };
}
