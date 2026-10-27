import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { useCallback, useEffect, useMemo } from "react";
import { ITask } from "@/models/model";
import type { IAllCommands } from "@/models/model";
import { shouldFlattenSortedRows, sortedTaskRowSectionKey } from "./tableSortFlatten";
import { tableSectionKey } from "./tableCreateTask";
import { useFlag } from "@/hooks/useFlag";
import { MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG } from "@/lib/flags/keys";
import { visibleTasksFromRows } from "@/lib/myTasksBulkSelection";
import type { TableViewProps } from "./tableViewShared";
import type { useTableState } from "./useTableState";
import { getSortComparator, Row, SECTION_CAP, isTaskRow } from "./tableViewShared";

type Context = Pick<TableViewProps, "myTasksSort" | "_currentProject" | "enableMyTasksBulkSelection"> &
  Pick<ReturnType<typeof useTableState>, "sortState" | "customFieldBySortColumnRef" | "sectionOrderBySid" | "timeTotals" | "timeNow" | "sections" | "expanded" | "myTasksBulk" | "setExcludedTaskIds" | "persistedActiveItem" | "showArchivedOnBoard" | "isApple" | "myTasksSnoozeEnabled" | "setSelectedIndex" | "updateActiveItemAndItemInView" | "setExpanded">;

export function useTableRows(context: Context) {
  const snapshot = useFirstScreenSurface();
  const {
  sortState, myTasksSort, _currentProject, customFieldBySortColumnRef, sectionOrderBySid,
  timeTotals, timeNow, sections, expanded, enableMyTasksBulkSelection,
  myTasksBulk, setExcludedTaskIds, persistedActiveItem, showArchivedOnBoard, isApple,
  myTasksSnoozeEnabled, setSelectedIndex, updateActiveItemAndItemInView, setExpanded,
  } = context;


  const crossBoardPrioritySortEnabled = useFlag(MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG);
  const isPrioritySort = sortState[0]?.column === "priority";
  const savedViewPrioritySort = myTasksSort?.field === "priority";

  const rows = useMemo(() => {
    if (sortState.length > 0) {
      const flattenSort = shouldFlattenSortedRows(
        Boolean(_currentProject),
        true,
        isPrioritySort,
        crossBoardPrioritySortEnabled
      ) || savedViewPrioritySort;
      const comparators = sortState.map(({ column, direction }, index) =>
        getSortComparator(
          column,
          direction,
          customFieldBySortColumnRef.current,
          _currentProject ? sectionOrderBySid : undefined,
          index === sortState.length - 1,
          timeTotals,
          timeNow,
          snapshot ? Date.parse(snapshot.now) : undefined,
        )
      );
      const sortTasks = (tasks: ITask[]) =>
        [...tasks].sort((a, b) => {
          for (const comparator of comparators) {
            const result = comparator(a, b);
            if (result !== 0) return result;
          }
          return 0;
        });

      if (flattenSort) {
        const allTasks = sections.flatMap((section) => section.items || []);
        return sortTasks(allTasks).map((task) => ({
          type: "task" as const,
          task,
          sid: sortedTaskRowSectionKey(Boolean(_currentProject), task),
        }));
      }

      const next: Row[] = [];
      sections.forEach((section, index) => {
        const sid = tableSectionKey(section) ?? `i${index}`;
        const items = sortTasks(section.items || []);
        const shown = expanded.has(sid) ? items : items.slice(0, SECTION_CAP);
        shown.forEach((task) => next.push({ type: "task", task, sid }));
        if (items.length > shown.length)
          next.push({ type: "more", sid, hidden: items.length - shown.length });
      });
      return next;
    }

    const next: Row[] = [];
    sections.forEach((section, index) => {
      const sid = tableSectionKey(section) ?? `i${index}`;
      const items = section.items || [];
      const shown = expanded.has(sid) ? items : items.slice(0, SECTION_CAP);
      shown.forEach((task) => next.push({ type: "task", task, sid }));
      if (items.length > shown.length)
        next.push({ type: "more", sid, hidden: items.length - shown.length });
    });
    return next;
  }, [
    sections,
    expanded,
    sortState,
    sectionOrderBySid,
    _currentProject,
    timeNow,
    timeTotals,
    isPrioritySort,
    crossBoardPrioritySortEnabled,
    savedViewPrioritySort,
    snapshot,
  ]);

  useEffect(() => {
    if (!enableMyTasksBulkSelection || !myTasksBulk) return;
    myTasksBulk.registerExcludedUpdater(setExcludedTaskIds);
  }, [enableMyTasksBulkSelection, myTasksBulk]);

  useEffect(() => {
    if (!enableMyTasksBulkSelection || !myTasksBulk) return;
    myTasksBulk.setVisibleItems(visibleTasksFromRows(rows));
  }, [enableMyTasksBulkSelection, myTasksBulk, rows]);

  const buildCommandContext = useCallback((): IAllCommands => {
    const currentTask = persistedActiveItem
      ? rows
          .filter(isTaskRow)
          .map((row) => row.task)
          .find((task) => task.id === persistedActiveItem)
      : undefined;

    const taskProject =
      currentTask?.project ??
      (currentTask?.projectId === _currentProject?.id ? _currentProject : undefined);

    return {
      context: currentTask ? "Task" : _currentProject ? "Kanban" : "Others",
      task: currentTask
        ? {
            taskId: currentTask.id,
            projectId: currentTask.projectId,
            sectionId: currentTask.sectionId ?? null,
          }
        : undefined,
      showArchivedOnBoard,
      taskOptions: currentTask
        ? {
            isApple,
            isArchived: currentTask.status === "Archive",
            hasNotifications: !!(
              currentTask._count?.notifications &&
              currentTask._count.notifications > 0
            ),
            isKanban: true,
            isMyTasks: myTasksSnoozeEnabled,
            hasSubtasks: !!currentTask.subTasks?.length,
            hasParent: !!currentTask.parentTaskId,
            isStarred: !!currentTask.savedContent?.length,
            timeTrackingEnabled: !!taskProject?.timeTrackingEnabled,
          }
        : undefined,
      commentOptions: undefined,
    };
  }, [_currentProject, isApple, myTasksSnoozeEnabled, persistedActiveItem, rows, showArchivedOnBoard]);


  const scrollToRow = useCallback((row: Row) => {
    const id = isTaskRow(row) ? `inbox-${row.task.id}` : `table-more-${row.sid}`;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, []);

  const focusRowElement = useCallback((taskId: number) => {
    const element = document.getElementById(`inbox-${taskId}`);
    if (element instanceof HTMLElement) {
      element.focus({ preventScroll: true });
    }
  }, []);

  const focusTo = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
      const row = rows[nextIndex];
      if (!row) return;
      setSelectedIndex(nextIndex);
      if (isTaskRow(row)) {
        updateActiveItemAndItemInView(row.task);
        focusRowElement(row.task.id);
      }
      scrollToRow(row);
    },
    [focusRowElement, rows, scrollToRow, updateActiveItemAndItemInView]
  );

  const expandSection = useCallback((sid: string | number) => {
    setExpanded((prev) => new Set(prev).add(sid));
  }, []);
  return {
  crossBoardPrioritySortEnabled, isPrioritySort, savedViewPrioritySort, rows, buildCommandContext,
  focusRowElement, focusTo, expandSection,
  };
}
