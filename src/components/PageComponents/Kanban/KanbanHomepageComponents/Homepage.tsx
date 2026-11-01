import { HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG } from "@/lib/flags/definitions/htpr-8149-archive-focus-order";
import { useFlag } from "@/hooks/useFlag";
import { BoardCardDataProvider } from "../KanbanTaskComponents/BoardCardData";
import { HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG } from "@/lib/flags/definitions/htpr-7677-board-card-data-once";
import { updateSection as writeSection } from "@/lib/api/typedClient";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_7549_FIRST_TASK_POINTER_FLAG, HTPR_7550_CONNECT_OVERLAY_FLAG } from "@/lib/flags/keys";

import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { useStore } from "jotai";
import Section, { LARGE_BOARD_PROGRESSIVE_RENDER_THRESHOLD } from "../KanbanSectionComponents/section";
const HypertasksCommands = React.lazy(() => import("../../../commands"));
import {
  activeBuiltinViewsAtom,
  activeItemAtom,
  showCommandsAtom,
  appShellRailAtom,
  kanbanRunningOnlyAtom,
} from "../../../../store";

import { IAgent, ILabel, IProject, ISection, IUser, IPriority, IEstimate, ITaskLabel, ITask, IStatus, IAllCommands } from "@/models/model";
import { useUndoContext } from "@/hooks/General/useUndo";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import globalAPIHandlers from "@/utils/api/global";
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DragStart,
  type DropResult,
  useKeyboardSensor,
  useMouseSensor,
} from "@hello-pangea/dnd";
import useHandleKeyDownOperations from "@/hooks/Homepage/useHandleKeyDownOperations";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useSubTask from "@/hooks/SubTask/useSubTask";
import ConfirmTaskDelete from "@/components/Modals/confirmDeleteModals/confirmtTaskDelete";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import BoardEmptyState from "./BoardEmptyState";
import { useConnectAgentOverlay } from "@/hooks/useConnectAgentOverlay";
import { ConnectAgentOverlay } from "@/components/PageComponents/Onboarding/ConnectAgentOverlay";
import FirstTaskPointer from "../KanbanSectionComponents/FirstTaskPointer";
import { detectEmptyBoardState } from "@/utils/helperFunctions/Views/BoardEmptyStateHelper";
import { getAppliedSearchedTasks } from "@/utils/helperFunctions/Views/SearchFilterHelperFunction";
import { boardSearchAtom } from "@/store";
import { useGetArchivedTasksOnBoard } from "@/hooks/Homepage/useGetArchivedTasksOnBoard";
import { useShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import { useBoardRealtime } from "@/hooks/realtime/useBoardRealtime";
import { nextFocusAfterRemoval } from "@/utils/helperFunctions/focusAfterRemoval";
import axios from "axios";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import useRevealFocusOnViewSwitch from "@/hooks/Homepage/Views/useRevealFocusOnViewSwitch";
import { getActiveBoardViewId } from "@/lib/constants/builtinViews";
import { getActiveFiltersFromProject, getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import {
  applyVisibleSectionOrder,
  getSectionId,
  reorderSectionsWithRank,
} from "@/utils/helperFunctions/Views/ColumnReorderHelper";
import globalConstants from "@/lib/constants";
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { useBoardStartup } from "@/lib/contexts/boardStartupContext";
import useMoveTaskToSection from "@/hooks/MultiPages/useMoveTaskToSection";
import { useAssignTaskUser } from "@/hooks/Task Detail/useAssignTaskUser";
import axiosClient from "@/utils/axiosClient";
import {
  KanbanBulkSelectionProvider,
} from "@/lib/contexts/Kanban/BulkSelectionContext";
import KanbanBulkActionBar from "./KanbanBulkActionBar";
import { useBoardEdgeAutoScroll } from "@/hooks/Kanban/useBoardEdgeAutoScroll";
import { useBoardScrollRestore } from "@/hooks/Kanban/useBoardScrollRestore";
import { useMobileBoardZoom } from "@/hooks/Kanban/useMobileBoardZoom";
import { useLongPressTouchSensor } from "@/hooks/Kanban/useLongPressTouchSensor";
import { BOARD_OVERVIEW_SCALE } from "@/hooks/Kanban/mobileBoardGestures";

const BOARD_SENSORS = [
  useMouseSensor,
  useKeyboardSensor,
  useLongPressTouchSensor,
];

const HomePage = ({
  currentUser,
  _currentProject,
  handleBoardChange,
  _sections,
  filteredSections,
  _activeSortingMode,
  inlineConnectCard,

}:
  {
    currentUser: IUser,
    _currentProject: IProject,
    handleBoardChange: (index: number, sectionsFromCallback: ISection[]) => void,
    _sections: ISection[],
    filteredSections: ISection[],
    _activeSortingMode: TBoardSortingViewMode,
    inlineConnectCard?: React.ReactNode,
  }

) => {
  const { secondaryStartupEnabled } = useBoardStartup();
  const archiveFocusOrder = useFlag(HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG);
  const store = useStore();
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
  const getFocusedTaskId = useCallback(
    () => store.get(activeItemAtom),
    [store],
  );
  useRevealFocusOnViewSwitch({
    projectId: _currentProject.id,
    viewId: getActiveBoardViewId(_currentProject, activeBuiltinViews),
    getFocusedTaskId,
  });
  const { sections, setSections, sectionsToDisplay, setSectionsToDisplay, lastgClick, onDragEndHandler, spaceship } = useHandleKeyDownOperations({ initialSections: _sections, handleBoardChange, filteredSections })
  const { keyword: searchKeyword, projectId: searchProjectId } =
    useRecoilValue(boardSearchAtom);
  const runningOnly = useRecoilValue(kanbanRunningOnlyAtom);
  const { timers: runningTimers, timerDataReady } = useBoardRunningTimers(
    _currentProject.id,
    { enabled: secondaryStartupEnabled },
  );
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["blocked-by-person-filter", _currentProject.id],
    _currentProject.id,
    undefined,
    { enabled: secondaryStartupEnabled },
  );
  const membersById = useMemo(() => {
    const members = new Map<number, IUser>();
    const owner = membersAndOwner?.owner as IUser | undefined;
    if (owner) members.set(owner.id, owner);
    for (const member of membersAndOwner?.members ?? []) {
      if (member.user) members.set(member.user.id, member.user);
    }
    return members;
  }, [membersAndOwner]);
  const displaySections = useMemo(() => {
    const kw = searchProjectId === _currentProject.id ? searchKeyword.trim() : "";
    const searchedSections = kw
      ? getAppliedSearchedTasks(sectionsToDisplay, kw)
      : sectionsToDisplay;

    if (
      !runningOnly ||
      !_currentProject.timeTrackingEnabled ||
      !timerDataReady
    ) {
      return searchedSections;
    }

    return searchedSections.map((section) => ({
      ...section,
      items: (section.items ?? []).filter((task) => runningTimers.has(task.id)),
    }));
  }, [
    _currentProject.id,
    _currentProject.timeTrackingEnabled,
    runningOnly,
    runningTimers,
    timerDataReady,
    sectionsToDisplay,
    searchKeyword,
    searchProjectId,
  ]);
  const hiddenSectionIndexes = useMemo(() => {
    const kw = searchProjectId === _currentProject.id ? searchKeyword.trim() : "";
    const filtering =
      !!kw ||
      (runningOnly && _currentProject.timeTrackingEnabled && timerDataReady);
    if (!filtering) return new Set<number>();
    return new Set(
      displaySections
        .map((section, index) => ((section.items ?? []).length ? -1 : index))
        .filter((index) => index >= 0)
    );
  }, [
    displaySections,
    searchKeyword,
    searchProjectId,
    _currentProject.id,
    _currentProject.timeTrackingEnabled,
    runningOnly,
    timerDataReady,
  ]);
  const visibleSectionCount = displaySections.length - hiddenSectionIndexes.size;
  const mobileBoardOverviewWidth =
    visibleSectionCount * 300 + Math.max(0, visibleSectionCount - 1) * 12;
  const bulkSelectionItems = useMemo(
    () =>
      displaySections.flatMap((section) => {
        const sectionId = section.sectionId ?? section.id;
        return (section.items ?? []).map((task) =>
          task.sectionId == null && sectionId != null
            ? { ...task, sectionId }
            : task,
        );
      }),
    [displaySections],
  );
  const { performActionAndStoreUndoData, undoAction } = useUndoContext();
  const { updateTaskInCache, removeFromListWithStatus, mutationHandler, getProjectIdxAndAllData, updateActiveItemAndItemInView, deleteTodo: registerArchiveUndo } = UpdateKanban();
  const moveTaskToSection = useMoveTaskToSection();
  const assignTaskUser = useAssignTaskUser();
  const {
    showDeleteTaskModal,
    toggleDeleteModal,
    taskInfo,
    tasksToDelete,
  } = useKanbanModalStatesContext();
  const { archiveNotificationGetter } = useGlobalFocusHandler()
  const { currentSetting } = useSubTask()
  const queryClient = useQueryClient();
  const { setBoardColumnsViewAPI } = useKanbanViews(_currentProject);
  useBoardRealtime(_currentProject?.id, {
    accountId: currentUser.id,
  });
  const [loading, setLoading] = useState<boolean>(false)
  const [renderAllTasks, setRenderAllTasks] = useState(false);

  const showCommands = useRecoilValue(showCommandsAtom);
  const showArchivedOnBoard = useShowArchivedOnBoard(_currentProject);
  const _mbl = useContext(MobileViewContext);
  const boardZoomedOut = useMobileBoardZoom(_mbl, _currentProject.id);
  const mobileBoardZoomedOut = _mbl && boardZoomedOut;
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !_mbl;
  const progressiveRendering = useMemo(
    () =>
      displaySections.reduce(
        (taskCount, section) => taskCount + (section.items?.length ?? 0),
        0,
      ) >= LARGE_BOARD_PROGRESSIVE_RENDER_THRESHOLD,
    [displaySections],
  );
  const isApple = useDeviceContext()
  const latestRef = useRef({
    currentUser,
    _currentProject,
    _sections,
    archiveFocusOrder,
    sections,
    displaySections,
    updateTaskInCache,
    removeFromListWithStatus,
    mutationHandler,
    getProjectIdxAndAllData,
    updateActiveItemAndItemInView,
    archiveNotificationGetter,
    undoAction,
    queryClient,
  });
  latestRef.current = {
    currentUser,
    _currentProject,
    _sections,
    archiveFocusOrder,
    sections,
    displaySections,
    updateTaskInCache,
    removeFromListWithStatus,
    mutationHandler,
    getProjectIdxAndAllData,
    updateActiveItemAndItemInView,
    archiveNotificationGetter,
    undoAction,
    queryClient,
  };
  const spaceshipRef = useRef(spaceship);
  spaceshipRef.current = spaceship;
  const onDragEndHandlerRef = useRef(onDragEndHandler);
  onDragEndHandlerRef.current = onDragEndHandler;
  const moveItemUp = useCallback(
    (sectionId: number, itemId: number) => spaceshipRef.current.shift.up(sectionId, itemId),
    []
  );
  const moveItemDown = useCallback(
    (sectionId: number, itemId: number) => spaceshipRef.current.shift.down(sectionId, itemId),
    []
  );
  const moveItemLeft = useCallback(
    (sectionId: number, itemId: number) => spaceshipRef.current.shift.left(sectionId, itemId),
    []
  );
  const moveItemRight = useCallback(
    (sectionId: number, itemId: number) => spaceshipRef.current.shift.right(sectionId, itemId),
    []
  );
  const handleColumnDragEnd = useCallback(async (result: DropResult) => {
    if (
      !result.destination ||
      result.source.index === result.destination.index
    ) return;

    try {
      const activeColumns = getActiveColumnsViewFromProject(_currentProject);
      const visibleSections = displaySections.map((section) => ({
        ...section,
        ranking: activeColumns.find(
          (column) => getSectionId(column) === getSectionId(section)
        )?.ranking,
      }));
      const { reorderedSections, updatedSection, ranking } =
        reorderSectionsWithRank(
          visibleSections,
          result.source.index,
          result.destination.index
        );
      const updatedSectionId = getSectionId(updatedSection);
      if (updatedSectionId === undefined) return;

      const reorderLocalSections = (currentSections: ISection[]) => {
        const currentById = new Map(
          currentSections.map((section) => [getSectionId(section), section])
        );
        const reorderedCurrentSections = reorderedSections.map((section) => ({
          ...currentById.get(getSectionId(section))!,
          ranking: section.ranking,
        }));
        return applyVisibleSectionOrder(currentSections, reorderedCurrentSections);
      };

      setSections(reorderLocalSections);
      setSectionsToDisplay(reorderLocalSections);

      const reorderedVisibleColumns = reorderedSections.map((section) => {
        const activeColumn = activeColumns.find(
          (column) => getSectionId(column) === getSectionId(section)
        );
        return getSectionId(section) === updatedSectionId
          ? { ...(activeColumn ?? section), ranking }
          : activeColumn ?? section;
      });
      const updatedColumns = applyVisibleSectionOrder(
        activeColumns,
        reorderedVisibleColumns
      );
      queryClient.setQueryData(
        [
          globalConstants.GetAllManageColumnsPrefixKey,
          _currentProject.id,
          currentUser.id,
        ],
        updatedColumns
      );
      try {
        await writeSection({
          userId: currentUser.id,
          sectionId: updatedSectionId,
          newSection: { ranking },
        });
        setBoardColumnsViewAPI(_currentProject, updatedColumns);
      } catch (persistError) {
        console.log("🚀 ~ handleColumnDragEnd ~ persist failed:", persistError);
        toast.error("Column order could not be saved");
      }
    } catch (error) {
      console.log("🚀 ~ handleColumnDragEnd ~ error:", error);
    }
  }, [
    _currentProject,
    currentUser.id,
    displaySections,
    queryClient,
    setBoardColumnsViewAPI,
    setSections,
    setSectionsToDisplay,
  ]);

  const { start: startEdgeAutoScroll, stop: stopEdgeAutoScroll } = useBoardEdgeAutoScroll();

  const handleDragStart = useCallback((start: DragStart) => {
    if (start.type === "COLUMN") return;
    if (_mbl) navigator.vibrate?.(10);
    startEdgeAutoScroll();
  }, [_mbl, startEdgeAutoScroll]);

  const handleDragEnd = useCallback((result: DropResult) => {
    stopEdgeAutoScroll();
    setRenderAllTasks(false);
    if (result.type === "COLUMN") {
      handleColumnDragEnd(result);
      return;
    }
    onDragEndHandlerRef.current(result);
  }, [handleColumnDragEnd, stopEdgeAutoScroll]);

  const handleBeforeCapture = useCallback(
    ({ draggableId }: { draggableId: string }) => {
      if (progressiveRendering && draggableId.startsWith("task-")) {
        setRenderAllTasks(true);
      }
    },
    [progressiveRendering],
  );

  const updateParentTask = useCallback((
    parentTask: ITask,
    subTaskId: number,
    status: IStatus
  ) => {
    const {
      _currentProject,
      getProjectIdxAndAllData,
      updateTaskInCache,
    } = latestRef.current;
    console.log("🚀 ~ updateParentTask: called with", parentTask, status);
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(
      _currentProject?.id
    );
    if (
      !allData ||
      !allData.updatedProjects ||
      projectToUpdateIndex === undefined ||
      projectToUpdateIndex === -1
    )
      return;
    const projectToUpdate = allData?.updatedProjects[projectToUpdateIndex];
    let updatedSubTasks: ITask[];
    if (projectToUpdateIndex > -1) {
      projectToUpdate?.sections?.forEach(section => {
        if (section.sectionId === parentTask.sectionId) {
          section.items.forEach((task) => {
            if (task.id === parentTask.id) {
              const subTasks = [...task.subTasks]
              if (status === "Archive") {
                updatedSubTasks = subTasks.map((subtask) => {
                  if (subtask.id === subTaskId) {
                    const taskreturn = {
                      ...subtask,
                      ...{ status: status },
                    };
                    return taskreturn
                  }
                  return subtask;
                });
              } else {
                updatedSubTasks = subTasks.filter(
                  (task) => task.id !== subTaskId
                );
              }
            }

          });
        }
      });
    }
    updateTaskInCache(
      { subTasks: updatedSubTasks! },
      parentTask.id,
      _currentProject.id,
      parentTask.sectionId,
      _currentProject
    );
  }, []);

  const markAsDone = useCallback(async (
    section: string,
    itemId: number,
    parentTask?: ITask,
  ) => {
    const {
      _sections,
      displaySections,
      archiveFocusOrder,
      sections,
      _currentProject,
      removeFromListWithStatus,
    } = latestRef.current;
    const now = new Date().getTime();
    if (lastgClick.current && now - lastgClick.current < 5000) return

    const sectionIndex = _sections.findIndex(
      (sec) => sec.section_title === section
    );
    if (parentTask) {
      updateParentTask(parentTask, itemId, 'Archive')
    }
    await removeFromListWithStatus(
      sections[sectionIndex].sectionId,
      _currentProject.id,
      itemId,
      'Archive',
      undefined,
      archiveFocusOrder ? { focusSections: displaySections } : undefined,
    )
  }, [lastgClick, updateParentTask]);

  const deleteTaskHandler = async(response: boolean) =>{
    if (!response) {
      toggleDeleteModal(false)
      setLoading(false)
      return
    }
    if(!taskInfo || !tasksToDelete) return
    console.log("🚀 ~ deleteTaskHandler ~ tasksToDelete:", tasksToDelete)
    setLoading(true)
    try {
      await deleteItem(taskInfo?.section, taskInfo?.id, taskInfo?.parentTask, tasksToDelete)
      toggleDeleteModal(false)
    } catch {
      toast.error("Unable to delete task")
    } finally {
      setLoading(false)
    }
  }

  const deleteItem = async (
    section: string,
    itemId: number,
    parentTask?: ITask,
    tasksToDelete?: number[],
  ) => {
    console.log("🚀 ~ tasksToDelete:", tasksToDelete)
    const sectionIndex = _sections.findIndex(
      (sec) => sec.section_title === section
    );
    if (parentTask) updateParentTask(parentTask, itemId, 'Deleted')
    
    await removeFromListWithStatus(sections[sectionIndex].sectionId, _currentProject.id, itemId, 'Deleted', tasksToDelete)
  };

  const updatePriority = async (sectionId: number, itemId: number) => {
    const priority_data: IPriority | undefined = queryClient.getQueryData(["priority", itemId])
    const taskToReturn = { priority: priority_data }
    toast("Priority updated to " + priority_data?.Priority_Value)
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  };

  const updateEstimate = async (sectionId: number, itemId: number) => {
    const estimate_data: IEstimate | undefined = queryClient.getQueryData(["estimate", itemId])
    const taskToReturn = { estimate: estimate_data }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)
    estimate_data?.estimate_value && toast("Estimate updated to " + estimate_data?.estimate_value)
  };

  const updateAssignees = useCallback(async (sectionId: number, itemId: number, assignees: any) => {
    const {
      currentUser,
      _currentProject,
      updateTaskInCache,
    } = latestRef.current;
    await globalAPIHandlers.archiveTaskNotification(itemId, currentUser.id)
    const taskToReturn = { assignees: assignees }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  }, [])


  async function deleteTodo(displayText: string, dataBeforeDeletion: any) {
    performActionAndStoreUndoData(dataBeforeDeletion, displayText, undoHandler);
  }

  const undoHandler = async (data: any, toastId: string) => {
    if (Array.isArray(data.taskIds)) return data.undoHandler(data, data.toastId);
    await undoAction("UNDO_REMOVE", data)
    toast.dismiss(toastId);
    queryClient.refetchQueries({ queryKey: ["projectsAll"] })


  }

  const undoInboxArchive = useCallback(async (dataBeforeDeletion: any) => {
    latestRef.current.archiveNotificationGetter(dataBeforeDeletion, "Notification", null)
  }, [])

  const archiveNotification = useCallback(async (sectionId: number, itemId: number) => {
    const {
      displaySections,
      sections,
      _currentProject,
      updateActiveItemAndItemInView,
      getProjectIdxAndAllData,
      mutationHandler,
    } = latestRef.current;
    const activeItem = store.get(activeItemAtom);

    const taskElement = document.getElementById(`task-${itemId}`);
    if (activeItem === itemId || taskElement?.contains(document.activeElement)) {
      const sectionIndex = displaySections.findIndex(
        (section) => section.sectionId === sectionId
      );
      const itemIndex =
        displaySections[sectionIndex]?.items.findIndex(
          (task) => task.id === itemId
        ) ?? -1;
      const nextId = nextFocusAfterRemoval(displaySections, sectionIndex, itemIndex);
      const nextSectionId = nextId
        ? displaySections.find((section) =>
            section.items.some((task) => task.id === nextId)
          )?.sectionId ?? sectionId
        : sectionId;

      updateActiveItemAndItemInView(nextId, _currentProject.id, nextSectionId);
      if (!nextId) {
        setTimeout(() => {
          const container = document.getElementById("sectionsContainer");
          container?.setAttribute("tabindex", "-1");
          container?.focus();
        }, 0);
      }
    }

    const updatedSection = sections.map((section) => {
      if (section.sectionId === sectionId) {
        const updatedItems = section.items.map((task) => {
          if (task.id === itemId) {

            const taskreturn = {
              ...task,
              notifications: [],
              _count: {
                notifications: 0,
                comments: task.totalComments || 0,
              },
            };
            task.notifications && undoInboxArchive(task.notifications[0])
            return taskreturn;
          }
          return task;
        });

        return { ...section, items: updatedItems };
      }
      return section;
    });

    toast("Notifications archived")
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)

    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;
    mutationHandler(projectToUpdateIndex, updatedSection, allData)
  }, [store, undoInboxArchive])

  const updateLabels = async (taskLabels: ITaskLabel[], sectionId: number, itemId: number) => {
    const taskToReturn = { taskLabels: taskLabels }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  }
  const updateDueDate = (dueDate: Date | undefined, sectionId: number, itemId: number) => {
    const taskToReturn = { dueDate }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  }

  const getBulkSourceSectionId = useCallback(
    (task: ITask) =>
      task.sectionId ??
      sections.find((section) =>
        section.items?.some((item) => item.id === task.id),
      )?.sectionId,
    [sections],
  );

  const archiveTaskForBulk = useCallback(
    async (task: ITask, suppressUndo = false) => {
      const sourceSectionId = getBulkSourceSectionId(task);
      if (sourceSectionId == null) throw new Error("Task column is unavailable");
      return await removeFromListWithStatus(
        sourceSectionId,
        _currentProject.id,
        task.id,
        "Archive",
        undefined,
        { suppressUndo },
      );
    },
    [
      _currentProject.id,
      getBulkSourceSectionId,
      removeFromListWithStatus,
    ],
  );

  const moveTaskForBulk = useCallback(
    async (task: ITask, destination: ISection) => {
      const sourceSectionId = getBulkSourceSectionId(task);
      const destinationSectionId = destination.sectionId ?? destination.id;
      if (sourceSectionId == null || destinationSectionId == null) {
        throw new Error("Task column is unavailable");
      }
      if (sourceSectionId === destinationSectionId) return;

      await moveTaskToSection.mutateAsync({
        projectId: _currentProject.id,
        taskId: task.id,
        ticketNumber: task.ticketNumber,
        sourceSectionId,
        destinationSectionId,
        destinationSectionTitle: destination.section_title,
      });
    },
    [
      _currentProject.id,
      getBulkSourceSectionId,
      moveTaskToSection,
    ],
  );

  const assignTaskForBulk = useCallback(
    async (task: ITask, assignee: IUser | IAgent, intent?: "assign" | "unassign" | "toggle") => {
      const updatedAssignees = await assignTaskUser(
        assignee,
        task.id,
        intent ?? "assign",
      );
      updateTaskInCache(
        { assignees: updatedAssignees },
        task.id,
        _currentProject.id,
        getBulkSourceSectionId(task),
        _currentProject,
      );
    },
    [
      _currentProject,
      assignTaskUser,
      getBulkSourceSectionId,
      updateTaskInCache,
    ],
  );

  const labelTaskForBulk = useCallback(
    async (task: ITask, label: ILabel) => {
      const hasLabel = task.taskLabels?.some(
        (taskLabel) => taskLabel.labelId === label.id,
      ) ?? false;
      const shouldAssign = !label.check;
      if (hasLabel === shouldAssign) return;

      const response = await axiosClient.post("/labels/assignLabel", {
        taskId: task.id,
        labelId: label.id,
      });
      updateTaskInCache(
        { taskLabels: response.data },
        task.id,
        _currentProject.id,
        getBulkSourceSectionId(task),
        _currentProject,
      );
    },
    [
      _currentProject,
      getBulkSourceSectionId,
      updateTaskInCache,
    ],
  );

  const getTaskOptions = useCallback((currentTask: ITask) => {
    const taskProject = currentTask.project ??
      (currentTask.projectId === _currentProject.id ? _currentProject : undefined)
    return {
          isApple,
          isArchived: currentTask?.status === "Archive",
          hasNotifications: !!(currentTask?._count?.notifications &&
            currentTask?._count?.notifications > 0),
          isKanban: true,
          hasSubtasks: !!(currentTask?.subTasks && currentTask?.subTasks.length > 0),
          hasParent: !!currentTask?.parentTaskId,
          isStarred: !!(currentTask?.savedContent && currentTask?.savedContent?.length > 0),
          timeTrackingEnabled: !!taskProject?.timeTrackingEnabled
      }
  }, [_currentProject, isApple])

  const createContextOptionsForHTC = useCallback((): IAllCommands => {
    let currentTask: ITask | undefined;
    const activeItem = store.get(activeItemAtom);

    if(activeItem) {
      currentTask = sectionsToDisplay
      .flatMap(section => section.items)
      .find(item => item.id === activeItem);
    }

    return {
      context: currentTask ? "Task" : "Kanban",
      task: currentTask ? {
        taskId: currentTask.id,
        projectId: currentTask.projectId,
        sectionId: currentTask.sectionId ?? null,
      } : undefined,
      showArchivedOnBoard,
      boardZoomedOut: _mbl ? boardZoomedOut : undefined,
      taskOptions: currentTask ? { ...getTaskOptions(currentTask) } : undefined,
      commentOptions: undefined
    }
  }, [_mbl, boardZoomedOut, getTaskOptions, sectionsToDisplay, showArchivedOnBoard, store]);

  const tasksHydrated = Array.isArray(_currentProject?.tasks)
  useBoardScrollRestore(_mbl, tasksHydrated);
  const isEmptyBoard = tasksHydrated && sectionsToDisplay.length === 0

  const emptyStateDetection = isEmptyBoard
    ? detectEmptyBoardState(_sections, filteredSections, _currentProject)
    : null;

  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const connectOverlayEnabled = useFlag(HTPR_7550_CONNECT_OVERLAY_FLAG);
  const connectOverlay = useConnectAgentOverlay(_currentProject.id, currentUser.id);
  const firstTaskPointerEnabled = useFlag(HTPR_7549_FIRST_TASK_POINTER_FLAG);
  const boardCardDataOnce = useFlag(HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG);
  const pointerTaskIds = useMemo(() => {
    if (!firstTaskPointerEnabled || (_currentProject.tasks?.length ?? 0) > 1) return null;
    const ids = new Set((_currentProject.tasks ?? []).map((task) => task.id));
    for (const section of sections) {
      if ((section.items?.length ?? 0) > 1) return null;
      for (const task of section.items ?? []) {
        ids.add(task.id);
        if (ids.size > 1) return null;
      }
    }
    return Array.from(ids);
  }, [firstTaskPointerEnabled, _currentProject.tasks, sections]);
  const pointerFiltered = !firstTaskPointerEnabled || Boolean(
    getActiveFiltersFromProject(_currentProject).addedFilters?.length ||
    (searchProjectId === _currentProject.id && searchKeyword.trim()) ||
    runningOnly ||
    getActiveBoardViewId(_currentProject, activeBuiltinViews)?.startsWith("builtin:")
  );

  const overlaySectionId = connectOverlay.sectionId;
  const connectOverlayActive = connectOverlayEnabled && composeEnabled && connectOverlay.open && !!overlaySectionId && tasksHydrated && secondaryStartupEnabled &&
    Number(_currentProject.ownerId) === currentUser.id && !pointerFiltered && pointerTaskIds !== null &&
    displaySections?.some((section, index) => (section.sectionId ?? section.id) === overlaySectionId && !hiddenSectionIndexes.has(index)) === true;

  const renderSections = (archivedTasks?: ITask[]) =>
    displaySections && displaySections.map((sec, index) => (
              <Draggable
                key={`section-${sec.sectionId ?? index}`}
                draggableId={`column-${sec.sectionId ?? sec.id}`}
                index={index}
                isDragDisabled={hiddenSectionIndexes.size > 0 || mobileBoardZoomedOut}
              >
              {(provided) => (<Section
                archiveNotification={archiveNotification}
                updateAssignees={updateAssignees}
                moveItemUp={moveItemUp}
                moveItemDown={moveItemDown}
                moveItemLeft={moveItemLeft}
                moveItemRight={moveItemRight}
                markAsDone={markAsDone}
                index={index}
                section={sec}
                hiddenBySearch={hiddenSectionIndexes.has(index)}
                draggableProps={provided.draggableProps}
                dragHandleProps={provided.dragHandleProps}
                draggableInnerRef={provided.innerRef}
                currentSetting={currentSetting}
                activeSortingMode={_activeSortingMode}
                archivedTasks={archivedTasks}
                showArchivedOnBoard={showArchivedOnBoard}
                membersById={membersById}
                progressiveRendering={progressiveRendering}
                renderAllTasks={renderAllTasks}
                dragDisabled={mobileBoardZoomedOut}
                project={_currentProject}
                firstTaskPointer={firstTaskPointerEnabled ? (
                  <FirstTaskPointer
                    projectId={_currentProject.id}
                    sectionId={sec.sectionId ?? sec.id!}
                    sectionIndex={index}
                    taskIds={pointerTaskIds}
                    ready={tasksHydrated && secondaryStartupEnabled}
                    writable={Number(_currentProject.ownerId) === currentUser.id}
                    filtered={pointerFiltered || hiddenSectionIndexes.has(index) || (connectOverlayEnabled && connectOverlay.blocked)}
                  />
                ) : null}
              />)}
              </Draggable>
            ));


  const board = (
    <KanbanBulkSelectionProvider
      items={bulkSelectionItems}
      onArchiveTask={archiveTaskForBulk}
      onArchiveUndo={(tasks) => registerArchiveUndo(
        `Undo archive of ${tasks.length} tasks`,
        { taskIds: tasks.map((task) => task.id), projectId: _currentProject.id },
      )}
      onMoveTask={moveTaskForBulk}
      onAssignTask={assignTaskForBulk}
      onLabelTask={labelTaskForBulk}
    >
      <>
      {!connectOverlayActive && inlineConnectCard}
      <span
        data-board-id={_currentProject.id}
        data-board-tasks-hydrated={tasksHydrated ? "true" : "false"}
        hidden
      />
      <DragDropContext
        enableDefaultSensors={false}
        sensors={BOARD_SENSORS}
        onBeforeCapture={handleBeforeCapture}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {isEmptyBoard && emptyStateDetection ? (
          <BoardEmptyState detection={emptyStateDetection} />
        ) : (
          <Droppable
            droppableId="board-columns"
            direction="horizontal"
            type="COLUMN"
          >
          {(provided) => <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            id="sectionsContainer"
            style={mobileBoardZoomedOut ? {
              zoom: BOARD_OVERVIEW_SCALE,
              alignSelf: "flex-start",
              width: mobileBoardOverviewWidth,
              maxWidth: "none",
              height: `${100 / BOARD_OVERVIEW_SCALE}%`,
              maxHeight: `${100 / BOARD_OVERVIEW_SCALE}%`,
            } : undefined}
            className={`
              ${_mbl ?
                "flex gap-[12px] max-w-[98%] min-w-[90%]"
                : `gap-[16px] w-[97%] scrollbar-none mx-auto grid grid-flow-col ${appShellRailOn ? "auto-cols-[minmax(280px,535px)]" : "auto-cols-[minmax(322px,535px)]"} ${sectionsToDisplay && sectionsToDisplay.length===3 ? '[justify-content:safe_center]' : 'justify-start'}`
              } sectionsContainer
              `}
          >
          {showArchivedOnBoard ? (
            <ArchivedTasksOnBoard projectId={_currentProject.id}>
              {renderSections}
            </ArchivedTasksOnBoard>
          ) : (
            renderSections()
          )}
          {provided.placeholder}
          </div>}
          </Droppable>
        )}
      </DragDropContext>
      <KanbanBulkActionBar />
      {showCommands.show && (
        <React.Suspense fallback={null}>
          <HypertasksCommands contextOptions={createContextOptionsForHTC()} />
        </React.Suspense>
      )}
      {connectOverlayActive && (
          <ConnectAgentOverlay key={`${currentUser.id}:${_currentProject.id}`} sectionId={overlaySectionId} onClose={connectOverlay.close} />
        )}
      {showDeleteTaskModal && tasksToDelete && <ConfirmTaskDelete confirmDelete={deleteTaskHandler} content={`Clicking confirm will delete this task${tasksToDelete?.length>1?' and its associated sub-tasks':''}! Task can be recovered within 30 days.`} loading={loading}/>}
      </>
    </KanbanBulkSelectionProvider>
  );
  return (
    boardCardDataOnce ? (
      <BoardCardDataProvider project={_currentProject} enabled>{board}</BoardCardDataProvider>
    ) : (
      <BoardCardDataProvider project={_currentProject} enabled={false}>{board}</BoardCardDataProvider>
    )
  );
};

const ArchivedTasksOnBoard = ({
  projectId,
  children,
}: {
  projectId: number;
  children: (archivedTasks: ITask[]) => React.ReactNode;
}) => {
  const { data: archivedTasks = [] } = useGetArchivedTasksOnBoard(
    projectId,
    true
  );

  return <>{children(archivedTasks)}</>;
};

export default HomePage;
