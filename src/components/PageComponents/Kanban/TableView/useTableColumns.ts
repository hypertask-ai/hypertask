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

  // Resolves a stored column key (built-in or 'customField:<id>') to its render
  // spec. Number-type custom fields right-align like "updated" does, so a
  // value doesn't visually run into whatever column sits to its right
  // (HTPR-3805: an appended, unaligned custom column read as glued to Updated).
  const toTableColumn = useCallback(
    (key: string): TableColumn | undefined => {
      if (key === "time" && !_currentProject?.showTimeTotals) return undefined;
      if (isCustomFieldColumnKey(key)) {
        if (myTasksColumnsControlled) return undefined;
        const field = customFieldById.get(customFieldIdFromColumnKey(key));
        if (!field) return undefined; // stored id for a field that's since been deleted
        if (field.showInTable === false) return undefined; // hidden board-wide via manage-custom-fields
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
  // Custom fields, unlike the fixed built-in columns, are created at runtime and
  // need seeding into the stored order once (like DEFAULT_TABLE_COLUMNS seeds the
  // built-ins) so they show up by default. After that one seed, a field's
  // presence/absence is the user's own toggle choice via TableColumnsPicker,
  // same as any built-in column.
  useEffect(() => {
    if (myTasksColumnsControlled || !customFields.length) return;
    // Fields hidden board-wide (showInTable: false) never get seeded as a
    // visible column — same rule toTableColumn enforces at render time.
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
    // Board table: while sorted, force 'status' visible so the sorted-by
    // column stays on screen. My Tasks controlled picker must win (HTPR-6456).
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
  // A drag-resized column (feature 3) overrides its default base width; that
  // override becomes the column's minimum, same as the unresized default did.
  const getColumnWidth = useCallback(
    (column: TableColumn) => columnWidths[column.key] ?? baseColumnWidthPx(column.width),
    [columnWidths]
  );
  // HTPR-4643: Excel frozen panes. Ticket and Title keep the row's identity on
  // screen while the data columns slide underneath, so a wide table never
  // scrolls away the one thing that says which row you are reading.
  //
  // Offsets are computed, not hardcoded: Ticket sits flush left, Title starts
  // after Ticket's CURRENT width plus the grid's 8px gutter, so a resized
  // Ticket column moves Title with it.
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
  // Excel model (HTPR-4993): called at the start of every resize drag. If title
  // still has no stored override (still auto-flexing), measure its real rendered
  // width and freeze it via setColumnWidth — after this every track is fixed px,
  // so the column actually being dragged moves 1:1 with the pointer instead of
  // title silently absorbing the delta. No-op (returns undefined) once frozen.
  const freezeTitleWidth = useCallback((): number | undefined => {
    if (columnWidths.title !== undefined) return undefined;
    const measured = titleHeaderRef.current?.getBoundingClientRect().width;
    if (!measured) return undefined;
    setColumnWidth("title", measured);
    return measured;
  }, [columnWidths.title, setColumnWidth]);
  // Excel model (HTPR-4993): title flexes to fill leftover width (minmax(...,1fr))
  // ONLY until it has a stored width override — the first resize anywhere freezes
  // it (see ColumnResizeHandle's onPointerDown), after which it's a fixed track
  // like every other column and the whole table's width becomes the sum of its
  // columns (horizontal scroll takes over via tableMinWidth below).
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
  // The grid tracks are fixed/min px, so the rows only paint as wide as their
  // box. Without a min-width matching the columns, the section cards stop at
  // the viewport edge and everything scrolled past it is blank. gap 8px per
  // gutter + 40px row padding.
  const tableMinWidth = useMemo(() => {
    const columnsWidth =
      visibleColumns.reduce((total, column) => total + getColumnWidth(column), 0) +
      Math.max(visibleColumns.length - 1, 0) * 8 +
      40;
    return enableMyTasksBulkSelection ? columnsWidth + 24 + 8 : columnsWidth;
  }, [visibleColumns, getColumnWidth, enableMyTasksBulkSelection]);
  // Reorders storedVisibleColumns in place when a header cell is dropped on
  // another (feature 2) — the SAME atom the "Configure table columns" picker
  // reads/writes, so drag-reordering the header and the picker stay in sync.
  // Locked columns (ticket/title) can't move; normalizeTableVisibleColumns
  // would just snap them back to the front anyway.
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
  // The 'status' column can appear in visibleColumns while sorted without being
  // in storedVisibleColumns (forced-visible injection above) — only columns
  // actually in the stored order are valid drag sources/targets.
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
