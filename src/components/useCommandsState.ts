import { useContext, useEffect, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { activeSectionIdAtom, activeItemAtom, currentProjectAtom, showCommandsAtom, inViewObjectAtom, showQuickTipsAtom, showShortcutsAtom, showAIChatInterfaceAtom, isAiChatSidebarModeAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom, agentToEditAtom, showTaskHistoryAtom, toggleAllCommentsSignalAtom, archiveBoardScopeAtom, boardLayoutAtom, boardZoomedOutAtom, tableVisibleColumnsAtom, myTasksTableColumnsPickerRequestAtom, appShellRailAtom, appShellRailExpandedAtom, calendarSettingsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { IAgent, IUser } from "@/models/model";
import axios from "axios";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { parseCookies } from "nookies";
import { useQueryClient } from "@tanstack/react-query";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import globalConstants from "@/lib/constants";
import useInviteCallbackHandlers from "@/hooks/MultiPages/useInviteCallbackHandlers";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { useGetBoardInviteURL } from "@/hooks/Homepage/Invites/useGetBoardInviteURL";
import { useGetSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useToggleShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import useHTCTaskAndComments from "@/hooks/MultiPages/HTC/useHTCTaskAndComments";
import { useTourContext } from "@/lib/tours";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useAssignTaskUser } from "@/hooks/Task Detail/useAssignTaskUser";
import { useSettingsNavigation } from "./Modals/Settings/settingsNavigation";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { INBOX_ZERO_PRESETS } from "@/lib/inboxZero";
import { useGlobalUIState } from "./ProviderGlobal/useGlobalUIState";
import { useUndoContext } from "@/hooks/General/useUndo";
import { useKanbanBulkSelectionOptional } from "@/lib/contexts/Kanban/BulkSelectionContext";
import { useMyTasksBulkSelectionOptional } from "@/lib/contexts/MyTasks/BulkSelectionContext";
import { MIXED_BOARD_MESSAGE, sharedProjectId } from "@/lib/myTasksBulkSelection";
import { taskTemplatePickerForProject, type TaskTemplatePickerState } from "@/lib/taskTemplatePrefill";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6427_ROW_SHORTCUTS_FLAG, MY_TASKS_BULK_SELECTION_FLAG, MY_TASKS_SNOOZE_FLAG, MY_TASKS_TABLE_COLUMNS_FLAG, MY_TASKS_VIEWS_FLAG } from "@/lib/flags/keys";
import { useTaskProjectFallback } from "@/lib/keyboard/taskProjectFallback";
import type { IHTCProps } from "./commandTypes";

type Context = Pick<IHTCProps, "contextOptions" | "callbackHandler">;

export function useCommandsState(context: Context) {
  const {
  contextOptions, callbackHandler,
  } = context;

  const queryClient = useQueryClient();
  const copyCurrentUrlEnabled = useFlag("htpr-6112-copy-current-url");
  const rowShortcutsEnabled = useFlag(HTPR_6427_ROW_SHORTCUTS_FLAG);
  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const myTasksTableColumnsEnabled = useFlag(MY_TASKS_TABLE_COLUMNS_FLAG);
  const myTasksSnoozeEnabled = useFlag(MY_TASKS_SNOOZE_FLAG); // HTPR-6461: Remind Me also hides My Tasks
  const myTasksBulkSelectionEnabled = useFlag(MY_TASKS_BULK_SELECTION_FLAG);
  const activeSectionId = useRecoilValue(activeSectionIdAtom);
  const {
    updateTaskInCache,
    moveItem,
    removeFromListWithStatus,
    renameBoard,
    getProjectIdxAndAllData,
    updateProjectView,
  } = UpdateKanban();
  const {
    removeMemberFromBoard,
    addAgentToBoard,
    removeAgentFromBoard,
    inviteNewMembersToBoard,
    reSendInvite,
    cancelInvite,
  } = useInviteCallbackHandlers();
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const [, setBoardZoomedOutByProject] = useRecoilState(boardZoomedOutAtom);
  const [showAiChatInterface, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [isSidebarMode, setIsSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(aiChatAutoOpenSuppressedAtom);
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const [aiChatPinned, setAiChatPinned] = useRecoilState(aiChatPinnedAtom);
  const { resetShowCommands, toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { switchToTheme } = useDarkMode();
  const { openSettings } = useSettingsNavigation();
  const { openAnnouncements } = useGlobalUIState();
  const billing = useCurrentBoardBilling();
  const { undoLatest } = useUndoContext();
  const kanbanBulkSelection = useKanbanBulkSelectionOptional();
  const myTasksBulkFromContext = useMyTasksBulkSelectionOptional();
  const myTasksBulkSelection = myTasksBulkSelectionEnabled
    ? myTasksBulkFromContext
    : undefined;
  const bulkSelection = kanbanBulkSelection ?? myTasksBulkSelection;
  const hasBulkSelection = (bulkSelection?.selectedCount ?? 0) > 0;
  const bulkTasks = bulkSelection?.selectedTasks ?? [];
  const bulkProjectId = sharedProjectId(bulkTasks);
  const paletteContextOptions = hasBulkSelection
    ? {
        ...contextOptions,
        context: "Kanban" as const,
        task: undefined,
        taskOptions: undefined,
        bulkSelectionCount: bulkSelection?.selectedCount,
      }
    : contextOptions;

  const [commandMode, setCommandMode] = useState<CommandMode>(showCommands.mode);
  // One palette command per preset, all three landing on the same confirm sheet.
  const inboxZeroRules =
    commandMode === CommandMode.ClearInboxToZero
      ? INBOX_ZERO_PRESETS.default
      : commandMode === CommandMode.ArchiveAllReadNotifications
        ? INBOX_ZERO_PRESETS.allRead
        : commandMode === CommandMode.ArchiveReactionNotifications
          ? INBOX_ZERO_PRESETS.reactions
          : undefined;
  const relationPickerOptions = {
    [CommandMode.AddRelatedTask]: {
      header: "Add related task",
      relationType: "RelatedTo" as const,
    },
    [CommandMode.MarkBlockedBy]: {
      header: "Mark blocked by",
      relationType: "BlockedBy" as const,
    },
    [CommandMode.MarkAsBlocking]: {
      header: "Mark as blocking",
      relationType: "BlockedTo" as const,
    },
    [CommandMode.MarkDuplicateOf]: {
      header: "Mark duplicate of",
      relationType: "Duplicate" as const,
    },
    [CommandMode.DeclineAsDuplicateOf]: {
      header: "Decline as duplicate of",
      relationType: "Duplicate" as const,
    },
  };
  const relationPicker = relationPickerOptions[
    commandMode as keyof typeof relationPickerOptions
  ];
  const cookies = parseCookies();
  const currentUser: IUser = JSON.parse(cookies.nookies_user);
  const router = useRouter();
  const pathname = usePathname();
  const onMyTasks = !!pathname?.startsWith(globalConstants.myTasksRoute);
  const { startTour, setSelectedTourId, endTour } = useTourContext();
  const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom);
  // My Tasks bulk must use the selection's shared board only. Falling back to
  // currentProjectAtom would load columns/labels from a previously opened board.
  const bulkActionProjectId = myTasksBulkSelection
    ? bulkProjectId
    : (bulkProjectId ?? _currentProject?.id ?? null);
  const boardLayout = useRecoilValue(boardLayoutAtom);
  const [, setTableVisibleColumns] = useRecoilState(tableVisibleColumnsAtom);
  const [, setMyTasksColumnsPickerRequest] = useRecoilState(
    myTasksTableColumnsPickerRequestAtom,
  );
  const [_activeItem, setActiveItem] = useRecoilState(activeItemAtom);
  const [callbackProjectId, setCallbackProjectId] = useState<number | null>(null);
  const [inViewObject, __] = useRecoilState(inViewObjectAtom);
  const taskProjectId =
    paletteContextOptions?.task?.projectId ?? inViewObject.taskProjectId;
  const isRowTaskProjectFallback =
    rowShortcutsEnabled && Boolean(paletteContextOptions?.task) && !_currentProject;
  const { project: taskProject, isLoading: isTaskProjectLoading, isError: isTaskProjectError } =
    useTaskProjectFallback(
      _currentProject,
      taskProjectId,
      currentUser.id,
      isRowTaskProjectFallback,
    );
  const activeTaskId =
    paletteContextOptions?.task?.taskId ??
    inViewObject.taskId;
  const [___, setShowQuickTips] = useRecoilState(showQuickTipsAtom);
  const [_______, setShowShortcuts] = useRecoilState(showShortcutsAtom);
  const [agentToEdit, setAgentToEdit] = useRecoilState(agentToEditAtom);
  const [_showTaskHistory, setShowTaskHistory] = useRecoilState(showTaskHistoryAtom);
  const toggleShowArchivedOnBoard = useToggleShowArchivedOnBoard(_currentProject);
  const [, setArchiveBoardScope] = useRecoilState(archiveBoardScopeAtom);
  const [__toggleAllCommentsSignal, setToggleAllCommentsSignal] = useRecoilState(
    toggleAllCommentsSignalAtom
  );
  const {
    saveEmptySectionsAPI,
    setBoardColumnsViewAPI,
    setBoardSortingViewAndReturn,
    saveStalenessToViewAPI,
    changeBoardLayout,
    toggleBoardLayout,
  } = useKanbanViews(_currentProject);
  const [appShellRailOn, setAppShellRail] = useRecoilState(appShellRailAtom);
  const [, setRailExpanded] = useRecoilState(appShellRailExpandedAtom);
  const [, setCalendarSettings] = useRecoilState(calendarSettingsAtom);

  useGetBoardInviteURL(_currentProject?.id!, currentUser?.id);
  useEffect(() => {
    if (!isRowTaskProjectFallback || isTaskProjectLoading) return;
    if (isTaskProjectError || !taskProject?.name) {
      resetShowCommands();
      toast.error("Unable to open command for this task's board");
    }
  }, [
    isRowTaskProjectFallback,
    isTaskProjectError,
    isTaskProjectLoading,
    resetShowCommands,
    taskProject?.name,
  ]);
  const { data: _activeTask } = useGetSingleTask(inViewObject.taskId);
  const _activeTaskAssignees: (IUser | IAgent)[] = (() => {
    if (!_activeTask?.assignees) return [];
    try {
      return _activeTask.assignees.map((item: any) => {
        if (item.agent !== null) return item.agent;
        if (item.user !== null) return item.user;
        return { id: item.id, displayName: item.displayName, photoURL: item.photoURL };
      });
    } catch { return []; }
  })();
  const isMbl = useContext(MobileViewContext);
  const { goToProjectShortcut } = useProjectQuery();
  const assignTaskUser = useAssignTaskUser();
  const {
    starTaskHandler,
    copyURLFunctionHandler,
    moveTaskToInboxHandler,
    viewSubTasksHandler,
    openAiWriterHandler,
    summarizeTicketHandler,
    archiveHandler,
    confirmDelete,
    setDueDateCallback,
    commentFunctionHandler,
    duplicateTaskHandler,
    removeNotificationHandler,
    removeParentHandler,
    removeSubtaskHandler,
    setReminderHandler,
    followTaskHandler,
    unFollowTaskHandler,
    commentAudioSpeechToText,
    toggleTimeTrackingHandler,
  } = useHTCTaskAndComments({
    callbackHandler,
    inViewObject,
    boardCloseHandler,
    _currentProject: taskProject,
    currentUser,
    _activeItem,
    toggleCreateTaskGlobally,
  });

  function boardCloseHandler() {
    setTimeout(() => {
      setCommandMode(0);
      resetShowCommands();
    }, 1);
  }

  function refreshRowTaskList() {
    if (rowShortcutsEnabled && isRowTaskProjectFallback) router.refresh();
  }

  useEffect(() => {
    if (
      !showCommands.show ||
      (showCommands.mode !== CommandMode.SetTheme &&
        showCommands.mode !== CommandMode.ToggleDarkMode)
    ) {
      return;
    }

    openSettings("appearance");
    boardCloseHandler();
  }, [showCommands.mode, showCommands.show]);

  useEffect(() => {
    if (
      commandMode !== CommandMode.MyTasksSnooze &&
      showCommands.mode !== CommandMode.MyTasksSnooze
    ) {
      return;
    }
    if (myTasksSnoozeEnabled) {
      if (commandMode !== CommandMode.RemindMe) setCommandMode(CommandMode.RemindMe);
      if (showCommands.mode !== CommandMode.RemindMe) {
        setShowCommands((prev) => ({ ...prev, mode: CommandMode.RemindMe }));
      }
      return;
    }
    boardCloseHandler();
  }, [commandMode, myTasksSnoozeEnabled, showCommands.mode]);

  useEffect(() => {
    if (!hasBulkSelection || bulkActionProjectId) return;
    if (
      commandMode !== CommandMode.OpenAssignModal &&
      commandMode !== CommandMode.LabelModal &&
      commandMode !== CommandMode.MoveToColumn
    ) {
      return;
    }
    toast.error(MIXED_BOARD_MESSAGE);
    boardCloseHandler();
  }, [bulkActionProjectId, commandMode, hasBulkSelection]);

  // ---- HTPR-4885/4886/4888: repeat rules, task templates, status updates ----
  const [taskTemplatePicker, setTaskTemplatePicker] =
    useState<TaskTemplatePickerState>({
      projectId: null,
      templates: [],
      context: { labels: [], targetSection: null },
    });
  const taskTemplatePickerForCurrentProject = taskTemplatePickerForProject(
    taskTemplatePicker,
    _currentProject?.id,
  );

  useEffect(() => {
    if (commandMode !== CommandMode.NewTaskFromTemplate || !_currentProject?.id) return;
    const projectId = _currentProject.id;
    let cancelled = false;
    axios
      .get(`/api/task-templates?projectId=${projectId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setTaskTemplatePicker({
          projectId,
          templates: data?.templates ?? [],
          context: {
            labels: data?.labels ?? [],
            targetSection: data?.targetSection ?? null,
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setTaskTemplatePicker({
          projectId: null,
          templates: [],
          context: { labels: [], targetSection: null },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [commandMode, _currentProject?.id]);
  return {
  queryClient, copyCurrentUrlEnabled, rowShortcutsEnabled, myTasksViewsEnabled, myTasksTableColumnsEnabled,
  myTasksSnoozeEnabled, myTasksBulkSelectionEnabled, activeSectionId, updateTaskInCache, moveItem,
  removeFromListWithStatus, renameBoard, getProjectIdxAndAllData, updateProjectView, removeMemberFromBoard,
  addAgentToBoard, removeAgentFromBoard, inviteNewMembersToBoard, reSendInvite, cancelInvite,
  showCommands, setShowCommands, setBoardZoomedOutByProject, showAiChatInterface, setShowAiChatInterface,
  setIsSidebarMode, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatPinned, setAiChatPinned,
  resetShowCommands, toggleCreateTaskGlobally, switchToTheme, openSettings, openAnnouncements,
  billing, undoLatest, kanbanBulkSelection, bulkSelection, hasBulkSelection,
  bulkTasks, paletteContextOptions, commandMode, setCommandMode, inboxZeroRules,
  relationPicker, currentUser, router, pathname, onMyTasks,
  startTour, setSelectedTourId, endTour, _currentProject, setCurrentProject,
  bulkActionProjectId, boardLayout, setTableVisibleColumns, setMyTasksColumnsPickerRequest, _activeItem,
  setActiveItem, callbackProjectId, setCallbackProjectId, inViewObject, isRowTaskProjectFallback,
  taskProject, isTaskProjectLoading, activeTaskId, setShowQuickTips, setShowShortcuts,
  agentToEdit, setAgentToEdit, setShowTaskHistory, toggleShowArchivedOnBoard, setArchiveBoardScope,
  setToggleAllCommentsSignal, saveEmptySectionsAPI, setBoardColumnsViewAPI, setBoardSortingViewAndReturn, saveStalenessToViewAPI,
  changeBoardLayout, toggleBoardLayout, appShellRailOn, setAppShellRail, setRailExpanded,
  setCalendarSettings, _activeTask, _activeTaskAssignees, isMbl, goToProjectShortcut,
  assignTaskUser, starTaskHandler, copyURLFunctionHandler, moveTaskToInboxHandler, viewSubTasksHandler,
  openAiWriterHandler, summarizeTicketHandler, archiveHandler, confirmDelete, setDueDateCallback,
  commentFunctionHandler, duplicateTaskHandler, removeNotificationHandler, removeParentHandler, removeSubtaskHandler,
  setReminderHandler, followTaskHandler, unFollowTaskHandler, commentAudioSpeechToText, toggleTimeTrackingHandler,
  boardCloseHandler, refreshRowTaskList, taskTemplatePickerForCurrentProject,
  };
}
