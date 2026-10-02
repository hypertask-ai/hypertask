import { useCallback, useEffect } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { IAssignees, ITask } from "@/models/model";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import globalConstants from "@/lib/constants";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import { getTaskShortcutAction } from "@/lib/keyboard/taskShortcuts";
import { CommandMode } from "@/models/enums";
import { MAX_SORT_LEVELS } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { toggleTaskTimer } from "@/hooks/Task Detail/useTimeTracking";
import toast from "react-hot-toast";
import globalAPIHandlers from "@/utils/api/global";
import { canDropTableRow, parseTableRowDragData } from "./tableRowDrag";
import type { TableViewProps } from "./tableViewShared";
import type { useTableState } from "./useTableState";
import type { useTableRows } from "./useTableRows";
import { SortColumn, initialDirection, SortState, myTasksSortFromTable, isTaskRow, Row, TASK_SHORTCUT_COMMAND_MODES } from "./tableViewShared";

type Context = Pick<TableViewProps, "myTasksSort" | "onMyTasksSortChange" | "_currentProject" | "currentUser"> &
  Pick<ReturnType<typeof useTableState>, "customFieldBySortColumn" | "sortState" | "setSortState" | "setTableSortViewAndReturn" | "setSelectedIndex" | "updateActiveItemAndItemInView" | "setTasksPlayList" | "navigateToTask" | "draggedTaskRef" | "setDragOverSectionId" | "currentProjectSectionIds" | "moveTaskToSection" | "timerToggling" | "queryClient" | "removeFromListWithStatus" | "setExcludedTaskIds" | "router" | "updateTaskInCache" | "starTask" | "assignTask" | "setAssignTask" | "myTasksSnoozeEnabled" | "lastGAt" | "setShowCommands" | "rowShortcutsEnabled" | "isApple" | "didRestore" | "persistedActiveItem" | "selectedIndex"> &
  Pick<ReturnType<typeof useTableRows>, "rows" | "focusRowElement" | "focusTo">;

