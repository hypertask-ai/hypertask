import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { ITask } from "@/models/model";
import { useShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import { activeItemAtom, showCommandsAtom, tasksPlayListAtom, tableVisibleColumnsAtom, tableColumnWidthsAtom, tableTimeColumnSeededBoardsAtom, normalizeTableVisibleColumns, normalizeMyTasksTableVisibleColumns } from "@/store";
import { returnSortedItems } from "@/utils/helperFunctions/helperFunctions";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { useBoardRunningTimers, useTimerNow } from "@/hooks/Task Detail/useTimeTracking";
import toast from "react-hot-toast";
import axios from "axios";
import useMoveTaskToSection from "@/hooks/MultiPages/useMoveTaskToSection";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useRouter } from "next/navigation";
import { type TableRowDragData } from "./tableRowDrag";
import { tableSectionKey, tableSectionNumber } from "./tableCreateTask";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6427_ROW_SHORTCUTS_FLAG, MY_TASKS_SNOOZE_FLAG, MY_TASKS_TABLE_COLUMNS_FLAG } from "@/lib/flags/keys";
import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import { useTaskProjectFallback } from "@/lib/keyboard/taskProjectFallback";
import { useMyTasksBulkSelectionOptional } from "@/lib/contexts/MyTasks/BulkSelectionContext";
import type { TableViewProps } from "./tableViewShared";
import { CustomField, SortState, resolveMyTasksSortState, resolveSortState, SortColumn, customFieldSortColumn } from "./tableViewShared";

type Context = Pick<TableViewProps, "myTasksSnoozeActive" | "_currentProject" | "myTasksVisibleColumns" | "onMyTasksVisibleColumnsChange" | "currentUser" | "myTasksSort" | "myTasksSortKey" | "filteredSections" | "_sections">;

