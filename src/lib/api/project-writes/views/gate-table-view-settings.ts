import { Prisma } from "@prisma/client";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8973_TABLE_SORT_COLUMNS_FLAG } from "@/lib/flags/definitions/htpr-8973-table-sort-columns";
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
};

export const toJsonField = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

export const tableViewWriteData = (settings: TableViewSettingsWrite) => ({
  table_sort_column: settings.table_sort_column,
  table_sort_direction: settings.table_sort_direction,
  table_sort_stack: toJsonField(settings.table_sort_stack),
  table_columns: toJsonField(settings.table_columns),
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
  const enabled = await isFeatureEnabled(HTPR_8973_TABLE_SORT_COLUMNS_FLAG, userId);
  if (!enabled) {
    return {
      table_sort_column: primary.column,
      table_sort_direction: primary.direction,
      table_sort_stack: storedTableSortStack(inherited?.table_sort_stack),
      table_columns: sanitizeTableColumns(inherited?.table_columns),
    };
  }
  const hasStack = Object.prototype.hasOwnProperty.call(body, "table_sort_stack");
  const stack = hasStack
    ? sanitizeTableSortStack(body.table_sort_stack)
    : sanitizeTableSortStack(inherited?.table_sort_stack);
  const head = stack[0];
  const hasColumns = Object.prototype.hasOwnProperty.call(body, "table_columns");
  return {
    table_sort_column: hasStack ? head?.column ?? null : primary.column,
    table_sort_direction: hasStack ? head?.direction ?? null : primary.direction,
    table_sort_stack: storedTableSortStack(stack),
    table_columns: hasColumns
      ? sanitizeTableColumns(body.table_columns)
      : sanitizeTableColumns(inherited?.table_columns),
  };
}
