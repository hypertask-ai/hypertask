import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import { CommandMode } from "@/models/enums";
import { IAgent, ILabel, ISection, ITask, IUser } from "@/models/model";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import {
  getInclusiveRange,
  getTaskIdsByGroup,
  toggleId,
  toggleVisibleIds,
} from "@/lib/kanbanBulkSelection";

type Assignee = IUser | IAgent;
type AssigneeIntent = "assign" | "unassign" | "toggle";

type TaskOperation = (task: ITask) => Promise<void>;

interface KanbanBulkSelectionContextValue {
  selectedIds: Set<number>;
  selectedIdsArray: number[];
  selectedTasks: ITask[];
  selectedCount: number;
  failedIds: Set<number>;
  isProcessing: boolean;
  isSelected: (taskId: number) => boolean;
  toggleTaskSelection: (
    taskId: number,
    groupId: string | number,
    withRange?: boolean,
    orderedGroupIds?: readonly number[],
  ) => void;
  toggleVisibleSelection: (visibleIds: readonly number[]) => void;
  isAllVisibleSelected: (visibleIds: readonly number[]) => boolean;
  clearSelection: () => void;
  openBulkCommand: (mode?: CommandMode) => void;
  archiveSelected: () => Promise<void>;
  moveSelected: (section: ISection) => Promise<void>;
  assignSelected: (assignee: Assignee, intent?: AssigneeIntent) => Promise<void>;
  labelSelected: (label: ILabel) => Promise<void>;
  handleBulkKeyDown: (
    event: KeyboardEvent,
    focusedTaskId?: number,
    sequencePending?: boolean,
  ) => boolean;
}

interface KanbanBulkSelectionProviderProps {
  children: ReactNode;
  items: ITask[];
  onArchiveTask?: TaskOperation;
  onMoveTask?: (task: ITask, section: ISection) => Promise<void>;
  onAssignTask?: (
    task: ITask,
    assignee: Assignee,
    intent?: AssigneeIntent,
  ) => Promise<void>;
  onLabelTask?: (task: ITask, label: ILabel) => Promise<void>;
  getSelectionGroupId?: (
    task: ITask,
  ) => string | number | null | undefined;
}

const KanbanBulkSelectionContext =
  createContext<KanbanBulkSelectionContextValue | null>(null);

