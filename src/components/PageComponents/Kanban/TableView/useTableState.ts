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
import { HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG, MY_TASKS_SNOOZE_FLAG, MY_TASKS_TABLE_COLUMNS_FLAG } from "@/lib/flags/keys";
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
  const queryClient = useQueryClient();
  const myTasksSnoozeFlag = useFlag(MY_TASKS_SNOOZE_FLAG);
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
  const [excludedTaskIds, setExcludedTaskIds] = useState<Set<number>>(() => new Set());
  const [sortState, setSortState] = useState<SortState>(() =>
    myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject),
  );
  const { setTableSortViewAndReturn, changeBoardLayout } = useKanbanViews(_currentProject);
  const didRestore = useRef(false);
  const timerToggling = useRef(false);
  const lastGAt = useRef<number | null>(null);
  const activeSortViewId =
    _currentProject?.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    _currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id ??
    _currentProject?.project_view?.default_view?.id;
  useEffect(() => {
    setSortState(
      myTasksSort ? resolveMyTasksSortState(myTasksSort) : resolveSortState(_currentProject),
    );

  }, [
    activeSortViewId,
    myTasksSort?.direction,
    myTasksSort?.field,
    myTasksSortKey,
    _currentProject?.showTimeTotals,
  ]);
  const sections = useMemo(() => {
    const base = filteredSections ?? _sections ?? [];
    const withoutExcluded =
      excludedTaskIds.size === 0
        ? base
        : base.map((section) => ({
            ...section,
            items: (section.items || []).filter((task) => !excludedTaskIds.has(task.id)),
          }));
    if (!_currentProject) return withoutExcluded;
    const emptyFiltered = getFilteredEmptySections(withoutExcluded, _currentProject, showEmptyViewColumns);
    return emptyFiltered.map((section) => ({
      ...section,
      items: returnSortedItems([...(section.items || [])], _currentProject),
    }));
  }, [filteredSections, _sections, _currentProject, excludedTaskIds, showEmptyViewColumns]);

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
  expanded, setExpanded, setExcludedTaskIds, sortState, setSortState,
  setTableSortViewAndReturn, changeBoardLayout, didRestore, timerToggling, lastGAt,
  sections, currentProjectSectionIds, sectionTitleBySid, sectionOrderBySid, customFieldBySortColumn,
  customFieldBySortColumnRef, customFieldById,
  };
}