export function useTableActions(context: Context) {
  const {
  customFieldBySortColumn, sortState, myTasksSort, onMyTasksSortChange, setSortState,
  _currentProject, setTableSortViewAndReturn, setSelectedIndex, updateActiveItemAndItemInView, setTasksPlayList,
  rows, navigateToTask, focusRowElement, draggedTaskRef, setDragOverSectionId,
  currentProjectSectionIds, moveTaskToSection, timerToggling, queryClient, removeFromListWithStatus,
  setExcludedTaskIds, router, updateTaskInCache, starTask, currentUser,
  assignTask, setAssignTask, myTasksSnoozeEnabled, lastGAt, setShowCommands,
  rowShortcutsEnabled, isApple, didRestore, persistedActiveItem, focusTo,
  selectedIndex,
  } = context;


  // Multi-level UI (shift-click adds tie-break columns, up to MAX_SORT_LEVELS), but
  // only the primary level persists to the view (table_sort_column/_direction are
  // single-value DB columns, unlike kanban's board_sorting_stack) — see resolveSortState.
  const toggleSort = useCallback(
    (column: SortColumn, shiftKey: boolean) => {
      const initial = initialDirection(column, customFieldBySortColumn);
      const existingIndex = sortState.findIndex((level) => level.column === column);
      let next: SortState;
      if (shiftKey && !myTasksSort) {
        if (existingIndex >= 0) {
          next = sortState.map((level, index) =>
            index === existingIndex
              ? { ...level, direction: level.direction === "asc" ? "desc" : "asc" }
              : level
          );
        } else if (sortState.length === MAX_SORT_LEVELS) {
          next = sortState;
        } else {
          next = [...sortState, { column, direction: initial }];
        }
      } else if (sortState[0]?.column !== column) {
        next = [{ column, direction: initial }];
      } else if (sortState[0].direction === initial) {
        next = [{ column, direction: initial === "asc" ? "desc" : "asc" }];
      } else {
        next = [];
      }
      if (myTasksSort && onMyTasksSortChange) {
        const controlledSort = myTasksSortFromTable(
          next[0] ?? { column, direction: initial },
        );
        if (controlledSort) onMyTasksSortChange(controlledSort);
        return;
      }
      setSortState(next);
      if (_currentProject) setTableSortViewAndReturn(_currentProject, next[0] ?? null);
    },
    [
      sortState,
      _currentProject,
      setTableSortViewAndReturn,
      customFieldBySortColumn,
      myTasksSort,
      onMyTasksSortChange,
    ]
  );

  const getTicketText = useCallback(
    (task: ITask) => {
      const prefix = _currentProject?.uniqueIdentifier || task.ticketNumber?.split("-")[0];
      return prefix ? `${prefix.toUpperCase()}-${task.uniqueIndex}` : `#${task.uniqueIndex}`;
    },
    [_currentProject?.uniqueIdentifier]
  );

  const openTask = useCallback(
    async (task: ITask, index: number) => {
      setSelectedIndex(index);
      updateActiveItemAndItemInView(task);
      setTasksPlayList(rows.filter(isTaskRow).map(({ task }) => ({ projectId: task.projectId, uniqueIndex: task.uniqueIndex })));
      navigateToTask(task.projectId, task.uniqueIndex);
    },
    [navigateToTask, rows, setTasksPlayList, updateActiveItemAndItemInView]
  );
  const handleMouseEnter = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      const row = rows[index];
      if (row && isTaskRow(row)) focusRowElement(row.task.id);
    },
    [focusRowElement, rows],
  );
  const handleMouseLeave = useCallback(() => {}, []);

  const clearTaskDrag = useCallback(() => {
    draggedTaskRef.current = null;
    setDragOverSectionId(null);
  }, []);

  const handleSectionDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, destinationSectionId: number) => {
      if (!canDropTableRow(draggedTaskRef.current, destinationSectionId, currentProjectSectionIds)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverSectionId(destinationSectionId);
    },
    [currentProjectSectionIds]
  );

  const handleSectionDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, destinationSectionId: number, destinationSectionTitle: string) => {
      event.preventDefault();
      const draggedTask =
        draggedTaskRef.current ?? parseTableRowDragData(event.dataTransfer.getData("text/plain"));
      clearTaskDrag();
      if (!canDropTableRow(draggedTask, destinationSectionId, currentProjectSectionIds)) return;
      const task = rows.find((row) => isTaskRow(row) && row.task.id === draggedTask!.taskId);
      if (!task || !isTaskRow(task)) return;

      moveTaskToSection({
        projectId: task.task.projectId,
        taskId: task.task.id,
        ticketNumber: task.task.ticketNumber,
        sourceSectionId: draggedTask!.sourceSectionId,
        destinationSectionId,
        destinationSectionTitle,
      });
    },
    [clearTaskDrag, currentProjectSectionIds, moveTaskToSection, rows]
  );

  const toggleSelectedTaskTimer = useCallback(async (taskId: number) => {
    if (timerToggling.current) return;
    timerToggling.current = true;
    try {
      await toggleTaskTimer(taskId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time", "task", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["time", "entries", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        queryClient.invalidateQueries({ queryKey: ["time", "report"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update timer");
    } finally {
      timerToggling.current = false;
    }
  }, [queryClient]);

  const archiveTaskFromTable = useCallback(async (task: ITask) => {
    if (_currentProject) {
      await removeFromListWithStatus(
        task.sectionId,
        _currentProject.id,
        task.id,
        "Archive"
      );
      return;
    }

    setExcludedTaskIds((previous) => {
      const next = new Set(previous);
      next.add(task.id);
      return next;
    });
    try {
      await globalAPIHandlers.archiveTask(task.id, "Archive");
      router.refresh();
      toast("Task archived");
    } catch {
      setExcludedTaskIds((previous) => {
        const next = new Set(previous);
        next.delete(task.id);
        return next;
      });
      toast.error("Unable to archive task");
    }
  }, [_currentProject, removeFromListWithStatus, router]);

  const updateTaskAfterRowMutation = useCallback(
    (task: ITask, update: Partial<ITask>) => {
      if (_currentProject) {
        updateTaskInCache(
          update,
          task.id,
          task.projectId,
          task.sectionId,
          _currentProject,
        );
      } else {
        router.refresh();
      }
    },
    [_currentProject, router, updateTaskInCache],
  );

  const starTaskFromTable = useCallback(
    async (task: ITask) => {
      try {
        const response = await starTask(task.id, task.projectId!);
        const starred = response.status === 200;
        updateTaskAfterRowMutation(task, {
          savedContent: starred ? [{ ...response.data }] : [],
        });
        toast(`${starred ? "Starred" : "Unstarred"} Task ${task.ticketNumber?.toUpperCase()}`);
      } catch {
        toast.error("Unable to update starred task");
      }
    },
    [starTask, updateTaskAfterRowMutation],
  );

  const archiveNotificationFromTable = useCallback(
    async (task: ITask) => {
      if (
        task._count?.notifications ||
        task._count?.notifications === 0
      ) {
        toast("This task is not in inbox");
        return;
      }
      try {
        await globalAPIHandlers.archiveTaskNotification(task.id, currentUser?.id);
        updateTaskAfterRowMutation(task, {
          notifications: [],
          _count: { ...task._count, notifications: 0 },
        });
        toast("Notifications archived");
      } catch {
        toast.error("Unable to archive notifications");
      }
    },
    [currentUser?.id, updateTaskAfterRowMutation],
  );

  const closeAssignModal = useCallback(
    (assignees?: IAssignees[], keepOpen?: boolean) => {
      if (assignTask && Array.isArray(assignees)) {
        updateTaskAfterRowMutation(assignTask, { assignees });
        setAssignTask((task) => (task ? { ...task, assignees } : null));
      }
      if (!keepOpen) setAssignTask(null);
    },
    [assignTask, updateTaskAfterRowMutation],
  );

  const runTaskShortcut = useCallback(
    (event: KeyboardEvent, row: Row | undefined, index: number) => {
      if (!row || !isTaskRow(row)) return false;
      if (
        myTasksSnoozeEnabled &&
        event.keyCode === KeyCodes.H &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.repeat
      ) {
        const now = Date.now();
        if (
          lastGAt.current &&
          now - lastGAt.current < globalConstants.gThenKeyDelay
        ) {
          return false;
        }
        event.preventDefault();
        updateActiveItemAndItemInView(row.task);
        setShowCommands({
          show: true,
          mode: CommandMode.RemindMe,
          payload: {
            returnsToMyTasks:
              typeof row.task.currentUserAssignmentId === "number" &&
              row.task.currentUserAssignmentId > 0,
          },
        });
        return true;
      }
      if (!rowShortcutsEnabled) return false;
      const action = getTaskShortcutAction(event, isApple);
      if (!action) return false;

      event.preventDefault();
      updateActiveItemAndItemInView(row.task);
      if (action === "select") return true;
      if (action === "archive") {
        if (shouldRunArchiveShortcut(event)) void archiveTaskFromTable(row.task);
        return true;
      }
      if (action === "star") {
        void starTaskFromTable(row.task);
        return true;
      }
      if (action === "edit") {
        void archiveNotificationFromTable(row.task);
        return true;
      }
      if (action === "assignee") {
        setAssignTask(row.task);
        return true;
      }
      if (action === "open") {
        void openTask(row.task, index);
        return true;
      }

      const mode = TASK_SHORTCUT_COMMAND_MODES[action];
      if (mode !== undefined) setShowCommands({ show: true, mode });
      return true;
    },
    [
      archiveNotificationFromTable,
      archiveTaskFromTable,
      isApple,
      myTasksSnoozeEnabled,
      openTask,
      rowShortcutsEnabled,
      setShowCommands,
      starTaskFromTable,
      updateActiveItemAndItemInView,
    ],
  );

  useEffect(() => {
    if (didRestore.current || !rows.length) return;
    didRestore.current = true;
    const restored = rows.findIndex((row) => isTaskRow(row) && row.task.id === persistedActiveItem);
    focusTo(restored >= 0 ? restored : 0);
  }, [focusTo, persistedActiveItem, rows]);

  useEffect(() => {
    if (!rows.length) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex > rows.length - 1) focusTo(rows.length - 1);
  }, [focusTo, rows.length, selectedIndex]);
  return {
  toggleSort, getTicketText, openTask, handleMouseEnter, handleMouseLeave,
  clearTaskDrag, handleSectionDragOver, handleSectionDrop, toggleSelectedTaskTimer, archiveTaskFromTable,
  closeAssignModal, runTaskShortcut,
  };
}
