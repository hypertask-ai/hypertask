/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { useStore } from "jotai";
import Section, { LARGE_BOARD_PROGRESSIVE_RENDER_THRESHOLD } from "../KanbanSectionComponents/section";
// const Section = dynamic(() => {return import("../components/section")})
const HypertasksCommands = React.lazy(() => import("../../../commands"));
import {
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
// const DragDropContext = dynamic(() => import("@hello-pangea/dnd").then(x => x.DragDropContext));
import useHandleKeyDownOperations from "@/hooks/Homepage/useHandleKeyDownOperations";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
// import useFilters from "@/hooks/Homepage/Filters/useFilters";
import useSubTask from "@/hooks/SubTask/useSubTask";
import ConfirmTaskDelete from "@/components/Modals/confirmDeleteModals/confirmtTaskDelete";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import BoardEmptyState from "./BoardEmptyState";
import { detectEmptyBoardState } from "@/utils/helperFunctions/Views/BoardEmptyStateHelper";
import { getAppliedSearchedTasks } from "@/utils/helperFunctions/Views/SearchFilterHelperFunction";
import { boardSearchAtom } from "@/store";
import { useGetArchivedTasksOnBoard } from "@/hooks/Homepage/useGetArchivedTasksOnBoard";
import { useShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import { useBoardRealtime } from "@/hooks/realtime/useBoardRealtime";
import { nextFocusAfterRemoval } from "@/utils/helperFunctions/focusAfterRemoval";
import axios from "axios";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
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

}:
  {
    currentUser: IUser,
    _currentProject: IProject,
    handleBoardChange: (index: number, sectionsFromCallback: ISection[]) => void,
    _sections: ISection[],
    filteredSections: ISection[],
    _activeSortingMode: TBoardSortingViewMode,
  }

) => {
  const { secondaryStartupEnabled } = useBoardStartup();
  const store = useStore();
  const { sections, setSections, sectionsToDisplay, setSectionsToDisplay, lastgClick, onDragEndHandler, spaceship } = useHandleKeyDownOperations({ initialSections: _sections, handleBoardChange, filteredSections })
  // Ctrl+F search filters at render off the Recoil keyword, so it survives
  // navigating into a task and back (the board unmounts, the atom does not).
  // ponytail: render-only filter; keyboard-nav still walks the unfiltered set,
  // upgrade if arrow-nav-through-search-results is ever needed.
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
  // A column with no match is noise while searching, so it is hidden with CSS
  // rather than dropped from displaySections: drag-and-drop and column
  // navigation resolve columns by their position in this array, and compacting
  // it moves cards into the wrong column (HTPR-4543).
  // Same for the running-timer filter: it empties most columns, and scrolling
  // past a wall of empty lanes to reach the one card is the whole complaint
  // (HTPR-4716).
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
  const { updateTaskInCache, removeFromListWithStatus, mutationHandler, getProjectIdxAndAllData, updateActiveItemAndItemInView } = UpdateKanban();
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
    enabled: secondaryStartupEnabled,
  });
  const [loading, setLoading] = useState<boolean>(false)
  const [renderAllTasks, setRenderAllTasks] = useState(false);

  const showCommands = useRecoilValue(showCommandsAtom);
  const showArchivedOnBoard = useShowArchivedOnBoard(_currentProject);
  const _mbl = useContext(MobileViewContext);
  const boardZoomedOut = useMobileBoardZoom(_mbl);
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
      // Ranking first, view second. The board renders by Section.ranking, so
      // saving the view before the ranking left the two disagreeing whenever
      // the ranking write failed: the view kept the new order, the board kept
      // the old one, and the column snapped back on reload (HTPR-5047).
      try {
        await axios.post(`/api/section/update`, {
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

  // Columns already auto-scroll: the board scroller is their droppable's own
  // scroll container. Only card drags need the manual edge scroll (HTPR-5546).
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
        // hello-pangea wraps this responder in ReactDOM.flushSync. Progressive
        // placeholders are enabled only after the Task module has loaded, so
        // every real card commits before drag dimensions are collected.
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
      sections,
      _currentProject,
      removeFromListWithStatus,
    } = latestRef.current;
    const now = new Date().getTime();
    if (lastgClick.current && now - lastgClick.current < 5000) return

    const sectionIndex = _sections.findIndex(
      (sec) => sec.section_title === section
    );
    // deleteTodo("Undo task archive", { id: itemId, section: section, status: "Archive" })
    if (parentTask) {
      updateParentTask(parentTask, itemId, 'Archive')
    }
    await removeFromListWithStatus(sections[sectionIndex].sectionId, _currentProject.id, itemId, 'Archive')
  }, [lastgClick, updateParentTask]);

  //Originally delete task modal was in task.tsx. But that caused problems when we wanted to wait for the modal
  //to remain open until all the subtasks were deleted.
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

  // shift + #
  const deleteItem = async (
    section: string,
    itemId: number,
    parentTask?: ITask,
    tasksToDelete?: number[],
  ) => {
    console.log("🚀 ~ tasksToDelete:", tasksToDelete)
    // ========> RUN THE DELETE API
    // ========> DISPLAY AN UNDO BUTTON, UPON CLICKING IT, FIRST BRING IT BACK TO THE UI THEN RUN THE undoAction that will also run an api
    const sectionIndex = _sections.findIndex(
      (sec) => sec.section_title === section
    );
    //  const hasSubtasks = subTasks && subTasks.length > 0 ? true : false
    // if(!hasSubtasks) deleteTodo("Undo task delete", { id: itemId, section: section, status: "Deleted" })
    if (parentTask) updateParentTask(parentTask, itemId, 'Deleted')
    
    await removeFromListWithStatus(sections[sectionIndex].sectionId, _currentProject.id, itemId, 'Deleted', tasksToDelete)
  };



  // [p] for priority updating
  const updatePriority = async (sectionId: number, itemId: number) => {
    // await queryClient.prefetchQuery([["priority",itemId]])

    const priority_data: IPriority | undefined = queryClient.getQueryData(["priority", itemId])
    // console.log("🚀 ~ updatePriority ~ priority_data:", priority_data)
    // console.log("🚀 ~ updatedSection ~ sectionId:", sectionId)
    const taskToReturn = { priority: priority_data }
    toast("Priority updated to " + priority_data?.Priority_Value)
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  };



  // [s] for size
  const updateEstimate = async (sectionId: number, itemId: number) => {
    // await queryClient.prefetchQuery([["priority",itemId]])

    const estimate_data: IEstimate | undefined = queryClient.getQueryData(["estimate", itemId])
    const taskToReturn = { estimate: estimate_data }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)
    estimate_data?.estimate_value && toast("Estimate updated to " + estimate_data?.estimate_value)
  };

  // [a] for assigning and unassigning
  const updateAssignees = useCallback(async (sectionId: number, itemId: number, assignees: any) => {
    const {
      currentUser,
      _currentProject,
      updateTaskInCache,
    } = latestRef.current;
    await globalAPIHandlers.archiveTaskNotification(itemId, currentUser.id)
    // router.refresh()
    const taskToReturn = { assignees: assignees }
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  }, [])

  // this is basically the code that contains toast element that contains the deleted element. 
  // when you click undo on the toast notification, it runs undoHandler

  async function deleteTodo(displayText: string, dataBeforeDeletion: any) {
    // Make the necessary API call to delete the todo using Prisma

    // Store the necessary information for undo
    // performActionAndStoreUndoData(dataBeforeDeletion);
    performActionAndStoreUndoData(dataBeforeDeletion, displayText, undoHandler);
  }

  // ============== task archive/ delete undo handler
  const undoHandler = async (data: any, toastId: string) => {
    //  first you need to bring the item back in its place.
    // then you need to run the api call so there is no render blocking. 
    await undoAction("UNDO_REMOVE", data)
    // router.refresh()
    toast.dismiss(toastId);  // Dismiss the toast here
    queryClient.refetchQueries({ queryKey: ["projectsAll"] })


  }

  // ================= UNDO ARCHIVE INBOX NOTIFICATION =============== 
  const undoInboxArchive = useCallback(async (dataBeforeDeletion: any) => {
    // Make the necessary API call to delete the todo using Prisma
    // Store the necessary information for undo
    latestRef.current.archiveNotificationGetter(dataBeforeDeletion, "Notification", null)
    // performActionAndStoreUndoData(dataBeforeDeletion,"Undo archive", undoHandler);
  }, [])

  // [e] for archiving notification
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
    // await globalAPIHandlers.archiveTaskNotification(itemId, currentUser.id)

    // router.refresh()
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
        // console.log("🚀 ~ updatedSection ~ section.id:", section.id)
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
            // console.log("🚀 ~ updatedItems ~ taskreturn:", taskreturn)
            return taskreturn;
          }
          return task;
        });

        // Return the updated section with the new items array
        return { ...section, items: updatedItems };
      }
      return section;
    });
    // console.log("🚀 ~ updatedSection ~ updatedSection:", updatedSection)
    // setSections(updatedSection)

    toast("Notifications archived")
    // mutationHandler(updatedSection)
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)

    // if (!allData || !projectToUpdateIndex) return;
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;
    mutationHandler(projectToUpdateIndex, updatedSection, allData)
  }, [store, undoInboxArchive])

  // [l] for labels
  const updateLabels = async (taskLabels: ITaskLabel[], sectionId: number, itemId: number) => {
    const taskToReturn = { taskLabels: taskLabels }
    // updateTaskInCache(taskToReturn,itemId,_currentProject.id,sectionId)
    updateTaskInCache(taskToReturn, itemId, _currentProject.id, sectionId, _currentProject)

  }
  const updateDueDate = (dueDate: Date | undefined, sectionId: number, itemId: number) => {
    const taskToReturn = { dueDate }
    // updateTaskInCache(taskToReturn,itemId,_currentProject.id,sectionId)
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
    async (task: ITask) => {
      const sourceSectionId = getBulkSourceSectionId(task);
      if (sourceSectionId == null) throw new Error("Task column is unavailable");
      await removeFromListWithStatus(
        sourceSectionId,
        _currentProject.id,
        task.id,
        "Archive",
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

  // Detect empty board state, but only once this board's tasks have actually
  // loaded. Since getAll ships boards without tasks (HTPR-3811), tasks is
  // undefined during the hydration window; treating that as "empty" flashed the
  // remove-filters / create-task prompt before the real board rendered.
  const tasksHydrated = Array.isArray(_currentProject?.tasks)
  const isEmptyBoard = tasksHydrated && sectionsToDisplay.length === 0

  const emptyStateDetection = isEmptyBoard
    ? detectEmptyBoardState(_sections, filteredSections, _currentProject)
    : null;

  const renderSections = useCallback((archivedTasks?: ITask[]) =>
    displaySections && displaySections.map((sec, index) => (
              <Draggable
                key={`section-${sec.sectionId ?? index}`}
                draggableId={`column-${sec.sectionId ?? sec.id}`}
                index={index}
                // Hidden columns keep their slot in the drag order, so a drop
                // could reorder onto one you cannot see. Reordering columns
                // mid-search is not a thing anyone wants anyway.
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
              />)}
              </Draggable>
            )), [
              _activeSortingMode,
              archiveNotification,
              mobileBoardZoomedOut,
              currentSetting,
              displaySections,
              hiddenSectionIndexes,
              markAsDone,
              membersById,
              moveItemDown,
              moveItemLeft,
              moveItemRight,
              moveItemUp,
              progressiveRendering,
              renderAllTasks,
              showArchivedOnBoard,
              updateAssignees,
            ]);


  return (
    <KanbanBulkSelectionProvider
      items={bulkSelectionItems}
      onArchiveTask={archiveTaskForBulk}
      onMoveTask={moveTaskForBulk}
      onAssignTask={assignTaskForBulk}
      onLabelTask={labelTaskForBulk}
    >
      <>
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
            // onKeyDown={(e)=>debouncedKeyDown(e)}
            id="sectionsContainer"
            style={mobileBoardZoomedOut ? {
              zoom: BOARD_OVERVIEW_SCALE,
              width: `${100 / BOARD_OVERVIEW_SCALE}%`,
              maxWidth: `${100 / BOARD_OVERVIEW_SCALE}%`,
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
          {/* <button onClick={()=>startTour()}>Start Tour</button> */}
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
      {showDeleteTaskModal && tasksToDelete && <ConfirmTaskDelete confirmDelete={deleteTaskHandler} content={`Clicking confirm will delete this task${tasksToDelete?.length>1?' and its associated sub-tasks':''}! Task can be recovered within 30 days.`} loading={loading}/>}
      </>
    </KanbanBulkSelectionProvider>
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
