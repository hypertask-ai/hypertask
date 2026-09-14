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
import { shouldIgnoreTaskShortcutTarget } from "@/lib/keyboard/taskShortcuts";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import {
  getInclusiveRange,
  getSharedProjectId,
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
  sharedProjectId: number | null;
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
  guardProjectScopedAction: () => boolean;
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
  onArchiveComplete?: (tasks: ITask[]) => Promise<void> | void;
  requireSingleProject?: boolean;
  onMutationComplete?: () => Promise<void> | void;
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
  onArchiveComplete,
  requireSingleProject = false,
  onMutationComplete,
}: KanbanBulkSelectionProviderProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
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
  const sharedProjectId = useMemo(
    () => getSharedProjectId(selectedTasks),
    [selectedTasks],
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
    const anchor = anchorRef.current;
    if (
      anchor &&
      !taskIdsByGroup.get(anchor.groupId)?.includes(anchor.taskId)
    ) {
      anchorRef.current = null;
    }
  }, [items, taskIdsByGroup]);

  const clearSelection = useCallback(() => {
    if (processingRef.current) return;
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
      if (processingRef.current) return;
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
    if (processingRef.current) return;
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

  const guardProjectScopedAction = useCallback(() => {
    if (!requireSingleProject || sharedProjectId !== null) return true;
    toast.error("Select tasks from one board to assign, label or move");
    return false;
  }, [requireSingleProject, sharedProjectId]);

  const openBulkCommand = useCallback(
    (mode = CommandMode.Command) => {
      if (processingRef.current) return;
      if (
        (mode === CommandMode.OpenAssignModal ||
          mode === CommandMode.LabelModal ||
          mode === CommandMode.MoveToColumn) &&
        !guardProjectScopedAction()
      ) {
        return;
      }
      setShowCommands({ show: true, mode });
    },
    [guardProjectScopedAction, setShowCommands],
  );

  const runTaskOperation = useCallback(
    async (
      operation: TaskOperation,
      successText: string,
      onComplete?: (tasks: ITask[]) => Promise<void> | void,
      showSuccessToast = true,
    ) => {
      if (processingRef.current || selectedTasks.length === 0) return;

      const snapshot = selectedTasks;
      const failures: ITask[] = [];
      processingRef.current = true;
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

        const failedTaskIds = new Set(failures.map((task) => task.id));
        const completedTasks = snapshot.filter(
          (task) => !failedTaskIds.has(task.id),
        );
        setSelectedIds(failedTaskIds);
        setFailedIds(failedTaskIds);
        anchorRef.current = null;
        await onComplete?.(completedTasks);

        if (failures.length > 0) {
          toast.error(
            `${failures.length} of ${snapshot.length} tasks could not be updated`,
          );
        } else if (showSuccessToast) {
          toast.success(successText);
        }
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
    },
    [selectedTasks],
  );

  const archiveSelected = useCallback(() => {
    if (!onArchiveTask) return Promise.resolve();
    return runTaskOperation(
      onArchiveTask,
      `${selectedTasks.length} tasks archived`,
      onArchiveComplete,
      !onArchiveComplete,
    );
  }, [onArchiveComplete, onArchiveTask, runTaskOperation, selectedTasks.length]);

  const moveSelected = useCallback(
    (section: ISection) => {
      if (!onMoveTask || !guardProjectScopedAction()) return Promise.resolve();
      return runTaskOperation(
        (task) => onMoveTask(task, section),
        `${selectedTasks.length} tasks moved to ${section.section_title}`,
        onMutationComplete,
      );
    },
    [
      guardProjectScopedAction,
      onMoveTask,
      onMutationComplete,
      runTaskOperation,
      selectedTasks.length,
    ],
  );

  const assignSelected = useCallback(
    (assignee: Assignee, intent: AssigneeIntent = "assign") => {
      if (!onAssignTask || !guardProjectScopedAction()) return Promise.resolve();
      return runTaskOperation(
        (task) => onAssignTask(task, assignee, intent),
        `${selectedTasks.length} tasks updated`,
        onMutationComplete,
      );
    },
    [
      guardProjectScopedAction,
      onAssignTask,
      onMutationComplete,
      runTaskOperation,
      selectedTasks.length,
    ],
  );

  const labelSelected = useCallback(
    (label: ILabel) => {
      if (!onLabelTask || !guardProjectScopedAction()) return Promise.resolve();
      return runTaskOperation(
        (task) => onLabelTask(task, label),
        `${selectedTasks.length} tasks updated`,
        onMutationComplete,
      );
    },
    [
      guardProjectScopedAction,
      onLabelTask,
      onMutationComplete,
      runTaskOperation,
      selectedTasks.length,
    ],
  );

  const handleBulkKeyDown = useCallback(
    (
      event: KeyboardEvent,
      focusedTaskId?: number,
      sequencePending = false,
    ) => {
      if (
        event.defaultPrevented ||
        shouldIgnoreTaskShortcutTarget(event.target as HTMLElement | null) ||
        returnIfModalOrInputActive()
      ) {
        return false;
      }

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
      sharedProjectId,
      failedIds,
      isProcessing,
      isSelected: (taskId) => selectedIds.has(taskId),
      toggleTaskSelection,
      toggleVisibleSelection,
      isAllVisibleSelected,
      clearSelection,
      guardProjectScopedAction,
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
      guardProjectScopedAction,
      handleBulkKeyDown,
      isAllVisibleSelected,
      isProcessing,
      labelSelected,
      moveSelected,
      openBulkCommand,
      selectedIds,
      selectedTasks,
      sharedProjectId,
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