export const KanbanBulkSelectionProvider = ({
  children,
  items,
  onArchiveTask,
  onMoveTask,
  onAssignTask,
  onLabelTask,
  getSelectionGroupId = (task) => task.sectionId,
}: KanbanBulkSelectionProviderProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const anchorRef = useRef<{
    groupId: string | number;
    taskId: number;
  } | null>(null);
  const setShowCommands = useSetRecoilState(showCommandsAtom);

  const taskIdsByGroup = useMemo(
    () => getTaskIdsByGroup(items, getSelectionGroupId),
    [getSelectionGroupId, items],
  );

  const selectedTasks = useMemo(
    () => items.filter((task) => selectedIds.has(task.id)),
    [items, selectedIds],
  );

  // A task can disappear after an action or a realtime update. Do not leave a
  // hidden id in the selection, because the action bar count must match cards.
  useEffect(() => {
    const visibleIds = new Set(items.map((task) => task.id));
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((taskId) => visibleIds.has(taskId)),
      );
      if (next.size === current.size) return current;
      return next;
    });
    setFailedIds((current) => {
      const next = new Set(
        [...current].filter((taskId) => visibleIds.has(taskId)),
      );
      if (next.size === current.size) return current;
      return next;
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setFailedIds(new Set());
    anchorRef.current = null;
  }, []);

  const toggleTaskSelection = useCallback(
    (
      taskId: number,
      groupId: string | number,
      withRange = false,
      orderedGroupIds?: readonly number[],
    ) => {
      setSelectedIds((current) => {
        if (withRange && anchorRef.current?.groupId === groupId) {
          const taskIds = orderedGroupIds ?? taskIdsByGroup.get(groupId) ?? [];
          const range = getInclusiveRange(
            taskIds,
            anchorRef.current.taskId,
            taskId,
          );
          const next = new Set(current);
          range.forEach((id) => next.add(id));
          return next;
        }

        return toggleId(current, taskId);
      });
      if (!withRange || anchorRef.current?.groupId !== groupId) {
        anchorRef.current = { groupId, taskId };
      }
      setFailedIds((current) => {
        if (!current.has(taskId)) return current;
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    },
    [taskIdsByGroup],
  );

  const toggleVisibleSelection = useCallback((visibleIds: readonly number[]) => {
    setSelectedIds((current) => toggleVisibleIds(current, visibleIds));
    setFailedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((taskId) => next.delete(taskId));
      return next.size === current.size ? current : next;
    });
    anchorRef.current = null;
  }, []);

  const isAllVisibleSelected = useCallback(
    (visibleIds: readonly number[]) =>
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const openBulkCommand = useCallback(
    (mode = CommandMode.Command) => {
      setShowCommands({ show: true, mode });
    },
    [setShowCommands],
  );

  const runTaskOperation = useCallback(
    async (operation: TaskOperation, successText: string) => {
      if (isProcessing || selectedTasks.length === 0) return;

      const snapshot = selectedTasks;
      const failures: ITask[] = [];
      setIsProcessing(true);

      try {
        // Keep the calls sequential. Each operation updates the shared board
        // cache, and the next task must see the previous update.
        for (const task of snapshot) {
          try {
            await operation(task);
          } catch (error) {
            console.error("Kanban bulk action failed", task.id, error);
            failures.push(task);
          }
        }

        const nextFailedIds = new Set(failures.map((task) => task.id));
        setSelectedIds(nextFailedIds);
        setFailedIds(nextFailedIds);

        if (failures.length > 0) {
          toast.error(
            `${failures.length} of ${snapshot.length} tasks could not be updated`,
          );
        } else {
          toast.success(successText);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, selectedTasks],
  );

  const archiveSelected = useCallback(() => {
    if (!onArchiveTask) return Promise.resolve();
    return runTaskOperation(
      onArchiveTask,
      `${selectedTasks.length} tasks archived`,
    );
  }, [onArchiveTask, runTaskOperation, selectedTasks.length]);

  const moveSelected = useCallback(
    (section: ISection) => {
      if (!onMoveTask) return Promise.resolve();
      return runTaskOperation(
        (task) => onMoveTask(task, section),
        `${selectedTasks.length} tasks moved to ${section.section_title}`,
      );
    },
    [onMoveTask, runTaskOperation, selectedTasks.length],
  );

  const assignSelected = useCallback(
    (assignee: Assignee, intent: AssigneeIntent = "assign") => {
      if (!onAssignTask) return Promise.resolve();
      return runTaskOperation(
        (task) => onAssignTask(task, assignee, intent),
        `${selectedTasks.length} tasks updated`,
      );
    },
    [onAssignTask, runTaskOperation, selectedTasks.length],
  );

  const labelSelected = useCallback(
    (label: ILabel) => {
      if (!onLabelTask) return Promise.resolve();
      return runTaskOperation(
        (task) => onLabelTask(task, label),
        `${selectedTasks.length} tasks updated`,
      );
    },
    [onLabelTask, runTaskOperation, selectedTasks.length],
  );

  const handleBulkKeyDown = useCallback(
    (
      event: KeyboardEvent,
      focusedTaskId?: number,
      sequencePending = false,
    ) => {
      if (event.defaultPrevented || returnIfModalOrInputActive()) return false;

      const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
      const cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);

      if (
        focusedTaskId &&
        event.keyCode === KeyCodes.X &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl &&
        !event.repeat
      ) {
        event.preventDefault();
        const focusedTask = items.find((task) => task.id === focusedTaskId);
        toggleTaskSelection(
          focusedTaskId,
          (focusedTask && getSelectionGroupId(focusedTask)) ?? 0,
        );
        return true;
      }

      if (event.keyCode === KeyCodes.ESCAPE && selectedTasks.length > 0) {
        event.preventDefault();
        clearSelection();
        return true;
      }

      if (selectedTasks.length === 0 || sequencePending) return false;

      if (onArchiveTask && event.keyCode === KeyCodes.E && cmdControl) {
        event.preventDefault();
        if (!event.repeat) void archiveSelected();
        return true;
      }

      if (
        onAssignTask &&
        event.keyCode === KeyCodes.A &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.OpenAssignModal);
        return true;
      }

      if (
        onLabelTask &&
        event.keyCode === KeyCodes.T &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.LabelModal);
        return true;
      }

      if (
        onMoveTask &&
        event.keyCode === KeyCodes.M &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.MoveToColumn);
        return true;
      }

      return false;
    },
    [
      archiveSelected,
      clearSelection,
      getSelectionGroupId,
      items,
      onArchiveTask,
      onAssignTask,
      onLabelTask,
      onMoveTask,
      openBulkCommand,
      selectedTasks,
      toggleTaskSelection,
    ],
  );

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const activeElement = document.activeElement;
      if (activeElement?.closest("#htc-container")) return;
      handleBulkKeyDown(event);
    };

    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [handleBulkKeyDown]);

  const value = useMemo<KanbanBulkSelectionContextValue>(
    () => ({
      selectedIds,
      selectedIdsArray: [...selectedIds],
      selectedTasks,
      selectedCount: selectedTasks.length,
      failedIds,
      isProcessing,
      isSelected: (taskId) => selectedIds.has(taskId),
      toggleTaskSelection,
      toggleVisibleSelection,
      isAllVisibleSelected,
      clearSelection,
      openBulkCommand,
      archiveSelected,
      moveSelected,
      assignSelected,
      labelSelected,
      handleBulkKeyDown,
    }),
    [
      archiveSelected,
      assignSelected,
      clearSelection,
      failedIds,
      handleBulkKeyDown,
      isAllVisibleSelected,
      isProcessing,
      labelSelected,
      moveSelected,
      openBulkCommand,
      selectedIds,
      selectedTasks,
      toggleTaskSelection,
      toggleVisibleSelection,
    ],
  );

  return (
    <KanbanBulkSelectionContext.Provider value={value}>
      {children}
    </KanbanBulkSelectionContext.Provider>
  );
};

export const useKanbanBulkSelection = (): KanbanBulkSelectionContextValue => {
  const context = useContext(KanbanBulkSelectionContext);
  if (!context) {
    throw new Error(
      "useKanbanBulkSelection must be used within KanbanBulkSelectionProvider",
    );
  }
  return context;
};

export const useKanbanBulkSelectionOptional = () =>
  useContext(KanbanBulkSelectionContext);
