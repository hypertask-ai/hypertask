import { renderCommandModals1 } from "./commandModalPanels1";
import { renderCommandModals2 } from "./commandModalPanels2";

import { IHTCProps } from "./commandTypes";



import { useCommandsState } from "./useCommandsState";
import { createBoardCommandActions } from "./boardCommandActions";
import { createGeneralCommandActions } from "./generalCommandActions";
import { createCommandModalCallbacks } from "./commandModalCallbacks";
import { createCommandDispatcher } from "./commandDispatcher";
import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6868_TICKET_PREFIX_FLAG } from "@/lib/flags/keys";



import { CommandMode } from "@/models/enums";

















// ─── Static Imports ─────────────────────────────────────────────────────────────






import "./Modals/commands/HTC/AllCommands";







































const HypertasksCommands = ({ callbackHandler, contextOptions, focusProxy }: IHTCProps) => {
  const ticketPrefixEnabled = useFlag(HTPR_6868_TICKET_PREFIX_FLAG);
  const {
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
  } = useCommandsState({
    contextOptions, callbackHandler,
  });
  const {
  setRecurrenceHandler, saveTaskTemplateHandler, openTaskTemplateHandler, generateStatusUpdateHandler, toggleStalenessHandler,
  toggleAutoArchiveHandler, updateAutoAssignHandler, toggleStalenessViewHandler, sortByStalenessHandler, acceptTaskHandler,
  } = createBoardCommandActions({
    boardCloseHandler, inViewObject, queryClient, taskTemplatePickerForCurrentProject, toggleCreateTaskGlobally,
    _currentProject, router, setCurrentProject, saveStalenessToViewAPI, boardLayout,
    setTableVisibleColumns, setBoardSortingViewAndReturn, callbackHandler, removeFromListWithStatus, setActiveItem,
    moveItem,
  });
  const {
  redirectToManageSubscriptions, DeleteMessageHandler, toggleRenameTaskModal, toggleAssignModal, togglePriorityModal,
  toggleEstimateModal, togglRemindMeModal, toggleLabelModal, toggleBoardSortingHandler, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, closeCallbackCreateAgent, toggleSubtaskLinkingHandler,
  } = createCommandModalCallbacks({
    router, boardCloseHandler, setCommandMode, setCallbackProjectId, _currentProject,
    callbackHandler, inViewObject, updateTaskInCache, taskProject, refreshRowTaskList,
    pathname, queryClient, _activeItem, myTasksSnoozeEnabled, setShowCommands,
    setAgentToEdit,
  });
  const {
  subscribeGoogleCalendar, copyCurrentPageURL, copyBranchNameHandler, assignToMeHandler, GoToHandler,
  GoToOnboarding, deleteAllChats, toggleBoardTimeTrackingHandler, createBoard, redirectToTrash,
  markUnread, hideActiveColumn, createColumn, updateBoard, removeMemberLocal,
  addAgentToBoardLocal, removeAgentFromBoardLocal, inviteNewMemberHandlerLocal, toggleManageColumns,
  } = createGeneralCommandActions({
    boardCloseHandler, inViewObject, assignTaskUser, currentUser, toggleAssignModal,
    router, _currentProject, queryClient, setCurrentProject, goToProjectShortcut,
    _activeItem, activeSectionId, setBoardColumnsViewAPI, getProjectIdxAndAllData, updateProjectView,
    renameBoard, removeMemberFromBoard, addAgentToBoard, removeAgentFromBoard, inviteNewMembersToBoard,
    setShowCommands, setCommandMode,
    ...(ticketPrefixEnabled ? { ticketPrefixEnabled: true } : {}),
  });
  const {
  handleAction,
  } = createCommandDispatcher({
    copyCurrentUrlEnabled, boardCloseHandler, setShowCommands, setCommandMode, undoLatest,
    _currentProject, setBoardZoomedOutByProject, currentUser, openSettings, setShowShortcuts,
    switchToTheme, followTaskHandler, unFollowTaskHandler, hasBulkSelection, bulkSelection,
    archiveHandler, acceptTaskHandler, removeNotificationHandler, setShowQuickTips, openAnnouncements,
    setShowTaskHistory, setToggleAllCommentsSignal, saveEmptySectionsAPI, hideActiveColumn, toggleShowArchivedOnBoard,
    callbackHandler, paletteContextOptions, setArchiveBoardScope, toggleBoardLayout, onMyTasks,
    myTasksViewsEnabled, myTasksTableColumnsEnabled, setMyTasksColumnsPickerRequest, changeBoardLayout, pathname,
    goToProjectShortcut, router, setRailExpanded, setAppShellRail, redirectToManageSubscriptions,
    markUnread, GoToHandler, inViewObject, toggleBoardTimeTrackingHandler, redirectToTrash,
    saveTaskTemplateHandler, generateStatusUpdateHandler, toggleCreateTaskGlobally, duplicateTaskHandler, openAiWriterHandler,
    summarizeTicketHandler, viewSubTasksHandler, commentFunctionHandler, GoToOnboarding, isMbl,
    setShowAiChatInterface, showAiChatInterface, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, setAiChatPinned,
    aiChatPinned, setIsSidebarMode, copyCurrentPageURL, subscribeGoogleCalendar, copyURLFunctionHandler,
    moveTaskToInboxHandler, copyBranchNameHandler, starTaskHandler, setReminderHandler, myTasksSnoozeEnabled,
    removeParentHandler, removeSubtaskHandler, commentAudioSpeechToText, assignToMeHandler, toggleTimeTrackingHandler,
    toggleStalenessHandler, toggleStalenessViewHandler, toggleAutoArchiveHandler, sortByStalenessHandler, setCalendarSettings,
    endTour, setSelectedTourId, startTour, deleteAllChats,
  });

  useEffect(() => {
    const keyPressHandler = (e: KeyboardEvent) => {
      if (!showCommands.show) return;

      if (
        commandMode !== CommandMode.SwipeThroughUnread &&
        (e.key === "Escape" || (e.key === "k" && e.ctrlKey))
      ) {
        e.preventDefault();
        setTimeout(() => {
          setCommandMode(0);
          resetShowCommands();
        }, 1);
      }
    };
    document.addEventListener("keydown", keyPressHandler);
    return () => {
      document.removeEventListener("keydown", keyPressHandler);
    };
  }, [commandMode, resetShowCommands, showCommands.show]);

  if (!showCommands.show) return null;
  if (rowShortcutsEnabled && isRowTaskProjectFallback && isTaskProjectLoading)
    return <span className="hidden" />;

  return (
    <>
      {renderCommandModals1({
        commandMode,
      })}
      {renderCommandModals2({
        focusProxy,
        isMbl, commandMode, handleAction, paletteContextOptions, billing,
        appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
        refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
        confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
        _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
        hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
        _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
        createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
        cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
        callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
        setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
        toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
        myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
      })}
</>
  );
};

export default HypertasksCommands;
