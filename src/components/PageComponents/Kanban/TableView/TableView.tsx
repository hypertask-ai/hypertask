"use client";
import { TableViewProps, TABLE_GRID_CLASS, isTaskRow, SECTION_CAP } from "./tableViewShared";
export { renderAssigneeAvatars } from "./tableViewShared";

import { useTableState } from "./useTableState";
import { useTableColumns } from "./useTableColumns";
import { useTableRows } from "./useTableRows";
import { useTableActions } from "./useTableActions";
import { useTableKeyboard } from "./useTableKeyboard";
import { createTableRowRenderer } from "./TableTaskRow";

import { lazy, Suspense, useCallback, useRef, type ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";






import { LOCKED_TABLE_COLUMNS } from "@/store";



import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";

































import { shouldFlattenSortedRows } from "./tableSortFlatten";
import { tableSectionKey, tableSectionNumber } from "./tableCreateTask";
import { getTableCreateTaskControlProps, TableCreateTaskControl } from "./TableCreateTaskControl";




import { splitAssignees } from "@/lib/assignees";

import { taskBaseUri } from "@/utils";
import SelectionCheckbox from "@/components/Common/selection-checkbox";



const HypertasksCommands = lazy(() => import("@/components/commands"));
const AssignModal = lazy(
  () => import("@/components/Modals/AssignToUser/AssignToUser"),
);

// Right-edge drag handle for a header cell (feature 3: Excel-style column resize).
// A thin pointer-event hit strip, sibling to the sort <button> (not a child of
// it), so a resize drag never touches the button's draggable/click handlers.
// Sheets/Notion pattern (HTPR-4991): faint separators appear across the header
// row on hover, the hovered/dragged handle itself goes full accent, and a
// full-height guide line (rendered by the parent, positioned via containerRef)
// tracks the pointer for the duration of the drag.
const ColumnResizeHandle = ({
  column,
  width,
  onBeforeResize,
  onResize,
  containerRef,
  isResizing,
  onDragStateChange,
}: {
  column: string;
  width: number;
  // Excel model (HTPR-4993): title starts on a minmax(base,1fr) track that flexes
  // to absorb all spare width, so ANY other column's resize delta gets silently
  // swallowed by title instead of moving the dragged edge. Called at the start of
  // every resize drag (not just title's own) to freeze title to a fixed px track
  // — its real rendered width — if it isn't already; a no-op once frozen. Returns
  // the freshly-measured width when it just froze (so this drag, if it's title's
  // own, can start from that instead of the stale unflexed `width` prop).
  onBeforeResize: () => number | undefined;
  onResize: (column: string, width: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isResizing: boolean;
  onDragStateChange: (left: number | null) => void;
}) => {
  const dragStart = useRef({ x: 0, width });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const justFrozeTitleWidth = onBeforeResize();
      const startWidth = column === "title" && justFrozeTitleWidth !== undefined ? justFrozeTitleWidth : width;
      dragStart.current = { x: event.clientX, width: startWidth };
      document.body.style.userSelect = "none";
      const updateGuide = (clientX: number) => {
        const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0;
        onDragStateChange(clientX - containerLeft);
      };
      updateGuide(event.clientX);
      const onMove = (moveEvent: PointerEvent) => {
        onResize(column, dragStart.current.width + (moveEvent.clientX - dragStart.current.x));
        updateGuide(moveEvent.clientX);
      };
      const onUp = () => {
        document.body.style.userSelect = "";
        onDragStateChange(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [column, width, onBeforeResize, onResize, containerRef, onDragStateChange]
  );

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      draggable={false}
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
      className="group/resize absolute -right-1.5 top-0 bottom-0 z-10 w-3 cursor-col-resize"
    >
      <span
        className={`mx-auto block h-full transition-colors ${
          isResizing
            ? "w-0.5 bg-hypertasks-purple"
            // bg-white-black, not bg-border-labelComponent: that token is defined under
            // borderColor only, so `bg-` never emitted a background and the separator was
            // invisible at every opacity (HTPR-5050).
            : "w-px bg-white-black opacity-20 group-hover/header:opacity-40 group-hover/resize:opacity-0"
        }`}
      />
      {/* Excel's grip (HTPR-5050): the resting separator says "there is an edge here",
          this double ridge under the pointer says "and you can drag it". */}
      {!isResizing && (
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-[2px] group-hover/resize:flex">
          <span className="block h-3.5 w-[1.5px] rounded-full bg-white-black" />
          <span className="block h-3.5 w-[1.5px] rounded-full bg-white-black" />
        </span>
      )}
    </span>
  );
};

const TableView = ({
  filteredSections,
  _sections,
  _currentProject,
  currentUser,
  handleBoardChange,
  myTasksSort,
  myTasksSortKey,
  myTasksSnoozeActive = false,
  onMyTasksSortChange,
  myTasksVisibleColumns,
  onMyTasksVisibleColumnsChange,
  enableMyTasksBulkSelection = false,
}: TableViewProps) => {
  const {
  queryClient, rowShortcutsEnabled, myTasksSnoozeEnabled, router, navigateToTask,
  toggleCreateTaskGlobally, updateActiveItemAndItemInView, removeFromListWithStatus, updateTaskInCache, starTask,
  showCommands, setShowCommands, persistedActiveItem, myTasksBulk, showArchivedOnBoard,
  isApple, setTasksPlayList, myTasksColumnsControlled, storedVisibleColumns, normalizeVisibleColumns,
  setStoredVisibleColumns, timeColumnSeededBoards, setTimeColumnSeededBoards, columnWidths, setColumnWidths,
  timeTotals, timeNow, draggedColumn, setDraggedColumn, draggedTaskRef,
  dragOverSectionId, setDragOverSectionId, moveTaskToSection, dragOverColumn, setDragOverColumn,
  resizeGuide, setResizeGuide, tableWrapperRef, titleHeaderRef, customFields,
  selectedIndex, setSelectedIndex, assignTask, setAssignTask, assignProject,
  expanded, setExpanded, setExcludedTaskIds, sortState, setSortState,
  setTableSortViewAndReturn, changeBoardLayout, didRestore, timerToggling, lastGAt,
  sections, currentProjectSectionIds, sectionTitleBySid, sectionOrderBySid, customFieldBySortColumn,
  customFieldBySortColumnRef, customFieldById,
  } = useTableState({
    myTasksSnoozeActive, _currentProject, myTasksVisibleColumns, onMyTasksVisibleColumnsChange, currentUser,
    myTasksSort, myTasksSortKey, filteredSections, _sections,
  });
  const {
  visibleColumns, getColumnWidth, frozenColumnOffset, setColumnWidth, freezeTitleWidth,
  gridTemplateColumns, tableMinWidth, reorderColumn, normalizedColumnOrder, storedColumnKeys,
  } = useTableColumns({
    _currentProject, myTasksColumnsControlled, customFieldById, customFields, setStoredVisibleColumns,
    timeColumnSeededBoards, setTimeColumnSeededBoards, normalizeVisibleColumns, storedVisibleColumns, sortState,
    columnWidths, setColumnWidths, titleHeaderRef, enableMyTasksBulkSelection,
  });
  const {
  crossBoardPrioritySortEnabled, isPrioritySort, savedViewPrioritySort, rows, buildCommandContext,
  focusRowElement, focusTo, expandSection,
  } = useTableRows({
    sortState, myTasksSort, _currentProject, customFieldBySortColumnRef, sectionOrderBySid,
    timeTotals, timeNow, sections, expanded, enableMyTasksBulkSelection,
    myTasksBulk, setExcludedTaskIds, persistedActiveItem, showArchivedOnBoard, isApple,
    myTasksSnoozeEnabled, setSelectedIndex, updateActiveItemAndItemInView, setExpanded,
  });
  const {
  toggleSort, getTicketText, openTask, handleMouseEnter, handleMouseLeave,
  clearTaskDrag, handleSectionDragOver, handleSectionDrop, toggleSelectedTaskTimer, archiveTaskFromTable,
  closeAssignModal, runTaskShortcut,
  } = useTableActions({
    customFieldBySortColumn, sortState, myTasksSort, onMyTasksSortChange, setSortState,
    _currentProject, setTableSortViewAndReturn, setSelectedIndex, updateActiveItemAndItemInView, setTasksPlayList,
    rows, navigateToTask, focusRowElement, draggedTaskRef, setDragOverSectionId,
    currentProjectSectionIds, moveTaskToSection, timerToggling, queryClient, removeFromListWithStatus,
    setExcludedTaskIds, router, updateTaskInCache, starTask, currentUser,
    assignTask, setAssignTask, myTasksSnoozeEnabled, lastGAt, setShowCommands,
    rowShortcutsEnabled, isApple, didRestore, persistedActiveItem, focusTo,
    selectedIndex,
  });
  const {
  quickEntryEnabled, quickCreateTask,
  } = useTableKeyboard({
    _currentProject, rows, selectedIndex, sections, toggleCreateTaskGlobally,
    setShowCommands, isApple, handleBoardChange, _sections, lastGAt,
    rowShortcutsEnabled, showCommands, assignTask, runTaskShortcut, enableMyTasksBulkSelection,
    myTasksBulk, archiveTaskFromTable, timerToggling, toggleSelectedTaskTimer, changeBoardLayout,
    focusTo, openTask, expandSection,
  });
  const {
  renderTaskRow,
  } = createTableRowRenderer({
    selectedIndex, dragOverSectionId, currentProjectSectionIds, sortState, openTask,
    customFieldBySortColumn, frozenColumnOffset, getTicketText, _currentProject, sectionTitleBySid,
    timeTotals, timeNow, draggedTaskRef, clearTaskDrag, handleMouseEnter,
    handleMouseLeave, gridTemplateColumns, enableMyTasksBulkSelection, myTasksBulk, visibleColumns,
  });

  const selectedAssignees = splitAssignees(assignTask?.assignees);
  let cursor = -1;
  let bulkSelectAllHeader: ReactNode = null;
  if (enableMyTasksBulkSelection && myTasksBulk) {
    if (myTasksBulk.selectedCount > 0) {
      bulkSelectAllHeader = (
        <SelectionCheckbox
          id="my-tasks-select-all"
          isChecked={myTasksBulk.isAllSelected}
          alwaysVisible
          borderColorClass="!border-text-light-gray"
          checkmarkColorClass="text-white-black"
          onClick={() => myTasksBulk.selectAllVisible()}
        />
      );
    } else {
      bulkSelectAllHeader = (
        <span aria-hidden className="block h-[15px] w-[15px]" />
      );
    }
  }

  return (
    // h-full fills the flex-sized board column (rail shell), so the horizontal
    // scrollbar sits at the bottom of the viewport instead of under the last row.
    <div
      data-task-shortcuts={rowShortcutsEnabled ? "enabled" : undefined}
      className="w-full h-full min-h-0 bg-taskDetailPage overflow-x-auto overflow-y-auto table-hscroll"
      style={{ maxHeight: "calc(100vh - 64px)" }}
    >
      <div className="w-full px-4 pb-6 pt-3">
        <TableCreateTaskControl
          {...getTableCreateTaskControlProps({
            currentProject: _currentProject,
            rows,
            selectedIndex,
            sections,
            toggleCreateTaskGlobally,
            quickEntryEnabled,
            quickCreateTask,
          })}
        />
        <div ref={tableWrapperRef} style={{ minWidth: tableMinWidth }} className="relative">
          {resizeGuide && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-hypertasks-purple"
              style={{ left: resizeGuide.left }}
            />
          )}
          <div style={{ gridTemplateColumns }} className={`${TABLE_GRID_CLASS} table-view-header group/header sticky top-0 z-10 items-center gap-2 bg-taskDetailPage px-[20px] md:px-5 py-2 text-micro font-semibold uppercase text-text-light-gray`}>
            {bulkSelectAllHeader}
            {visibleColumns.map((column) => {
              const sortIndex = sortState.findIndex((level) => level.column === column.key);
              const activeSort = sortState[sortIndex];
              const isActive = sortIndex >= 0;
              // Ticket/title stay put (see LOCKED_TABLE_COLUMNS); the synthetic
              // 'status' column injected while sorted also isn't draggable —
              // it isn't in storedVisibleColumns to reorder.
              const isDraggableColumn = storedColumnKeys.has(column.key) && !LOCKED_TABLE_COLUMNS.has(column.key);
              return (
                <div
                  key={column.key}
                  ref={column.key === "title" ? titleHeaderRef : undefined}
                  // The header row stays vertically sticky everywhere. Only desktop
                  // freezes the ticket and title headings horizontally.
                  style={
                    frozenColumnOffset(column.key) === undefined
                      ? undefined
                      : { left: frozenColumnOffset(column.key) }
                  }
                  className={`relative min-w-0 ${
                    frozenColumnOffset(column.key) === undefined ? "" : "md:sticky md:z-20 md:bg-taskDetailPage"
                  }`}
                >
                  {dragOverColumn?.column === column.key && (
                    <div
                      className={`pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-hypertasks-purple ${
                        dragOverColumn.side === "left" ? "left-0" : "right-0"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    draggable={isDraggableColumn}
                    onClick={(event) => toggleSort(column.key, event.shiftKey)}
                    onDragStart={(event) => {
                      setDraggedColumn(column.key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", column.key);
                    }}
                    onDragOver={(event) => {
                      if (!isDraggableColumn || !draggedColumn || draggedColumn === column.key) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      // Insertion line lands on the side the dragged column would land: dragged
                      // currently to the right of this column (moving right-to-left) -> left edge,
                      // otherwise (moving left-to-right) -> right edge.
                      const draggedIndex = normalizedColumnOrder.indexOf(draggedColumn);
                      const targetIndex = normalizedColumnOrder.indexOf(column.key);
                      const side = draggedIndex > targetIndex ? "left" : "right";
                      setDragOverColumn((current) =>
                        current?.column === column.key && current.side === side ? current : { column: column.key, side }
                      );
                    }}
                    onDragLeave={() => setDragOverColumn((current) => (current?.column === column.key ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumn) reorderColumn(draggedColumn, column.key);
                      setDraggedColumn(null);
                      setDragOverColumn(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColumn(null);
                      setDragOverColumn(null);
                    }}
                    // The resize handle is centered on the cell edge with half of
                    // its 12px hit area inside the cell. Keep label text clear of it.
                    className={`block w-full min-w-0 pr-3 uppercase ${column.className || "text-left"} ${isActive ? "text-white-black" : "text-text-light-gray"} ${
                      isDraggableColumn ? "cursor-grab active:cursor-grabbing" : ""
                    } ${draggedColumn === column.key ? "opacity-50" : ""}`}
                  >
                    <span className={`inline-flex min-w-0 items-center ${column.className === "text-right" ? "justify-end w-full" : ""}`}>
                      <span className="truncate">{column.label}</span>
                      {isActive && <span className="ml-1 text-micro">{activeSort.direction === "asc" ? "▲" : "▼"}</span>}
                      {sortIndex > 0 && <span className="ml-0.5 align-super text-[9px] text-[#C2CFA5]">{sortIndex + 1}</span>}
                    </span>
                  </button>
                  <ColumnResizeHandle
                    column={column.key}
                    width={getColumnWidth(column)}
                    onBeforeResize={freezeTitleWidth}
                    onResize={setColumnWidth}
                    containerRef={tableWrapperRef}
                    isResizing={resizeGuide?.column === column.key}
                    onDragStateChange={(left) => setResizeGuide(left === null ? null : { column: column.key, left })}
                  />
                </div>
              );
            })}
          </div>
          {(shouldFlattenSortedRows(
            Boolean(_currentProject),
            sortState.length > 0,
            isPrioritySort,
            crossBoardPrioritySortEnabled
          ) || savedViewPrioritySort) ? (
            <div className="bg-containerBackground shadow-md rounded-md py-2">
              <ul className="px-0">
                {rows.filter(isTaskRow).map(({ task }, index) => renderTaskRow(task, index))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-[16px]">
              {sections.map((section, sectionIndex) => {
                const sid = tableSectionKey(section) ?? `i${sectionIndex}`;
                const rawItems = section.items || [];
                // On /my-tasks a sort must reorder within each board's group rather than
                // flattening it, so pull the already-sorted rows for this sid instead of
                // recomputing from the unsorted section.items (HTPR-4887).
                const sectionRows = sortState.length > 0 ? rows.filter((row) => row.sid === sid) : null;
                const shown = sectionRows
                  ? sectionRows.filter(isTaskRow).map((row) => row.task)
                  : expanded.has(sid) ? rawItems : rawItems.slice(0, SECTION_CAP);
                const hidden = sectionRows
                  ? sectionRows.find((row) => row.type === "more")?.hidden ?? 0
                  : rawItems.length - shown.length;
                const destinationSectionId = tableSectionNumber(section) ?? null;
                return (
                  <div
                    key={sid}
                    onDragOver={(event) => {
                      if (destinationSectionId !== null) handleSectionDragOver(event, destinationSectionId);
                    }}
                    onDragLeave={(event) => {
                      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                      setDragOverSectionId((current) => current === destinationSectionId ? null : current);
                    }}
                    onDrop={(event) => {
                      if (destinationSectionId !== null) {
                        handleSectionDrop(event, destinationSectionId, section.section_title);
                      }
                    }}
                    className={`${destinationSectionId !== null && dragOverSectionId === destinationSectionId ? "bg-hover-active" : "bg-containerBackground"} shadow-md rounded-md py-2`}
                  >
                    <div className="px-[10px] pt-1">
                      <SplitTitle isSelected={true} onClick={() => {}} tab={{ idx: sectionIndex, project: section.section_title, length: rawItems.length, hasUnseen: false }} />
                    </div>
                    <ul className="px-0">
                      {shown.map((task) => {
                        cursor += 1;
                        const flatIndex = cursor;
                        return renderTaskRow(task, flatIndex);
                      })}
                      {hidden > 0 && (() => {
                        cursor += 1;
                        const flatIndex = cursor;
                        return (
                          <li
                            id={`table-more-${sid}`}
                            key={`table-more-${sid}`}
                            onClick={() => { setSelectedIndex(flatIndex); expandSection(sid); }}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            className={`cursor-pointer py-[8px] px-[20px] md:px-5 rounded-md md:border-l-4 text-text-light-gray text-dense ${selectedIndex===flatIndex ? "md:bg-active-elementBg md:border-l-selected-item-border" : "md:border-l-transparent"}`}
                          >
                            Show {hidden} more
                          </li>
                        );
                      })()}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {showCommands.show && (
        <Suspense fallback={null}>
          <HypertasksCommands contextOptions={buildCommandContext()} />
        </Suspense>
      )}
      {rowShortcutsEnabled && assignTask && assignProject?.name && (
        <Suspense fallback={null}>
          <AssignModal
            onClose={closeAssignModal}
            project={assignProject}
            task={{
              id: assignTask.id,
              title: assignTask.title ?? "",
              link: `${taskBaseUri}${assignProject.name}/${assignTask.uniqueIndex}`,
            }}
            assignees={[
              ...selectedAssignees.humanAssignees,
              ...selectedAssignees.agentAssignees,
            ]}
          />
        </Suspense>
      )}
    </div>
  );
};

export default TableView;
