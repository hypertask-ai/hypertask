"use client";

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
import { inViewObjectAtom, showCommandsAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { getInclusiveRange, toggleId } from "@/lib/kanbanBulkSelection";
import { sharedProjectId } from "@/lib/myTasksBulkSelection";
import { useUndoContext } from "@/hooks/General/useUndo";
import globalAPIHandlers from "@/utils/api/global";
import { useAssignTaskUser } from "@/hooks/Task Detail/useAssignTaskUser";
import useMoveTaskToSection from "@/hooks/MultiPages/useMoveTaskToSection";
import axiosClient from "@/utils/axiosClient";

type Assignee = IUser | IAgent;
type AssigneeIntent = "assign" | "unassign" | "toggle";

interface MyTasksBulkSelectionContextValue {
  selectedIds: Set<number>;
  selectedIdsArray: number[];
  selectedTasks: ITask[];
  selectedCount: number;
  failedIds: Set<number>;
  isProcessing: boolean;
  isAllSelected: boolean;
  isSelected: (taskId: number) => boolean;
  toggleTaskSelection: (taskId: number, withRange?: boolean) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  openBulkCommand: (mode?: CommandMode) => void;
  requireSameBoard: () => number | null;
  archiveSelected: () => Promise<void>;
  moveSelected: (section: ISection) => Promise<void>;
  assignSelected: (assignee: Assignee, intent?: AssigneeIntent) => Promise<void>;
  labelSelected: (label: ILabel) => Promise<void>;
  setVisibleItems: (tasks: ITask[]) => void;
  registerExcludedUpdater: (
    updater: (update: (previous: Set<number>) => Set<number>) => void,
  ) => void;
}

interface MyTasksBulkSelectionProviderProps {
  children: ReactNode;
  resetSelectionKey?: string;
  onAfterMutation: () => void;
}

const MyTasksBulkSelectionContext =
  createContext<MyTasksBulkSelectionContextValue | null>(null);

const MIXED_BOARD_TOAST =
  "Select tasks from one board for assign, label, or move";

export const MyTasksBulkSelectionProvider = ({
  children,
  resetSelectionKey,
  onAfterMutation,
}: MyTasksBulkSelectionProviderProps) => {
  const [items, setItems] = useState<ITask[]>([]);
  const itemsRef = useRef<ITask[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const anchorTaskIdRef = useRef<number | null>(null);
  const excludedUpdaterRef = useRef<
    ((update: (previous: Set<number>) => Set<number>) => void) | null
  >(null);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const { performActionAndStoreUndoData } = useUndoContext();
  const assignTaskUser = useAssignTaskUser();
  const moveTaskToSection = useMoveTaskToSection();

  const setVisibleItems = useCallback((tasks: ITask[]) => {
    itemsRef.current = tasks;
    setItems((previous) => {
      const sameIds =
        previous.length === tasks.length &&
        previous.every((task, index) => task.id === tasks[index]?.id);
      if (!sameIds) return tasks;
      // IDs matched, but metadata (column, labels, assignees) may have refreshed.
      const sameMeta = previous.every((task, index) => {
        const next = tasks[index];
        if (!next) return false;
        return (
          task.projectId === next.projectId &&
          task.sectionId === next.sectionId &&
          task.title === next.title &&
          (task.taskLabels?.length ?? 0) === (next.taskLabels?.length ?? 0) &&
          (task.assignees?.length ?? 0) === (next.assignees?.length ?? 0)
        );
      });
      return sameMeta ? previous : tasks;
    });
  }, []);

  const registerExcludedUpdater = useCallback(
    (updater: (update: (previous: Set<number>) => Set<number>) => void) => {
      excludedUpdaterRef.current = updater;
    },
    [],
  );

  const onExcludedTaskIdsChange = useCallback(
    (update: (previous: Set<number>) => Set<number>) => {
      excludedUpdaterRef.current?.(update);
    },
    [],
  );

  const visibleIds = useMemo(() => items.map((task) => task.id), [items]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  const selectedTasks = useMemo(
    () => items.filter((task) => selectedIds.has(task.id)),
    [items, selectedIds],
  );

  const selectedTasksSnapshot = useCallback(() => {
    const visible = itemsRef.current;
    return visible.filter((task) => selectedIds.has(task.id));
  }, [selectedIds]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((taskId) => visibleIdSet.has(taskId)),
      );
      if (next.size === current.size) return current;
      return next;
    });
    setFailedIds((current) => {
      const next = new Set(
        [...current].filter((taskId) => visibleIdSet.has(taskId)),
      );
      if (next.size === current.size) return current;
      return next;
    });
  }, [visibleIdSet]);

  useEffect(() => {
    if (resetSelectionKey == null) return;
    setSelectedIds(new Set());
    setFailedIds(new Set());
    anchorTaskIdRef.current = null;
  }, [resetSelectionKey]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setFailedIds(new Set());
    anchorTaskIdRef.current = null;
  }, []);

  const isSelected = useCallback(
    (taskId: number) => selectedIds.has(taskId),
    [selectedIds],
  );

  const toggleTaskSelection = useCallback(
    (taskId: number, withRange = false) => {
      if (!visibleIdSet.has(taskId)) return;

      if (withRange && anchorTaskIdRef.current != null) {
        const rangeIds = getInclusiveRange(
          visibleIds,
          anchorTaskIdRef.current,
          taskId,
        );
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const id of rangeIds) next.add(id);
          return next;
        });
        return;
      }

      setSelectedIds((current) => toggleId(current, taskId));
      anchorTaskIdRef.current = taskId;
    },
    [visibleIdSet, visibleIds],
  );

  const isAllSelected =
    items.length > 0 && selectedTasks.length === items.length;

  const selectAllVisible = useCallback(() => {
    if (isAllSelected) {
      clearSelection();
      return;
    }
    setSelectedIds(new Set(visibleIds));
  }, [clearSelection, isAllSelected, visibleIds]);

  const requireSameBoard = useCallback(() => {
    const projectId = sharedProjectId(selectedTasks);
    if (projectId == null) {
      toast.error(MIXED_BOARD_TOAST);
      return null;
    }
    return projectId;
  }, [selectedTasks]);

  const seedInViewFromSelection = useCallback(() => {
    const task = selectedTasks[0];
    if (!task) return;
    setInViewObject({
      taskId: task.id,
      taskProjectId: task.projectId,
      sectionId: task.sectionId ?? undefined,
      sectionTitle: task.section ?? undefined,
      taskTitle: task.title ?? undefined,
      taskTicketNumber: task.ticketNumber ?? undefined,
    });
  }, [selectedTasks, setInViewObject]);

  const openBulkCommand = useCallback(
    (mode = CommandMode.Command) => {
      if (
        mode === CommandMode.OpenAssignModal ||
        mode === CommandMode.LabelModal ||
        mode === CommandMode.MoveToColumn
      ) {
        if (requireSameBoard() == null) return;
        seedInViewFromSelection();
      }
      setShowCommands({ show: true, mode });
    },
    [requireSameBoard, seedInViewFromSelection, setShowCommands],
  );

  const archiveSelected = useCallback(async () => {
    if (isProcessing || selectedIds.size === 0) return;

    const snapshot = selectedTasksSnapshot();
    if (snapshot.length === 0) return;
    const snapshotIds = snapshot.map((task) => task.id);
    setIsProcessing(true);

    onExcludedTaskIdsChange((previous) => {
      const next = new Set(previous);
      for (const id of snapshotIds) next.add(id);
      return next;
    });

    try {
      const results = await Promise.allSettled(
        snapshot.map((task) =>
          globalAPIHandlers.archiveTask(task.id, "Archive"),
        ),
      );
      const failures: number[] = [];
      results.forEach((result, index) => {
        const taskId = snapshotIds[index]!;
        if (result.status === "rejected") {
          console.error("My Tasks bulk archive failed", taskId, result.reason);
          failures.push(taskId);
          onExcludedTaskIdsChange((previous) => {
            const next = new Set(previous);
            next.delete(taskId);
            return next;
          });
        }
      });

      const archivedIds = snapshotIds.filter((id) => !failures.includes(id));
      if (archivedIds.length > 0) {
        performActionAndStoreUndoData(
          { taskIds: archivedIds, isMyTasksBulkArchive: true },
          `Undo archive (${archivedIds.length} items)`,
          async (data: { taskIds: number[] }) => {
            const undoResults = await Promise.allSettled(
              data.taskIds.map((taskId) =>
                globalAPIHandlers.archiveTask(taskId, "Normal"),
              ),
            );
            const restored: number[] = [];
            const undoFailures: number[] = [];
            undoResults.forEach((result, index) => {
              const taskId = data.taskIds[index]!;
              if (result.status === "fulfilled") restored.push(taskId);
              else undoFailures.push(taskId);
            });
            if (restored.length > 0) {
              onExcludedTaskIdsChange((previous) => {
                const next = new Set(previous);
                for (const taskId of restored) next.delete(taskId);
                return next;
              });
              onAfterMutation();
            }
            if (undoFailures.length > 0) {
              toast.error(
                `${undoFailures.length} of ${data.taskIds.length} tasks could not be restored`,
              );
              throw new Error("Partial My Tasks bulk undo failure");
            }
          },
        );
      }

      setSelectedIds(new Set(failures));
      setFailedIds(new Set(failures));
      if (failures.length > 0) {
        toast.error(
          `${failures.length} of ${snapshot.length} tasks could not be archived`,
        );
      }
      onAfterMutation();
    } finally {
      setIsProcessing(false);
    }
  }, [
    isProcessing,
    onAfterMutation,
    onExcludedTaskIdsChange,
    performActionAndStoreUndoData,
    selectedIds.size,
    selectedTasksSnapshot,
  ]);

  const runSameBoardOperation = useCallback(
    async (
      operation: (task: ITask) => Promise<void>,
      successText: string,
    ) => {
      if (isProcessing || selectedIds.size === 0) return;
      const snapshot = selectedTasksSnapshot();
      if (snapshot.length === 0) return;
      if (sharedProjectId(snapshot) == null) {
        toast.error(MIXED_BOARD_TOAST);
        return;
      }

      const failures: ITask[] = [];
      setIsProcessing(true);
      try {
        const results = await Promise.allSettled(
          snapshot.map((task) => operation(task)),
        );
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const task = snapshot[index]!;
            console.error(
              "My Tasks bulk action failed",
              task.id,
              result.reason,
            );
            failures.push(task);
          }
        });
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
        onAfterMutation();
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, onAfterMutation, selectedIds.size, selectedTasksSnapshot],
  );

  const moveSelected = useCallback(
    (section: ISection) =>
      runSameBoardOperation(async (task) => {
        const sourceSectionId = task.sectionId;
        const destinationSectionId = section.sectionId ?? section.id;
        if (sourceSectionId == null || destinationSectionId == null) {
          throw new Error("Task column is unavailable");
        }
        if (sourceSectionId === destinationSectionId) return;
        await moveTaskToSection.mutateAsync({
          projectId: task.projectId,
          taskId: task.id,
          ticketNumber: task.ticketNumber,
          sourceSectionId,
          destinationSectionId,
          destinationSectionTitle: section.section_title,
        });
      }, `${selectedTasks.length} tasks moved to ${section.section_title}`),
    [moveTaskToSection, runSameBoardOperation, selectedTasks.length],
  );

  const assignSelected = useCallback(
    (assignee: Assignee, intent: AssigneeIntent = "assign") =>
      runSameBoardOperation(
        async (task) => {
          await assignTaskUser(assignee, task.id, intent);
        },
        `${selectedTasks.length} tasks updated`,
      ),
    [assignTaskUser, runSameBoardOperation, selectedTasks.length],
  );

  const labelSelected = useCallback(
    (label: ILabel) =>
      runSameBoardOperation(async (task) => {
        const hasLabel =
          task.taskLabels?.some((taskLabel) => taskLabel.labelId === label.id) ??
          false;
        const shouldAssign = !label.check;
        if (hasLabel === shouldAssign) return;
        await axiosClient.post("/labels/assignLabel", {
          taskId: task.id,
          labelId: label.id,
        });
      }, `${selectedTasks.length} tasks updated`),
    [runSameBoardOperation, selectedTasks.length],
  );

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || returnIfModalOrInputActive()) return;
      const activeElement = document.activeElement;
      if (activeElement?.closest("#htc-container")) return;

      const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
      const cmdControl =
        (isApple && event.metaKey) || (!isApple && event.ctrlKey);

      if (
        cmdControl &&
        event.keyCode === KeyCodes.A &&
        !event.shiftKey &&
        items.length > 0
      ) {
        event.preventDefault();
        selectAllVisible();
        return;
      }

      if (event.keyCode === KeyCodes.ESCAPE && selectedTasks.length > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (selectedTasks.length === 0) return;

      if (
        event.keyCode === KeyCodes.A &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.OpenAssignModal);
        return;
      }

      if (
        event.keyCode === KeyCodes.T &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.LabelModal);
        return;
      }

      if (
        event.keyCode === KeyCodes.M &&
        !event.shiftKey &&
        !event.altKey &&
        !cmdControl
      ) {
        event.preventDefault();
        openBulkCommand(CommandMode.MoveToColumn);
      }
    };

    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [
    clearSelection,
    items.length,
    openBulkCommand,
    selectAllVisible,
    selectedTasks.length,
  ]);

  const value = useMemo<MyTasksBulkSelectionContextValue>(
    () => ({
      selectedIds,
      selectedIdsArray: Array.from(selectedIds),
      selectedTasks,
      selectedCount: selectedTasks.length,
      failedIds,
      isProcessing,
      isAllSelected,
      isSelected,
      toggleTaskSelection,
      selectAllVisible,
      clearSelection,
      openBulkCommand,
      requireSameBoard,
      archiveSelected,
      moveSelected,
      assignSelected,
      labelSelected,
      setVisibleItems,
      registerExcludedUpdater,
    }),
    [
      archiveSelected,
      assignSelected,
      clearSelection,
      failedIds,
      isAllSelected,
      isProcessing,
      isSelected,
      labelSelected,
      moveSelected,
      openBulkCommand,
      registerExcludedUpdater,
      requireSameBoard,
      selectAllVisible,
      selectedIds,
      selectedTasks,
      setVisibleItems,
      toggleTaskSelection,
    ],
  );

  return (
    <MyTasksBulkSelectionContext.Provider value={value}>
      {children}
    </MyTasksBulkSelectionContext.Provider>
  );
};

export const useMyTasksBulkSelection = (): MyTasksBulkSelectionContextValue => {
  const context = useContext(MyTasksBulkSelectionContext);
  if (!context) {
    throw new Error(
      "useMyTasksBulkSelection must be used within MyTasksBulkSelectionProvider",
    );
  }
  return context;
};

export const useMyTasksBulkSelectionOptional = () =>
  useContext(MyTasksBulkSelectionContext);