export function useTableState(context: Context) {
  const {
  myTasksSnoozeActive, _currentProject, myTasksVisibleColumns, onMyTasksVisibleColumnsChange, currentUser,
  myTasksSort, myTasksSortKey, filteredSections, _sections,
  } = context;

  const queryClient = useQueryClient();
  const rowShortcutsEnabled = useFlag(HTPR_6427_ROW_SHORTCUTS_FLAG);
  const myTasksSnoozeFlag = useFlag(MY_TASKS_SNOOZE_FLAG); // HTPR-6461: H opens Remind Me
  const myTasksSnoozeEnabled = myTasksSnoozeFlag && Boolean(myTasksSnoozeActive);
  const myTasksTableColumnsFlag = useFlag(MY_TASKS_TABLE_COLUMNS_FLAG);
  const router = useRouter();
  const { navigateToTask } = useHypertasksNavigate();
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { updateActiveItemAndItemInView } = useProjectQuery();
  const { removeFromListWithStatus, updateTaskInCache } = UpdateKanban();
  const { starTask } = useStarAndPin();
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const persistedActiveItem = useRecoilValue(activeItemAtom);
  const myTasksBulk = useMyTasksBulkSelectionOptional();
  const showArchivedOnBoard = useShowArchivedOnBoard(_currentProject);
  const isApple = useDeviceContext();
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const myTasksColumnsControlled =
    myTasksTableColumnsFlag && myTasksVisibleColumns !== undefined;
  const [atomVisibleColumns, setAtomVisibleColumns] = useRecoilState(tableVisibleColumnsAtom);
  const storedVisibleColumns = myTasksColumnsControlled
    ? myTasksVisibleColumns
    : atomVisibleColumns;
  const normalizeVisibleColumns = myTasksColumnsControlled
    ? normalizeMyTasksTableVisibleColumns
    : normalizeTableVisibleColumns;
  const setStoredVisibleColumns = useCallback(
    (next: string[] | ((current: string[]) => string[])) => {
      if (myTasksColumnsControlled) {
        if (!onMyTasksVisibleColumnsChange) return;
        const current = normalizeMyTasksTableVisibleColumns(myTasksVisibleColumns);
        onMyTasksVisibleColumnsChange(typeof next === "function" ? next(current) : next);
        return;
      }
      setAtomVisibleColumns(next);
    },
    [
      myTasksColumnsControlled,
      myTasksVisibleColumns,
      onMyTasksVisibleColumnsChange,
      setAtomVisibleColumns,
    ],
  );
  const [timeColumnSeededBoards, setTimeColumnSeededBoards] = useRecoilState(
    tableTimeColumnSeededBoardsAtom,
  );
  const [columnWidths, setColumnWidths] = useRecoilState(tableColumnWidthsAtom);
  const { timeTotals } = useBoardRunningTimers(_currentProject?.id ?? null);
  const hasActiveBoardTimer = useMemo(
    () =>
      [...timeTotals.values()].some((total) =>
        total.runningTimers.some((timer) => timer.pausedAt === null),
      ),
    [timeTotals],
  );
  const timeNow = useTimerNow(
    Boolean(_currentProject?.showTimeTotals && hasActiveBoardTimer),
  );
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const draggedTaskRef = useRef<TableRowDragData | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<number | null>(null);
  const { mutate: moveTaskToSection } = useMoveTaskToSection();
  // Reorder drop indicator (HTPR-4993): which column the dragged header is
  // currently hovering, and which edge of it the dragged column would land on.
  const [dragOverColumn, setDragOverColumn] = useState<{ column: string; side: "left" | "right" } | null>(null);
  // Full-height resize guide (HTPR-4991): which column is being dragged and the
  // live pointer x, relative to tableWrapperRef, so the overlay line below can
  // track it for the whole table height instead of just the header cell.
  const [resizeGuide, setResizeGuide] = useState<{ column: string; left: number } | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  // Excel model (HTPR-4993): title's header cell, so any resize drag (title's own
  // or another column's) can measure title's current rendered width to freeze it.
  const titleHeaderRef = useRef<HTMLDivElement>(null);
  const { data: customFields = [] } = useQuery<CustomField[]>({
    queryKey: ["customFields", _currentProject?.id],
    enabled: Boolean(_currentProject?.id),
    queryFn: async () => (await axios.get(`/api/customFields?projectId=${_currentProject!.id}`)).data,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [assignTask, setAssignTask] = useState<ITask | null>(null);
  const {
    project: assignProject,
    isLoading: assignProjectLoading,
    isError: assignProjectError,
  } = useTaskProjectFallback(
    _currentProject,
    assignTask?.projectId,
    currentUser?.id,
    rowShortcutsEnabled && Boolean(assignTask),
  );
  // If My Tasks cannot load the row's board, drop the pending assign target
  // so other shortcuts are not blocked with no modal on screen (OCR).
  useEffect(() => {
    if (!assignTask || assignProjectLoading) return;
    if (assignProjectError || !assignProject?.name) {
      setAssignTask(null);
      toast.error("Unable to open assign for this task's board");
    }
  }, [assignProject?.name, assignProjectError, assignProjectLoading, assignTask]);
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  // My Tasks has no board cache to mutate, so Ctrl+E hides the row locally
  // until router.refresh() returns the server list without it (HTPR-6445).
  const [excludedTaskIds, setExcludedTaskIds] = useState<Set<number>>(() => new Set());
  const [sortState, setSortState] = useState<SortState>(() =>
    myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject),
  );
  const { setTableSortViewAndReturn, changeBoardLayout } = useKanbanViews(_currentProject);
  const didRestore = useRef(false);
  const timerToggling = useRef(false);
  const lastGAt = useRef<number | null>(null);
  // View switch (or unsaved-view create/delete) changes which saved sort applies;
  // re-derive local state from the new active view rather than keeping the old one.
  const activeSortViewId =
    _currentProject?.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    _currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id ??
    _currentProject?.project_view?.default_view?.id;
  useEffect(() => {
    setSortState(
      myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeSortViewId,
    myTasksSort?.direction,
    myTasksSort?.field,
    myTasksSortKey,
    _currentProject?.showTimeTotals,
  ]);
  const sections = useMemo(() => {
    // An active filter may intentionally produce zero visible sections. Only
    // fall back when no filtered value was supplied, not when it is empty.
    const base = filteredSections ?? _sections ?? [];
    const withoutExcluded =
      excludedTaskIds.size === 0
        ? base
        : base.map((section) => ({
            ...section,
            items: (section.items || []).filter((task) => !excludedTaskIds.has(task.id)),
          }));
    if (!_currentProject) return withoutExcluded;
    // Reuse the same empty-sections setting the kanban board applies (useHandleKeyDownOperations),
    // recomputed here so a live toggle of the setting reflects immediately, not just after refetch.
    const emptyFiltered = getFilteredEmptySections(withoutExcluded, _currentProject);
    return emptyFiltered.map((section) => ({
      ...section,
      // returnSortedItems sorts in place; copy so frozen Recoil/React state isn't mutated
      items: returnSortedItems([...(section.items || [])], _currentProject),
    }));
  }, [filteredSections, _sections, _currentProject, excludedTaskIds]);

  // Drop optimistic exclusions once the server list no longer contains them
  // (refresh confirmed the archive). Keeps a later unarchive+refresh visible.
  useEffect(() => {
    if (excludedTaskIds.size === 0) return;
    const presentIds = new Set(
      (filteredSections ?? _sections ?? []).flatMap((section) =>
        (section.items || []).map((task) => task.id),
      ),
    );
    setExcludedTaskIds((previous) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of previous) {
        if (presentIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [excludedTaskIds, filteredSections, _sections]);
  // Drag is only ever allowed between real sections of a real board. The
  // _currentProject gate is what keeps /my-tasks out: it renders this table
  // with _currentProject={null} and groups by boardId, so a "section" there is
  // a board and moving into it would target the wrong thing. The ids come from
  // the rendered sections rather than _currentProject.sections so the feature
  // does not depend on that relation being hydrated on the atom.
  const currentProjectSectionIds = useMemo(
    () =>
      new Set(
        _currentProject
          ? sections.flatMap((section) => {
              const sectionId = tableSectionNumber(section);
              return typeof sectionId === "number" ? [sectionId] : [];
            })
          : []
      ),
    [_currentProject, sections]
  );
  // Section title lookup + board-position order for the 'status' column
  const sectionTitleBySid = useMemo(
    () => new Map(sections.map((section) => [tableSectionKey(section) as string | number, section.section_title])),
    [sections]
  );
  const sectionOrderBySid = useMemo(
    () => new Map(sections.map((section, index) => [tableSectionKey(section) as string | number, index])),
    [sections]
  );
  const customFieldBySortColumn = useMemo(
    () => new Map<SortColumn, CustomField>(customFields.map((field) => [customFieldSortColumn(field.id), field])),
    [customFields]
  );
  // A handful of callbacks below read this without listing it as a dependency
  // (it's cheap to recompute and rarely changes, so keeping it out of their
  // deps arrays avoids reflowing those hooks' existing dependency lists).
  const customFieldBySortColumnRef = useRef(customFieldBySortColumn);
  customFieldBySortColumnRef.current = customFieldBySortColumn;
  const customFieldById = useMemo(() => new Map(customFields.map((field) => [field.id, field])), [customFields]);
  return {
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
  };
}
