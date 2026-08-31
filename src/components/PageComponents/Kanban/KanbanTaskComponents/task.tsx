import {
  activeItemAtom,
  inViewObjectAtom,
  isActiveTaskSelector,
  tasksPlayListAtom,
  currentProjectAtom,
  activeSectionAtom,
  showCommandsAtom,
  currentUserAtom,
} from "@/store";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { IAssignees, IProject, ITask, ITasksPlaylist } from "@/models/model";
import { taskBaseUri } from "@/utils";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";
const AssignModal = dynamic(
  () => import("../../../Modals/AssignToUser/AssignToUser")
);
const RemoveSubtaskModal = dynamic(
  () => import("@/components/Modals/SubtaskLinkingModal/RemoveSubtask")
);
const Draggable = dynamic(() =>
  import("@hello-pangea/dnd").then((x) => x.Draggable)
);
import globalConstants from "@/lib/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import { CommandMode } from "@/models/enums";
import useCopyURL from "@/hooks/General/useCopyURL";
import axios from "axios";
import { shareLinkRoute } from "@/lib/constants/APIRouteConstants";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import useFollowerKanban from "@/hooks/General/useFollowerKanban";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import {
  keyboard_shortcuts,
  matchesShortcut,
} from "@/lib/utils/keyboardShortcuts";
import { usePrefetchTaskDetail } from "@/hooks/Task Detail/usePrefetchTaskDetail";
import { useGetUserDrafts } from "@/hooks/General/useGetUserDrafts";
import KanbanTaskCard from "./KanbanTaskCard";
import type { BlockerUser } from "./BlockerChip";
import { splitAssignees } from "@/lib/assignees";
import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";
import type {
  DraggableProvided,
  DraggableStateSnapshot,
} from "@hello-pangea/dnd";

interface IProps {
  task: ITask;
  tasksPlayList: ITasksPlaylist[];
  index: number;
  sectionIndex: number;
  sectionId: number;
  project: IProject;
  currentSetting: TBoardSubtaskSetting;
  archiveNotification: (sectionId: number, itemId: number) => void;
  updateAssignees: (sectionId: number, itemId: number, assignees?: any) => void;
  moveItemUp: (sectionId: number, itemId: number) => Promise<void>;
  moveItemDown: (sectionId: number, itemId: number) => Promise<void>;
  moveItemLeft: (sectionId: number, itemId: number) => Promise<void>;
  moveItemRight: (sectionId: number, itemId: number) => Promise<void>;
  markAsDone: (section: string, itemId: number, parentTask?: ITask) => void;
  isArchivedOnBoard?: boolean;
  blockingUser?: BlockerUser;
  dragProvided?: DraggableProvided;
  dragSnapshot?: DraggableStateSnapshot;
}

