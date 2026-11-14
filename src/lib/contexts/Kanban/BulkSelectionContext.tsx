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
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { HTPR_8737_BULK_MOVE_BOARD_FLAG } from "@/lib/flags/definitions/htpr-8737-bulk-move-board";
import { reconcileActiveBoardQuery } from "@/lib/boardSync/reconcileActiveBoardQuery";

import { CommandMode } from "@/models/enums";
import { IAgent, ILabel, ISection, ITask, IUser } from "@/models/model";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { activeItemAtom, showCommandsAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { BULK_MOVE_BOARD_LIMIT, getInclusiveRange, toggleId } from "@/lib/kanbanBulkSelection";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7260_KANBAN_SELECT_ALL_FLAG, HTPR_7137_BULK_ARCHIVE_UNDO_ALL_FLAG } from "@/lib/flags/keys";
import { HTPR_8928_BULK_ARCHIVE_INSTANT_HIDE_FLAG } from "@/lib/flags/definitions/htpr-8928-bulk-archive-instant-hide";
import { HTPR_8929_COLUMN_SELECT_ALL_FLAG } from "@/lib/flags/definitions/htpr-8929-column-select-all";

type Assignee = IUser | IAgent;
type AssigneeIntent = "assign" | "unassign" | "toggle";

type TaskOperation = (task: ITask) => Promise<void | boolean>;

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
    sectionId?: number,
    withRange?: boolean,
  ) => void;
  clearSelection: () => void;
  selectAll: () => void;
  selectColumn: (sectionId?: number) => void;
  openBulkCommand: (mode?: CommandMode) => void;
  archiveSelected: () => Promise<void>;
  moveSelected: (section: ISection) => Promise<void>;
  moveSelectedToBoard: (projectId: number, sectionId: number) => Promise<void>;
  bulkMoveBoardEnabled: boolean;
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
  onArchiveTask: (task: ITask, suppressUndo?: boolean) => Promise<void | boolean>;
  onArchiveSelectedBatch?: (tasks: ITask[]) => Promise<ITask[]>;
  onArchiveUndo: (tasks: ITask[]) => void;
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

const COLUMN_CONTAINER_PREFIX = "droppable-section-container-";

const sectionIdFromElement = (
  element: Element | null | undefined,
): number | null => {
  if (!element) return null;
  const column = element.closest(`[id^="${COLUMN_CONTAINER_PREFIX}"]`)
    ?? element
      .closest(".section-container")
      ?.querySelector(`[id^="${COLUMN_CONTAINER_PREFIX}"]`);
  const columnId = column?.id;
  if (!columnId?.startsWith(COLUMN_CONTAINER_PREFIX)) return null;
  const sectionId = Number(columnId.slice(COLUMN_CONTAINER_PREFIX.length));
  return Number.isInteger(sectionId) ? sectionId : null;
};

