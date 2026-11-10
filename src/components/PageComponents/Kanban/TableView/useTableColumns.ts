import { useCallback, useEffect, useMemo } from "react";
import { normalizeTableVisibleColumns, withForcedStatusWhileSorted, seedMissingCustomFieldColumns, customFieldColumnKey, isCustomFieldColumnKey, customFieldIdFromColumnKey, LOCKED_TABLE_COLUMNS } from "@/store";
import type { TableViewProps } from "./tableViewShared";
import type { useTableState } from "./useTableState";
import { TableColumn, customFieldSortColumn, tableColumnByKey, StaticSortColumn, baseColumnWidthPx, MIN_COLUMN_WIDTH_PX } from "./tableViewShared";

type Context = Pick<TableViewProps, "_currentProject" | "enableMyTasksBulkSelection"> &
  Pick<ReturnType<typeof useTableState>, "myTasksColumnsControlled" | "customFieldById" | "customFields" | "setStoredVisibleColumns" | "timeColumnSeededBoards" | "setTimeColumnSeededBoards" | "normalizeVisibleColumns" | "storedVisibleColumns" | "sortState" | "columnWidths" | "setColumnWidths" | "titleHeaderRef">;

export function useTableColumns(context: Context) {
  const {
  _currentProject, myTasksColumnsControlled, customFieldById, customFields, setStoredVisibleColumns,
  timeColumnSeededBoards, setTimeColumnSeededBoards, normalizeVisibleColumns, storedVisibleColumns, sortState,
  columnWidths, setColumnWidths, titleHeaderRef, enableMyTasksBulkSelection,
  } = context;

  const toTableColumn = useCallback(
    (key: string): TableColumn | undefined => {
      if (key === "time" && !_currentProject?.showTimeTotals) return undefined;
      if (isCustomFieldColumnKey(key)) {
        if (myTasksColumnsControlled) return undefined;
        const field = customFieldById.get(customFieldIdFromColumnKey(key));
        if (!field) return undefined;
        if (field.showInTable === false) return undefined;
        return {
          key: customFieldSortColumn(field.id),
          label: field.name,
          width: "110px",
          className: field.type === "Number" ? "text-right" : undefined,
        };
      }
      const column = tableColumnByKey.get(key as StaticSortColumn);
      if (!column) return undefined;
      if (myTasksColumnsControlled && key === "status") {
        return { ...column, label: "Column" };
      }
      return column;
    },
    [customFieldById, _currentProject?.showTimeTotals, myTasksColumnsControlled]
  );
  useEffect(() => {
    if (myTasksColumnsControlled || !customFields.length) return;
    const customFieldKeys = customFields
      .filter((field) => field.showInTable !== false)
      .map((field) => customFieldColumnKey(field.id));
    setStoredVisibleColumns((current) => {
      const seeded = seedMissingCustomFieldColumns(normalizeTableVisibleColumns(current), customFieldKeys);
      return seeded.length === current.length ? current : seeded;
    });
  }, [customFields, myTasksColumnsControlled, setStoredVisibleColumns]);
  useEffect(() => {
    if (myTasksColumnsControlled) return;
    const projectId = _currentProject?.id;
    if (
      !projectId ||
      !_currentProject.showTimeTotals ||
      timeColumnSeededBoards.includes(projectId)
    ) {
      return;
    }
    setStoredVisibleColumns((current) => {
      const normalized = normalizeTableVisibleColumns(current);
      return normalized.includes("time") ? current : [...normalized, "time"];
    });
    setTimeColumnSeededBoards((current) =>
      current.includes(projectId) ? current : [...current, projectId],
    );
  }, [
    _currentProject?.id,
    _currentProject?.showTimeTotals,
    myTasksColumnsControlled,
    setStoredVisibleColumns,
    setTimeColumnSeededBoards,
    timeColumnSeededBoards,
  ]);
  const visibleColumns = useMemo(() => {
    const normalized = normalizeVisibleColumns(storedVisibleColumns);
    const keys = withForcedStatusWhileSorted(
      normalized,
      sortState.length > 0,
      !myTasksColumnsControlled,
    );
    return keys.map(toTableColumn).filter((column): column is TableColumn => Boolean(column));
  }, [
    myTasksColumnsControlled,
    normalizeVisibleColumns,
    storedVisibleColumns,
    sortState,
    toTableColumn,
  ]);
  const getColumnWidth = useCallback(
    (column: TableColumn) => columnWidths[column.key] ?? baseColumnWidthPx(column.width),
    [columnWidths]
  );
  const frozenColumnOffset = useCallback(
    (key: string): number | undefined => {
      if (key === "ticket") return 0;
      if (key !== "title") return undefined;
      const ticket = visibleColumns.find((column) => column.key === "ticket");
      if (!ticket) return 0;
      return getColumnWidth(ticket) + 8;
    },
    [visibleColumns, getColumnWidth]
  );
  const setColumnWidth = useCallback(
    (key: string, width: number) => {
      const clamped = Math.max(MIN_COLUMN_WIDTH_PX, Math.round(width));
      setColumnWidths((current) => (current[key] === clamped ? current : { ...current, [key]: clamped }));
    },
    [setColumnWidths]
  );
  const freezeTitleWidth = useCallback((): number | undefined => {
    if (columnWidths.title !== undefined) return undefined;
    const measured = titleHeaderRef.current?.getBoundingClientRect().width;
    if (!measured) return undefined;
    setColumnWidth("title", measured);
    return measured;
  }, [columnWidths.title, setColumnWidth]);
  const gridTemplateColumns = useMemo(() => {
    const columns = visibleColumns
      .map((column) =>
        column.key === "title" && columnWidths.title === undefined
          ? `minmax(${getColumnWidth(column)}px,1fr)`
          : `${getColumnWidth(column)}px`
      )
      .join(" ");
    return enableMyTasksBulkSelection ? `24px ${columns}` : columns;
  }, [visibleColumns, getColumnWidth, columnWidths, enableMyTasksBulkSelection]);
  const tableMinWidth = useMemo(() => {
    const columnsWidth =
      visibleColumns.reduce((total, column) => total + getColumnWidth(column), 0) +
      Math.max(visibleColumns.length - 1, 0) * 8 +
      40;
    return enableMyTasksBulkSelection ? columnsWidth + 24 + 8 : columnsWidth;
  }, [visibleColumns, getColumnWidth, enableMyTasksBulkSelection]);
  const reorderColumn = useCallback(
    (fromKey: string, toKey: string) => {
      if (fromKey === toKey || LOCKED_TABLE_COLUMNS.has(fromKey) || LOCKED_TABLE_COLUMNS.has(toKey)) return;
      setStoredVisibleColumns((current) => {
        const normalized = normalizeVisibleColumns(current);
        const from = normalized.indexOf(fromKey);
        const to = normalized.indexOf(toKey);
        if (from < 0 || to < 0) return current;
        const next = [...normalized];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [normalizeVisibleColumns, setStoredVisibleColumns]
  );
  const normalizedColumnOrder = useMemo(
    () => normalizeVisibleColumns(storedVisibleColumns),
    [normalizeVisibleColumns, storedVisibleColumns],
  );
  const storedColumnKeys = useMemo(() => new Set(normalizedColumnOrder), [normalizedColumnOrder]);
  return {
  visibleColumns, getColumnWidth, frozenColumnOffset, setColumnWidth, freezeTitleWidth,
  gridTemplateColumns, tableMinWidth, reorderColumn, normalizedColumnOrder, storedColumnKeys,
  };
}
