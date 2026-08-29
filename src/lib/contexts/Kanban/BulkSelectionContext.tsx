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
import { getInclusiveRange, toggleId } from "@/lib/kanbanBulkSelection";

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
    sectionId: number,
    withRange?: boolean,
  ) => void;
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
  onArchiveTask: TaskOperation;
  onMoveTask: (task: ITask, section: ISection) => Promise<void>;
  onAssignTask: (
    task: ITask,
    assignee: Assignee,
    intent?: AssigneeIntent,
  ) => Promise<void>;
  onLabelTask: (task: ITask, label: ILabel) => Promise<void>;
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
}: KanbanBulkSelectionProviderProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const anchorRef = useRef<{ sectionId: number; taskId: number } | null>(null);
  const setShowCommands = useSetRecoilState(showCommandsAtom);

  const taskIdsBySection = useMemo(() => {
    const result = new Map<number, number[]>();
    for (const task of items) {
      if (task.sectionId == null) continue;
      const taskIds = result.get(task.sectionId) ?? [];
      taskIds.push(task.id);
      result.set(task.sectionId, taskIds);
    }
    return result;
  }, [items]);

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
    (taskId: number, sectionId: number, withRange = false) => {
      setSelectedIds((current) => {
        if (withRange && anchorRef.current?.sectionId === sectionId) {
          const taskIds = taskIdsBySection.get(sectionId) ?? [];
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
      if (!withRange || anchorRef.current?.sectionId !== sectionId) {
        anchorRef.current = { sectionId, taskId };
      }
      setFailedIds((current) => {
        if (!current.has(taskId)) return current;
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    },
    [taskIdsBySection],
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

  const archiveSelected = useCallback(
    () => runTaskOperation(onArchiveTask, `${selectedTasks.length} tasks archived`),
    [onArchiveTask, runTaskOperation, selectedTasks.length],
  );

  const moveSelected = useCallback(
    (section: ISection) =>
      runTaskOperation(
        (task) => onMoveTask(task, section),
        `${selectedTasks.length} tasks moved to ${section.section_title}`,
      ),
    [onMoveTask, runTaskOperation, selectedTasks.length],
  );

  const assignSelected = useCallback(
    (assignee: Assignee, intent: AssigneeIntent = "assign") =>
      runTaskOperation(
        (task) => onAssignTask(task, assignee, intent),
        `${selectedTasks.length} tasks updated`,
      ),
    [onAssignTask, runTaskOperation, selectedTasks.length],
  );

  const labelSelected = useCallback(
    (label: ILabel) =>
      runTaskOperation(
        (task) => onLabelTask(task, label),
        `${selectedTasks.length} tasks updated`,
      ),
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
        toggleTaskSelection(
          focusedTaskId,
          items.find((task) => task.id === focusedTaskId)?.sectionId ?? 0,
        );
        return true;
      }

      if (event.keyCode === KeyCodes.ESCAPE && selectedTasks.length > 0) {
        event.preventDefault();
        clearSelection();
        return true;
      }

      if (selectedTasks.length === 0 || sequencePending) return false;

      if (event.keyCode === KeyCodes.E && cmdControl) {
        event.preventDefault();
        if (!event.repeat) void archiveSelected();
        return true;
      }

      if (
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
      items,
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
      isProcessing,
      labelSelected,
      moveSelected,
      openBulkCommand,
      selectedIds,
      selectedTasks,
      toggleTaskSelection,
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