const Task = ({
  task,
  tasksPlayList,
  index,
  moveItemDown,
  moveItemLeft,
  moveItemRight,
  moveItemUp,
  sectionIndex,
  markAsDone,
  project,
  sectionId,
  archiveNotification,
  updateAssignees,
  currentSetting,
  isArchivedOnBoard,
  blockingUser,
  dragProvided,
  dragSnapshot,
}: IProps) => {
  const isApple = useDeviceContext();
  const {
    selectedCount: bulkSelectedCount,
    isSelected: isBulkSelected,
    toggleTaskSelection,
    handleBulkKeyDown,
  } = useKanbanBulkSelection();
  const taskRef = useRef<HTMLDivElement | null>(null);
  const [_currentProject, ____] = useRecoilState(currentProjectAtom);
  // HTPR-3814: subscribe to a per-card selector instead of activeItemAtom so
  // moving the selection only re-renders the cards whose active-state flips,
  // not all of them.
  const isActive = useRecoilValue(isActiveTaskSelector(task.id));
  const setActiveItem = useSetRecoilState(activeItemAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const [active, setActive] = useState(false);
  const lastgClick = useRef<number | null>(null);
  const lastgPress = useRef<number | null>(null);
  const lastM_APress = useRef<number | null>(null);
  const { navigate, navigateToTask } = useHypertasksNavigate();
  const { resetShowCommands } = useHypertasksRecoilStates();
  // HTPR-3814: card modal flags used to live in a per-card ModalProvider wrapped
  // around every Task (173 providers on the heaviest board). Folded into the card
  // itself; only the active card ever opens these.
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showPriorityModal, setShowPriorityModal] = useState(false);
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [showCreateLabelModal, setShowCreateLabelModal] = useState(false);
  const [showDueDateModal, setShowDueDateModal] = useState(false);
  const toggleDueDate = () => setShowDueDateModal((prev) => !prev);

  const updateActiveItemAndItemInView = (focusTask: ITask) => {
    setActiveItem(focusTask.id);
    setInViewObject({
      taskId: focusTask.id,
      taskProjectId: focusTask.projectId,
      sectionId: focusTask.sectionId!,
      taskTicketNumber: focusTask.ticketNumber,
      sectionTitle: focusTask.section,
      taskTitle: focusTask.title,
    });
  };
  const { toggleDeleteModal, showDeleteTaskModal, showSearchTasks } =
    useKanbanModalStatesContext();
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const [movingItem, setMovingItem] = useState(false);
  const { updateTaskInCache } = UpdateKanban();
  const { starTask } = useStarAndPin();

  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const [currentUser, ______] = useRecoilState(currentUserAtom);
  const { draftTaskIds } = useGetUserDrafts(currentUser?.id);
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const [hover, setHover] = useState<boolean>(false);
  const prefetchHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const prefetchTaskDetail = usePrefetchTaskDetail({
    task,
    tasksPlayList,
    index,
    userId: currentUser?.id,
  });
  const {
    copyTitleAndTicketNumber,
    copyTicketNumber,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTaskFormattedURL,
    copyTaskURL,
  } = useCopyURL();
  const { addFollowerKanban, removeFollowerKanban } = useFollowerKanban();

  const { humanAssignees, agentAssignees } = useMemo(
    () => splitAssignees(task.assignees),
    [task.assignees],
  );

  const subTaskPlaylist = useMemo(() => {
    if (task.subTasks && task.subTasks.length > 0) {
      const parent = {
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      };
      const subtaskPlaylist = task.subTasks.map((task) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      }));
      return [parent, ...subtaskPlaylist];
    } else {
      return [];
    }
  }, [task.subTasks, task.projectId, task.uniqueIndex]);

  const toggleAssigneesModal = (_assignees?: IAssignees[], keepOpen?: boolean) => {
    if (_assignees) updateAssignees(sectionId, task.id, _assignees);
    // keepOpen mirrors the detail view: the assign menu refreshes the card
    // without closing, so several people can be toggled in one session.
    // Force-closing here made users reopen instantly and race the modal
    // into a state where clicks stop registering (HTPR-3731).
    if (!keepOpen) setShowAssignModal((prev) => !prev);
  };

  const eHandler = () => {
    if (lastgClick.current === null) {
      if (task._count?.notifications || task._count?.notifications == 0) {
        toast("This task is not in inbox");
        return;
      }
      archiveNotification(sectionId, task.id);
    }
  };

  const shareTaskHandler = async (formatted: boolean = false) => {
    const response = await axios.post(shareLinkRoute, {
      userId: currentUser?.id,
      taskId: task.id,
      projectId: task.projectId,
    });

    if (response.status === 200) {
      const data = response.data.data;
      if (formatted)
        copySharedTaskFormattedURL(data.id, task.title!, task.ticketNumber!);
      else copySharedTaskURL(data.id);
    }
  };

  const latestRef = useRef({
    active,
    isActive,
    isApple,
    movingItem,
    showAssignModal,
    showDeleteTaskModal,
    showCommands,
    task,
    sectionId,
    sectionIndex,
    tasksPlayList,
    taskRef,
    toggleDeleteModal,
    markAsDone,
    eHandler,
    setShowAssignModal,
    setShowCommands,
    setMovingItem,
    setTasksPlayList,
    navigate,
    navigateToTask,
    moveItemUp,
    moveItemDown,
    moveItemLeft,
    moveItemRight,
    copyTaskURL,
    copyTaskFormattedURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
    shareTaskHandler,
    handleStarTask,
    addFollowerHandler,
    removeFollowerKanban,
    updateActiveItemAndItemInView,
  });
  latestRef.current = {
    active,
    isActive,
    isApple,
    movingItem,
    showAssignModal,
    showDeleteTaskModal,
    showCommands,
    task,
    sectionId,
    sectionIndex,
    tasksPlayList,
    taskRef,
    toggleDeleteModal,
    markAsDone,
    eHandler,
    setShowAssignModal,
    setShowCommands,
    setMovingItem,
    setTasksPlayList,
    navigate,
    navigateToTask,
    moveItemUp,
    moveItemDown,
    moveItemLeft,
    moveItemRight,
    copyTaskURL,
    copyTaskFormattedURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
    shareTaskHandler,
    handleStarTask,
    addFollowerHandler,
    removeFollowerKanban,
    updateActiveItemAndItemInView,
  };

  const handleKeyDown = useCallback(async (e: any) => {
    const {
      isActive,
      isApple,
      movingItem,
      showAssignModal,
      showDeleteTaskModal,
      showCommands,
      task,
      sectionId,
      sectionIndex,
      tasksPlayList,
      taskRef,
      toggleDeleteModal,
      markAsDone,
      eHandler,
      setShowAssignModal,
      setShowCommands,
      setMovingItem,
      setTasksPlayList,
      navigate,
      navigateToTask,
      moveItemUp,
      moveItemDown,
      moveItemLeft,
      moveItemRight,
      copyTaskURL,
      copyTaskFormattedURL,
      copyTitleAndTicketNumber,
      copyTicketNumber,
      shareTaskHandler,
      handleStarTask,
      addFollowerHandler,
      removeFollowerKanban,
      updateActiveItemAndItemInView,
    } = latestRef.current;
    const taskElement = taskRef.current;
    if (!taskElement) return;
    // The selected card keeps its shortcuts when focus has fallen back to the
    // body — returning from the detail view, closing a modal, clicking empty
    // board space. It still renders as selected, so it must still respond.
    const focusLost =
      !document.activeElement || document.activeElement === document.body;
    const focusWithinTask = taskElement.contains(document.activeElement);
    if (
      document.activeElement !== taskElement &&
      !focusWithinTask &&
      !(isActive && focusLost)
    )
      return;

    let cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (returnIfModalOrInputActive()) return;

    if (
      movingItem ||
      showAssignModal ||
      movingItem ||
      showDeleteTaskModal ||
      showCommands.show
    )
      return;

    if (
      e.keyCode === KeyCodes.X &&
      !e.shiftKey &&
      !e.altKey &&
      !cmdControl &&
      !e.repeat
    ) {
      updateActiveItemAndItemInView(task);
    }

    if (
      handleBulkKeyDown(
        e,
        task.id,
        Boolean(lastgPress.current),
      )
    ) {
      return;
    }

    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();
    }
    // [#] for delete task
    if (e.shiftKey && e.keyCode === KeyCodes.THREE) {
      return toggleDeleteModal(true, {
        id: task.id,
        section: task.section,
        parentTask: task.parentTask,
      });
    }

    // [ctrl]+[e]
    if (e.keyCode === KeyCodes.E && cmdControl) {
      e.preventDefault();
      // A held key emits repeated keydown events. Archiving advances focus to
      // the next card and then into the next column, so those repeats would
      // otherwise archive far more than the user pressed for.
      if (!shouldRunArchiveShortcut(e)) return;
      markAsDone(task.section, task.id, task.parentTask);
    }

    // [s] for size / estimate
    if (
      e.keyCode === KeyCodes.S &&
      !e.shiftKey &&
      !cmdControl &&
      !e.altKey &&
      !lastgPress.current
    ) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.EstimateModal,
      });
    }

    // [p] for set priority
    if (
      e.keyCode === KeyCodes.P &&
      !cmdControl &&
      !e.altKey &&
      !lastgPress.current
    ) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.PriorityModal,
      });
    }

    // press [e]
    if (e.keyCode === KeyCodes.E && !cmdControl) eHandler();

    //[a]
    if (e.keyCode === KeyCodes.A && !lastgPress.current) {
      const now = new Date().getTime();
      if (lastM_APress.current && now - lastM_APress.current < 500) {
        lastM_APress.current = null;
        return;
      }
      lastM_APress.current = now;
      e.preventDefault();
      setShowAssignModal(true);
    }

    if (e.keyCode === KeyCodes.A && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("All Tasks");
      }
    }

    if (e.keyCode === KeyCodes.C && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("Calendar");
      }
    }

    if (e.keyCode === KeyCodes.S && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("Starred");
      }
    }

    if (e.keyCode === KeyCodes.P && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("Pinned");
      }
    }

    // [d]
    if (
      !lastgPress.current &&
      matchesShortcut(e, keyboard_shortcuts.dueDateModal.default, isApple)
    ) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.SetDueDate,
      });
    }

    if (e.keyCode === KeyCodes.D && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("Drafts");
      }
    }

    if (e.keyCode === KeyCodes.U && lastgPress.current) {
      const now = new Date().getTime();
      if (now - lastgPress.current < 500) {
        lastgPress.current = null;
        navigate("Scheduled");
      }
    }

    // shift + [k]
    if (
      (e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP) &&
      e.shiftKey
    ) {
      e.preventDefault();
      setMovingItem(true);
      await moveItemUp(sectionId, task.id);
      setMovingItem(false);
    }

    // shift + [j]
    if (
      (e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN) &&
      e.shiftKey
    ) {
      e.preventDefault();
      setMovingItem(true);
      await moveItemDown(sectionId, task.id);
      setMovingItem(false);
    }

    // [t] for tag
    if (e.keyCode === KeyCodes.T && !e.shiftKey) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.LabelModal,
      });
    }
    // shift + [h]
    if (
      (e.keyCode === KeyCodes.H || e.keyCode === KeyCodes.ARROW_LEFT) &&
      e.shiftKey
    ) {
      e.preventDefault();
      setMovingItem(true);
      await moveItemLeft(sectionId, task.id);
      setMovingItem(false);
    }
    // shift + [l]
    if (
      (e.keyCode === KeyCodes.L || e.keyCode === KeyCodes.ARROW_RIGHT) &&
      e.shiftKey
    ) {
      e.preventDefault();
      setMovingItem(true);
      await moveItemRight(sectionId, task.id);
      setMovingItem(false);
    }
    if (e.ctrlKey) {
      if (e.keyCode === KeyCodes.TAB) {
        e.preventDefault();
        console.log("ctrl+tab"); // chromium fullscreen (think PWA)
      }
    }

    if (e.keyCode === KeyCodes.S && cmdControl) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.ShareTaskPublic,
      });
    }

    // [m]
    if (
      e.keyCode === KeyCodes.M &&
      !cmdControl &&
      !e.shiftKey &&
      (!lastgPress.current ||
        new Date().getTime() - lastgPress.current >=
          globalConstants.gThenKeyDelay)
    ) {
      const now = new Date().getTime();
      if (lastM_APress.current && now - lastM_APress.current < 500) {
        lastM_APress.current = null;
        return;
      }
      lastM_APress.current = now;

      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.MoveToColumn,
      });
    }
    // [shift][m]
    if (e.keyCode === KeyCodes.M && e.shiftKey && !cmdControl) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.MoveTaskToBoard,
      });
    }

    // enter
    if (e.keyCode === KeyCodes.ENTER && !showCommands.show) {
      console.time("EnterPressOnTask");
      if (!task.uniqueIndex) return;
      setTasksPlayList(tasksPlayList);
      navigateToTask(task.projectId, task.uniqueIndex);
      console.timeEnd("EnterPressOnTask");
    }

    // cmd/ctrl + [m]
    if (e.keyCode === KeyCodes.M && cmdControl) {
      if (!task.uniqueIndex) return;
      setTasksPlayList(tasksPlayList);
      navigateToTask(task.projectId, task.uniqueIndex, "push", `?reply=true`);
    }

    // GG
    if (e.keyCode === KeyCodes.G && e.shiftKey) {
      const now = new Date().getTime();
      if (lastgClick.current && now - lastgClick.current < 500) {
        lastgClick.current = null;
        const tasksList = document.getElementById(
          `tasks-list-${sectionIndex}`
        )?.children;

        if (tasksList!.length > 0) {
          // @ts-ignore
          tasksList![tasksList!.length - 1].focus();
        }
        e.preventDefault();
      } else {
        lastgClick.current = now;
        setTimeout(() => {
          lastgClick.current = null;
        }, globalConstants.gThenKeyDelay); // 1000 milliseconds = 1 second
      }
    }

    //[cmdControl][shift][,]
    if (
      e.keyCode === KeyCodes.SEMICOLON &&
      cmdControl &&
      e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskURL(task.uniqueIndex, task.projectId);
    }
    //[cmdControl][,]
    if (
      (e.keyCode === KeyCodes.SEMICOLON || e.keyCode === KeyCodes.COMMA) &&
      cmdControl &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskFormattedURL(
        task.title,
        task.ticketNumber!,
        task.uniqueIndex,
        task.projectId
      );
    }

    //[cmdControl][shift][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler();
    }

    //[cmdControl][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler(true);
    }

    //[cmdControl][I]
    if (e.keyCode === KeyCodes.I && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return copyTitleAndTicketNumber(task.title, task.ticketNumber!);
    }
    //[cmdControl][i]
    if (e.keyCode === KeyCodes.I && cmdControl && e.shiftKey) {
      e.preventDefault();
      return copyTicketNumber(task.ticketNumber!);
    }

    // gg
    if (e.keyCode === KeyCodes.G && !e.shiftKey) {
      const now = new Date().getTime();
      if (lastgPress.current && now - lastgPress.current < 500) {
        lastgPress.current = null;
        const tasksList = document.getElementById(
          `tasks-list-${sectionIndex}`
        )!.children;
        if (tasksList.length > 0) {
          // @ts-ignore
          tasksList[0].focus();
        }
        e.preventDefault();
      } else {
        lastgPress.current = now;
        setTimeout(() => {
          if (lastgPress.current === now) lastgPress.current = null;
        }, globalConstants.gThenKeyDelay);
      }
    }
    // [cmd/ctrl][shift][o]
    if (e.keyCode === KeyCodes.O && e.shiftKey && cmdControl) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.CreateSubTask,
      });
    }

    // [alt][s]
    if (e.keyCode === KeyCodes.S && e.altKey && !e.shiftKey) {
      e.preventDefault();
      return handleStarTask();
    }

    // [f]
    if (e.keyCode === KeyCodes.F && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      return addFollowerHandler();
    }

    // [alt][f]
    if (e.keyCode === KeyCodes.F && e.altKey && !e.shiftKey) {
      e.preventDefault();
      return removeFollowerKanban(task.id);
    }

    // [alt][v]
    if (e.keyCode === KeyCodes.V && e.altKey && !e.shiftKey) {
      if (!task.uniqueIndex) return;
      setTasksPlayList(tasksPlayList);
      navigateToTask(task.projectId, task.uniqueIndex, "push", `?audio=true`);
    }

    if (e.keyCode === KeyCodes.F2) {
      return setShowCommands({
        show: true,
        mode: CommandMode.RenameTask,
      });
    }
  }, [handleBulkKeyDown, task.id]);

  async function addFollowerHandler() {
    return await addFollowerKanban(task.id);
  }

  async function handleStarTask() {
    const response = await starTask(task.id, task.projectId!);
    if (response.status === 200) {
      const taskToReturn = { savedContent: [{ ...response.data }] };
      updateTaskInCache(
        taskToReturn,
        task.id,
        task.projectId,
        task.sectionId,
        _currentProject
      );
      toast(`Starred Task ${task.ticketNumber?.toUpperCase()}`);
    } else {
      const taskToReturn = { savedContent: [] };
      updateTaskInCache(
        taskToReturn,
        task.id,
        task.projectId,
        task.sectionId,
        _currentProject
      );
      toast(`Unstarred Task ${task.ticketNumber?.toUpperCase()}`);
    }
  }

  const openDetail = () => {
    if (
      (!showCommands.show && showAssignModal) ||
      !project.name ||
      task.uniqueIndex === undefined
    )
      return;
    setTasksPlayList(tasksPlayList);
    navigateToTask(task.projectId, task.uniqueIndex);
  };

  // ============ toggle remove subtask modal
  const toggleRemoveSubtaskModal = async (
    refresh?: boolean,
    subTask?: ITask
  ) => {
    resetShowCommands();
    if (refresh) {
      const updatedSubTasks = task.subTasks?.filter(
        (item) => item.id !== subTask?.id
      );
      const taskToReturn = { subTasks: updatedSubTasks };
      updateTaskInCache(
        taskToReturn,
        task.id,
        task.projectId,
        task.sectionId,
        _currentProject
      );
    }
  };

  const triggerDeleteModal = () =>
    toggleDeleteModal(true, {
      id: task.id,
      section: task.section,
      parentTask: task.parentTask,
    });

  const markTaskAsDone = () =>
    markAsDone(task.section, task.id, task.parentTask);
  const archiveNotificationHandler = () =>
    archiveNotification(sectionId, task.id);

  const clearPrefetchHoverTimeout = useCallback(() => {
    if (!prefetchHoverTimeout.current) return;
    clearTimeout(prefetchHoverTimeout.current);
    prefetchHoverTimeout.current = null;
  }, []);

  const handleMouseEnter = useCallback(() => {
    setHover(true);
    clearPrefetchHoverTimeout();
    prefetchHoverTimeout.current = setTimeout(() => {
      prefetchTaskDetail();
      prefetchHoverTimeout.current = null;
    }, 80);
  }, [clearPrefetchHoverTimeout, prefetchTaskDetail]);

  const handleMouseLeave = useCallback(() => {
    setHover(false);
    clearPrefetchHoverTimeout();
  }, [clearPrefetchHoverTimeout]);

  const handleTouchStart = useCallback(() => {
    clearPrefetchHoverTimeout();
    prefetchTaskDetail();
  }, [clearPrefetchHoverTimeout, prefetchTaskDetail]);

  const handleCardFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      setActive(true);
    },
    []
  );

  const handleCardBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      setActive(false);
    },
    []
  );

  useEffect(() => {
    if (isActive && !showSearchTasks && !showCommands.show) {
      setActive(true);
      setActiveSection(sectionIndex);
      // PERT-5: follow the active item with real DOM focus, but never yank it
      // away from an open input/editor (inline edits, modals, search).
      if (!returnIfModalOrInputActive())
        document.getElementById(`task-${task.id}`)?.focus();
    } else if (
      showAssignModal ||
      showCommands.show ||
      showSearchTasks
    )
      setActive(false);
  }, [isActive, task.id, sectionIndex, showAssignModal, showSearchTasks, showCommands.show, setActiveSection]);

  useEffect(() => {
    if (active || isActive) prefetchTaskDetail();
  }, [active, isActive, prefetchTaskDetail]);

  useEffect(() => {
    return () => clearPrefetchHoverTimeout();
  }, [clearPrefetchHoverTimeout]);

  useEffect(() => {
    const taskElement = taskRef.current;
    if (!taskElement) return;

    taskElement.addEventListener("keydown", handleKeyDown);
    return () => {
      taskElement.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  // The selected card also listens at document level. It frequently has no real
  // DOM focus (returning from the detail view, closing a modal, clicking empty
  // board space), and a card-scoped listener never sees those keystrokes, so
  // [a] / [p] / [s] / [m] / [d] / [t] silently did nothing on a card that looked
  // selected. Skip events that already went through the element listener.
  useEffect(() => {
    if (!isActive) return;
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (taskRef.current?.contains(e.target as Node)) return;
      handleKeyDown(e);
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [isActive, handleKeyDown]);

  useEffect(() => {
    if (!active) return;
    latestRef.current.updateActiveItemAndItemInView(latestRef.current.task);
  }, [
    active,
    task.id,
    task.projectId,
    task.sectionId,
    task.ticketNumber,
    task.section,
    task.title,
  ]);

  const renderTaskCard = (provided?: any, snapshot?: any) => (
    <KanbanTaskCard
      task={task}
      project={_currentProject ?? project}
      currentSetting={currentSetting}
      assignedUsers={humanAssignees}
      agentAssignees={agentAssignees}
      blockingUser={blockingUser}
      active={active || isActive}
      selected={isBulkSelected(task.id)}
      hover={hover}
      hasDraft={draftTaskIds.has(task.id)}
      isArchivedOnBoard={isArchivedOnBoard}
      provided={provided}
      snapshot={snapshot}
      cardRef={taskRef}
      onFocusCapture={handleCardFocus}
      onBlurCapture={handleCardBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      openDetail={openDetail}
      updateActiveItemAndItemInView={updateActiveItemAndItemInView}
      setShowAssignModal={setShowAssignModal}
      setShowEstimateModal={setShowEstimateModal}
      setShowPriorityModal={setShowPriorityModal}
      setShowCreateLabelModal={setShowCreateLabelModal}
      toggleDueDate={toggleDueDate}
      toggleDelete={triggerDeleteModal}
      markTaskAsDone={markTaskAsDone}
      archiveNotificationCallback={archiveNotificationHandler}
      handleStarTask={handleStarTask}
      eHandler={eHandler}
      onParentTaskClick={() => {
        navigateToTask(task.projectId, task.uniqueIndex);
      }}
      onSubtaskClick={() => {
        setTasksPlayList(subTaskPlaylist);
        navigateToTask(task.projectId, task.uniqueIndex);
      }}
      selectionMode={bulkSelectedCount > 0}
      onSelectionClick={
        isArchivedOnBoard
          ? undefined
          : (_id, event) => {
              updateActiveItemAndItemInView(task);
              toggleTaskSelection(
                task.id,
                sectionId,
                Boolean(event?.shiftKey),
              );
            }
      }
    />
  );

  return (
    <>
      {isArchivedOnBoard ? (
        renderTaskCard()
      ) : dragProvided ? (
        renderTaskCard(dragProvided, dragSnapshot)
      ) : (
        <Draggable
          shouldRespectForcePress={false}
          key={`task-${task.id}`}
          draggableId={`task-${task.id}`}
          index={index}
        >
          {(provided, snapshot) => renderTaskCard(provided, snapshot)}
        </Draggable>
      )}
      {showAssignModal && (
        <AssignModal
          onClose={toggleAssigneesModal}
          project={project}
          task={{
            id: task.id,
            title: task.title,
            link: `${taskBaseUri}${project.name}/${task.uniqueIndex}`,
          }} 
          assignees={[...humanAssignees, ...agentAssignees]}
        />
      )}
      {showCommands.mode === CommandMode.RemoveSubtask && isActive && (
          <RemoveSubtaskModal
            closeHandler={toggleRemoveSubtaskModal}
            taskInfo={{
              subTasks: task.subTasks,
            }}
          />
        )}
    </>
  );
};

export default React.memo(Task);
