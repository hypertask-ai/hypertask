import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { ITask } from "@/models/model";
import { useShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import { activeItemAtom, showCommandsAtom, tasksPlayListAtom, tableVisibleColumnsAtom, tableColumnWidthsAtom, tableTimeColumnSeededBoardsAtom, tableSortAccountAtom, tableColumnsAccountAtom, normalizeTableVisibleColumns, normalizeMyTasksTableVisibleColumns } from "@/store";
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
import { HTPR_8972_TABLE_GROUP_FOLD_FLAG } from "@/lib/flags/definitions/htpr-8972-table-group-fold";
import { HTPR_8973_TABLE_SORT_COLUMNS_FLAG } from "@/lib/flags/definitions/htpr-8973-table-sort-columns";
import { getActiveTableColumnsFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG } from "@/lib/flags/keys";
import {
  buildTableSectionsForGrouping,
  effectiveTableGrouping,
  getActiveTableCollapsedSectionsFromProject,
} from "@/lib/table-view/tableGroupByTag";
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

  const showEmptyViewColumns = useFlag(HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG);
  const tableGroupFoldEnabled = useFlag(HTPR_8972_TABLE_GROUP_FOLD_FLAG);
  const tableSortColumnsEnabled = useFlag(HTPR_8973_TABLE_SORT_COLUMNS_FLAG);
  const tableViewId =
    _currentProject?.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    _currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id ??
    _currentProject?.project_view?.default_view?.id;
  const tableGroupModesEnabled = useFlag("htpr-8974-table-group-modes");
  const legacyTableGroupEnabled = useFlag("htpr-8630-table-group-by-tag");
  const queryClient = useQueryClient();
  const myTasksSnoozeEnabled = Boolean(myTasksSnoozeActive);
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
  const myTasksColumnsControlled = myTasksVisibleColumns !== undefined;
  const [atomVisibleColumns, setAtomVisibleColumns] = useRecoilState(tableVisibleColumnsAtom);
  const [accountColumns, setAccountColumns] = useRecoilState(tableColumnsAccountAtom);
  const sortAccount = useRecoilValue(tableSortAccountAtom);
  const savedTableColumns = tableSortColumnsEnabled && !myTasksColumnsControlled
    ? getActiveTableColumnsFromProject(_currentProject)
    : null;
  const accountForView = tableSortColumnsEnabled && accountColumns?.viewId === tableViewId
    ? accountColumns
    : null;
  const defaultVisibleColumns = normalizeTableVisibleColumns(undefined);
  const savedOrDefaultKeys = savedTableColumns?.keys ?? (
    _currentProject?.showTimeTotals && !defaultVisibleColumns.includes("time")
      ? [...defaultVisibleColumns, "time"]
      : defaultVisibleColumns
  );
  const storedVisibleColumns = myTasksColumnsControlled
    ? myTasksVisibleColumns
    : accountForView
      ? accountForView.keys
      : tableSortColumnsEnabled
        ? savedOrDefaultKeys
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
      if (tableSortColumnsEnabled && tableViewId) {
        const current = accountForView?.keys ?? savedOrDefaultKeys;
        const keys = typeof next === "function" ? next(current) : next;
        if (keys === current || (keys.length === current.length && keys.every((key, index) => key === current[index]))) return;
        setAccountColumns({
          viewId: tableViewId,
          keys,
          widths: accountForView?.widths ?? savedTableColumns?.widths ?? {},
        });
        return;
      }
      setAtomVisibleColumns(next);
    },
    [
      accountForView?.keys,
      accountForView?.widths,
      myTasksColumnsControlled,
      myTasksVisibleColumns,
      onMyTasksVisibleColumnsChange,
      savedOrDefaultKeys,
      savedTableColumns?.widths,
      setAccountColumns,
      setAtomVisibleColumns,
      tableSortColumnsEnabled,
      tableViewId,
    ],
  );
  const [timeColumnSeededBoards, setTimeColumnSeededBoards] = useRecoilState(
    tableTimeColumnSeededBoardsAtom,
  );
  const [atomColumnWidths, setAtomColumnWidths] = useRecoilState(tableColumnWidthsAtom);
  const columnWidths = accountForView
    ? accountForView.widths
    : tableSortColumnsEnabled && !myTasksColumnsControlled
      ? (savedTableColumns?.widths ?? {})
      : atomColumnWidths;
  const setColumnWidths = useCallback(
    (next: Record<string, number> | ((current: Record<string, number>) => Record<string, number>)) => {
      if (tableSortColumnsEnabled && tableViewId && !myTasksColumnsControlled) {
        const current = accountForView?.widths ?? savedTableColumns?.widths ?? {};
        const widths = typeof next === "function" ? next(current) : next;
        setAccountColumns({
          viewId: tableViewId,
          keys: accountForView?.keys ?? savedOrDefaultKeys,
          widths,
        });
        return;
      }
      setAtomColumnWidths(next);
    },
    [
      accountForView?.keys,
      accountForView?.widths,
      myTasksColumnsControlled,
      savedOrDefaultKeys,
      savedTableColumns?.widths,
      setAccountColumns,
      setAtomColumnWidths,
      tableSortColumnsEnabled,
      tableViewId,
    ],
  );
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
  const [dragOverColumn, setDragOverColumn] = useState<{ column: string; side: "left" | "right" } | null>(null);
  const [resizeGuide, setResizeGuide] = useState<{ column: string; left: number } | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
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
    Boolean(assignTask),
  );
  useEffect(() => {
    if (!assignTask || assignProjectLoading) return;
    if (assignProjectError || !assignProject?.name) {
      setAssignTask(null);
      toast.error("Unable to open assign for this task's board");
    }
  }, [assignProject?.name, assignProjectError, assignProjectLoading, assignTask]);
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    getActiveTableCollapsedSectionsFromProject(_currentProject),
  );
  const [excludedTaskIds, setExcludedTaskIds] = useState<Set<number>>(() => new Set());
  const [sortState, setSortState] = useState<SortState>(() =>
    myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject, tableSortColumnsEnabled),
  );
  const {
    setTableSortViewAndReturn,
    setTableCollapsedSectionsViewAndReturn,
    changeBoardLayout,
  } = useKanbanViews(_currentProject);
  const didRestore = useRef(false);
  const timerToggling = useRef(false);
  const lastGAt = useRef<number | null>(null);
  const activeSortViewId =
    _currentProject?.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    _currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id ??
    _currentProject?.project_view?.default_view?.id;
  useEffect(() => {
    if (tableSortColumnsEnabled) return;
    setSortState(
      myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject, false),
    );
  }, [
    activeSortViewId,
    myTasksSort?.direction,
    myTasksSort?.field,
    myTasksSortKey,
    _currentProject?.showTimeTotals,
    tableSortColumnsEnabled,
  ]);
  useEffect(() => {
    if (!tableSortColumnsEnabled) return;
    if (sortAccount?.viewId === activeSortViewId && sortAccount.sort) {
      setSortState(sortAccount.sort as SortState);
      return;
    }
    setSortState(
      myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject, true),
    );
  }, [
    activeSortViewId,
    myTasksSort?.direction,
    myTasksSort?.field,
    myTasksSortKey,
    sortAccount,
    tableSortColumnsEnabled,
    _currentProject,
  ]);
  useEffect(() => {
    setCollapsedSections(getActiveTableCollapsedSectionsFromProject(_currentProject));
  }, [activeSortViewId, _currentProject?.id]);
  const toggleCollapsedSection = useCallback(
    (sid: string | number) => {
      const key = String(sid);
      setCollapsedSections((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (_currentProject && tableGroupFoldEnabled) {
          void setTableCollapsedSectionsViewAndReturn(_currentProject, next);
        }
        return next;
      });
    },
    [_currentProject, setTableCollapsedSectionsViewAndReturn, tableGroupFoldEnabled],
  );
  const sortedSections = useMemo(() => {
    const base = filteredSections ?? _sections ?? [];
    const withoutExcluded =
      excludedTaskIds.size === 0
        ? base
        : base.map((section) => ({
            ...section,
            items: (section.items || []).filter((task) => !excludedTaskIds.has(task.id)),
          }));
    if (!_currentProject) return withoutExcluded;
    return withoutExcluded.map((section) => ({
      ...section,
      items: returnSortedItems([...(section.items || [])], _currentProject),
    }));
  }, [filteredSections, _sections, _currentProject, excludedTaskIds]);
  let sections = sortedSections;
  if (showEmptyViewColumns) {
    if (_currentProject) sections = getFilteredEmptySections(sortedSections, _currentProject, true);
  } else if (_currentProject) {
    sections = getFilteredEmptySections(sortedSections, _currentProject);
  }
  if (_currentProject && (tableGroupModesEnabled || legacyTableGroupEnabled)) {
    const grouping = effectiveTableGrouping(_currentProject, tableGroupModesEnabled, legacyTableGroupEnabled);
    if (grouping.mode !== "column") sections = buildTableSectionsForGrouping(sections, grouping) as typeof sections;
  }

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
  const customFieldBySortColumnRef = useRef(customFieldBySortColumn);
  customFieldBySortColumnRef.current = customFieldBySortColumn;
  const customFieldById = useMemo(() => new Map(customFields.map((field) => [field.id, field])), [customFields]);
  return {
  queryClient, myTasksSnoozeEnabled, router, navigateToTask,
  toggleCreateTaskGlobally, updateActiveItemAndItemInView, removeFromListWithStatus, updateTaskInCache, starTask,
  showCommands, setShowCommands, persistedActiveItem, myTasksBulk, showArchivedOnBoard,
  isApple, setTasksPlayList, myTasksColumnsControlled, storedVisibleColumns, normalizeVisibleColumns,
  setStoredVisibleColumns, timeColumnSeededBoards, setTimeColumnSeededBoards, columnWidths, setColumnWidths,
  timeTotals, timeNow, draggedColumn, setDraggedColumn, draggedTaskRef,
  dragOverSectionId, setDragOverSectionId, moveTaskToSection, dragOverColumn, setDragOverColumn,
  resizeGuide, setResizeGuide, tableWrapperRef, titleHeaderRef, customFields,
  selectedIndex, setSelectedIndex, assignTask, setAssignTask, assignProject,
  expanded, setExpanded, collapsedSections, toggleCollapsedSection, setExcludedTaskIds, sortState, setSortState,
  setTableSortViewAndReturn, changeBoardLayout, didRestore, timerToggling, lastGAt,
  sections, currentProjectSectionIds, sectionTitleBySid, sectionOrderBySid, customFieldBySortColumn,
  customFieldBySortColumnRef, customFieldById,
  };
}
