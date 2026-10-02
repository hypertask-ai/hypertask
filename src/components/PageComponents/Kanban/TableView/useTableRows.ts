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
  const {
  sortState, myTasksSort, _currentProject, customFieldBySortColumnRef, sectionOrderBySid,
  timeTotals, timeNow, sections, expanded, enableMyTasksBulkSelection,
  myTasksBulk, setExcludedTaskIds, persistedActiveItem, showArchivedOnBoard, isApple,
  myTasksSnoozeEnabled, setSelectedIndex, updateActiveItemAndItemInView, setExpanded,
  } = context;


  // HTPR-6215: sorting My Tasks by priority interleaves every board's tasks by
  // priority level, since priority (unlike most sort columns) is already
  // comparable across boards. Limited to Owner + QA by default; see tableSortFlatten.ts.
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
      // sectionId and sid share a numeric namespace only when there's a current
      // project (real sections); on /my-tasks, sid is the boardId (see
      // myTasksGrouping.ts), so sectionOrder would compare unrelated ids (HTPR-4887).
      const comparators = sortState.map(({ column, direction }, index) =>
        getSortComparator(
          column,
          direction,
          customFieldBySortColumnRef.current,
          _currentProject ? sectionOrderBySid : undefined,
          index === sortState.length - 1,
          timeTotals,
          timeNow,
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

      // Flat sort on a real board (there's only one project, so "flat" and
      // "grouped by board" are the same thing), or on /my-tasks when priority
      // sort is flattening it across boards (HTPR-6215). Otherwise /my-tasks
      // keeps the board grouping while sorting within it (HTPR-4887).
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
  ]);

  useEffect(() => {
    if (!enableMyTasksBulkSelection || !myTasksBulk) return;
    myTasksBulk.registerExcludedUpdater(setExcludedTaskIds);
  }, [enableMyTasksBulkSelection, myTasksBulk]);

  useEffect(() => {
    if (!enableMyTasksBulkSelection || !myTasksBulk) return;
    myTasksBulk.setVisibleItems(visibleTasksFromRows(rows));
  }, [enableMyTasksBulkSelection, myTasksBulk, rows]);

  // HTPR-4876: table view rendered <HypertasksCommands /> with no context, so
  // the palette fell back to "Others" and every Task- or Kanban-gated command
  // vanished: sort board, board time tracking, filter match mode. Table view is
  // the same board with the same filters and views, so it gets the same
  // context the board builds in Homepage's createContextOptionsForHTC.
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
      // No current project means /my-tasks, which is not a board: claiming
      // Kanban there would advertise sort-board and friends with nothing to
      // act on. Keep the old fallback for that surface.
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

  // Kanban cards take DOM focus on hover via spaceship; table rows only tracked
  // selectedIndex. Leftover focus in AI chat or an input then made
  // returnIfModalOrInputActive() swallow Ctrl+E on My Tasks (HTPR-6445).
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