export const KanbanBulkSelectionProvider = ({
  children,
  items,
  onArchiveTask,
  onArchiveSelectedBatch,
  onArchiveUndo,
  onMoveTask,
  onAssignTask,
  onLabelTask,
}: KanbanBulkSelectionProviderProps) => {
  const selectAllEnabled = useFlag(HTPR_7260_KANBAN_SELECT_ALL_FLAG);
  const bulkMoveBoardEnabled = useFlag(HTPR_8737_BULK_MOVE_BOARD_FLAG);
  const queryClient = useQueryClient();
  const focusedTaskId = useRecoilValue(activeItemAtom);
  const latestTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusedTaskId != null) latestTaskIdRef.current = focusedTaskId;
  }, [focusedTaskId]);
  const bulkArchiveUndoAll = useFlag(HTPR_7137_BULK_ARCHIVE_UNDO_ALL_FLAG);
  const bulkArchiveInstantHide = useFlag(HTPR_8928_BULK_ARCHIVE_INSTANT_HIDE_FLAG);
  const columnSelectAllEnabled = useFlag(HTPR_8929_COLUMN_SELECT_ALL_FLAG);
  const hoveredSectionIdRef = useRef<number | null>(null);
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

  const selectAll = useCallback(() => {
    if (!selectAllEnabled) return;
    setSelectedIds(new Set(items.map((task) => task.id)));
    setFailedIds(new Set());
  }, [items, selectAllEnabled]);

  const selectColumn = useCallback((sectionId?: number) => {
    if (!selectAllEnabled) return;
    const latestTask = items.find((task) => task.id === latestTaskIdRef.current)
      ?? selectedTasks.at(-1);
    const targetSectionId = sectionId
      ?? sectionIdFromElement(document.activeElement)
      ?? hoveredSectionIdRef.current
      ?? latestTask?.sectionId;
    if (targetSectionId == null) return;
    setSelectedIds(new Set(taskIdsBySection.get(targetSectionId) ?? []));
    setFailedIds(new Set());
  }, [items, selectAllEnabled, selectedTasks, taskIdsBySection]);

  const toggleTaskSelection = useCallback(
    (
      taskId: number,
      sectionId = items.find((task) => task.id === taskId)?.sectionId,
      withRange = false,
    ) => {
      if (sectionId == null) return;
      latestTaskIdRef.current = taskId;
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
    [items, taskIdsBySection],
  );

  const openBulkCommand = useCallback(
    (mode = CommandMode.Command) => {
      setShowCommands({ show: true, mode });
    },
    [setShowCommands],
  );

  const runTaskOperation = useCallback(
    async (operation: TaskOperation, successText: string, onComplete?: (tasks: ITask[]) => void) => {
      if (isProcessing || selectedTasks.length === 0) return;

      const snapshot = selectedTasks;
      const failures: ITask[] = [];
      const successes: ITask[] = [];
      let hasUndo = false;
      setIsProcessing(true);

      try {
        for (const task of snapshot) {
          try {
            hasUndo = (await operation(task)) === true || hasUndo;
            successes.push(task);
          } catch (error) {
            console.error("Kanban bulk action failed", task.id, error);
            failures.push(task);
          }
        }

        if (onComplete && successes.length > 0) {
          onComplete(successes);
          hasUndo = true;
        }

        const nextFailedIds = new Set(failures.map((task) => task.id));
        setSelectedIds(nextFailedIds);
        setFailedIds(nextFailedIds);

        if (failures.length > 0) {
          toast.error(
            `${failures.length} of ${snapshot.length} tasks could not be updated`,
          );
        } else if (!hasUndo) {
          toast.success(successText);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, selectedTasks],
  );

  const archiveSelected = useCallback(async () => {
    if (selectedTasks.length === 0 || isProcessing) return;

    if (
      bulkArchiveInstantHide
      && bulkArchiveUndoAll
      && selectedTasks.length > 1
      && onArchiveSelectedBatch
    ) {
      const snapshot = selectedTasks;
      clearSelection();
      void onArchiveSelectedBatch(snapshot)
        .then((failures) => {
          if (failures.length === 0) return;
          const nextFailedIds = new Set(failures.map((task) => task.id));
          setSelectedIds(nextFailedIds);
          setFailedIds(nextFailedIds);
          toast.error(
            `${failures.length} of ${snapshot.length} tasks could not be archived: ${failures.map((task) => task.title).join(", ")}`,
          );
        })
        .catch((error) => {
          console.error("Kanban bulk archive failed", error);
          toast.error("Bulk archive could not be completed");
          const projectId = snapshot[0]?.projectId;
          if (projectId) void reconcileActiveBoardQuery(queryClient, projectId);
        });
      return;
    }

    if (bulkArchiveUndoAll) {
      await runTaskOperation(
        (task) => onArchiveTask(task, true),
        `${selectedTasks.length} tasks archived`,
        onArchiveUndo,
      );
      return;
    }

    await runTaskOperation(
      onArchiveTask,
      `${selectedTasks.length} tasks archived`,
    );
  }, [
    bulkArchiveInstantHide,
    bulkArchiveUndoAll,
    clearSelection,
    isProcessing,
    onArchiveSelectedBatch,
    onArchiveTask,
    onArchiveUndo,
    queryClient,
    runTaskOperation,
    selectedTasks,
  ]);

  const moveSelected = useCallback(
    (section: ISection) =>
      runTaskOperation(
        (task) => onMoveTask(task, section),
        `${selectedTasks.length} tasks moved to ${section.section_title}`,
      ),
    [onMoveTask, runTaskOperation, selectedTasks.length],
  );

  const moveSelectedToBoard = useCallback(async (projectId: number, sectionId: number) => {
    if (!bulkMoveBoardEnabled || isProcessing || selectedTasks.length === 0) return;
    const snapshot = selectedTasks;
    if (snapshot.length > BULK_MOVE_BOARD_LIMIT) {
      toast.error(`Select at most ${BULK_MOVE_BOARD_LIMIT} tasks to move to another board.`);
      return;
    }
    const sourceProjectId = snapshot[0]?.projectId;
    if (!sourceProjectId || snapshot.some((task) => task.projectId !== sourceProjectId)) return;
    setIsProcessing(true);
    try {
      const { data } = await axios.post<{ movedIds: number[]; failedIds: number[]; issues: { id: number; message: string }[] }>("/api/tasks/bulk-move-board", {
        ids: snapshot.map((task) => task.id), sourceProjectId, projectId, sectionId,
      });
      const failed = new Set(data.failedIds);
      setSelectedIds(failed);
      setFailedIds(failed);
      if (data.issues.length) {
        toast.error(data.issues.map(({ id, message }) => `${snapshot.find((task) => task.id === id)?.ticketNumber || id}: ${message}`).join("\n"));
      } else {
        toast.success(`${data.movedIds.length} tasks moved`);
      }
    } catch (error) {
      const failed = new Set(snapshot.map((task) => task.id));
      setSelectedIds(failed);
      setFailedIds(failed);
      const message = axios.isAxiosError(error) && typeof error.response?.data?.message === "string" ? error.response.data.message : "Could not confirm move. Check both boards before retrying.";
      toast.error(message);
    } finally {
      try {
        await Promise.all([
          reconcileActiveBoardQuery(queryClient, sourceProjectId),
          queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "boardTasks" && query.queryKey[2] === projectId }),
        ]);
      } finally {
        setIsProcessing(false);
      }
    }
  }, [bulkMoveBoardEnabled, isProcessing, queryClient, selectedTasks]);

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

  useEffect(
    columnSelectAllEnabled
      ? () => {
          const trackHoveredColumn = (event: MouseEvent) => {
            hoveredSectionIdRef.current = sectionIdFromElement(
              event.target as Element | null,
            );
          };
          document.addEventListener("mouseover", trackHoveredColumn);
          return () =>
            document.removeEventListener("mouseover", trackHoveredColumn);
        }
      : () => {},
    [columnSelectAllEnabled],
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
        selectAllEnabled &&
        event.keyCode === KeyCodes.A &&
        cmdControl &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        selectAll();
        return true;
      }

      if (
        columnSelectAllEnabled &&
        event.keyCode === KeyCodes.A &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (!event.repeat) selectColumn();
        return true;
      }

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
      columnSelectAllEnabled,
      items,
      openBulkCommand,
      selectedTasks,
      selectAll,
      selectAllEnabled,
      selectColumn,
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

    const onSelectAllKeyDown = (event: KeyboardEvent) => {
      if (
        selectAllEnabled &&
        event.keyCode === KeyCodes.A &&
        (event.ctrlKey || event.metaKey) &&
        handleBulkKeyDown(event)
      ) event.stopImmediatePropagation();
    };

    document.addEventListener("keydown", onSelectAllKeyDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onSelectAllKeyDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [handleBulkKeyDown, selectAllEnabled]);

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
      selectAll,
      selectColumn,
      openBulkCommand,
      archiveSelected,
      moveSelected,
      moveSelectedToBoard,
      bulkMoveBoardEnabled,
      assignSelected,
      labelSelected,
      handleBulkKeyDown,
    }),
    [
      archiveSelected,
      assignSelected,
      bulkMoveBoardEnabled,
      moveSelectedToBoard,
      clearSelection,
      failedIds,
      handleBulkKeyDown,
      isProcessing,
      labelSelected,
      moveSelected,
      openBulkCommand,
      selectedIds,
      selectedTasks,
      selectAll,
      selectColumn,
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
