import { CommandMode } from "@/models/enums";
import { dispatchAgentChatCommand } from "@/lib/agents/chatPaletteCommands";
import { toggleProjectBoardZoom } from "@/hooks/Kanban/mobileBoardGestures";
import toast from "react-hot-toast";
import globalConstants from "@/lib/constants";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { getActiveEmptySectionSettingFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TOUR_IDS } from "@/lib/tours/types";
import { isSettingsSectionId } from "./Modals/Settings/settingsNavigation";
import { getLastFocusedTiptapEditor, putSnippetDraftHandoff, openSnippetPicker } from "@/lib/snippets";
import { timeQuickLogTaskUrl } from "@/lib/timeQuickLog";
import { buildFullScreenChatPath } from "@/lib/aiChatDisplayMode";
import type { IHTCProps } from "./commandTypes";
import type { useCommandsState } from "./useCommandsState";
import type { createBoardCommandActions } from "./boardCommandActions";
import type { createGeneralCommandActions } from "./generalCommandActions";
import type { createCommandModalCallbacks } from "./commandModalCallbacks";

type Context = { newTaskWindow?: boolean } & Pick<IHTCProps, "callbackHandler"> &
  Pick<ReturnType<typeof useCommandsState>, "copyCurrentUrlEnabled" | "boardCloseHandler" | "setShowCommands" | "setCommandMode" | "undoLatest" | "_currentProject" | "setBoardZoomedOutByProject" | "currentUser" | "openSettings" | "setShowShortcuts" | "switchToTheme" | "followTaskHandler" | "unFollowTaskHandler" | "hasBulkSelection" | "bulkSelection" | "archiveHandler" | "removeNotificationHandler" | "setShowQuickTips" | "openAnnouncements" | "setShowTaskHistory" | "setToggleAllCommentsSignal" | "saveEmptySectionsAPI" | "toggleShowArchivedOnBoard" | "paletteContextOptions" | "setArchiveBoardScope" | "toggleBoardLayout" | "onMyTasks" | "myTasksViewsEnabled" | "myTasksTableColumnsEnabled" | "setMyTasksColumnsPickerRequest" | "changeBoardLayout" | "pathname" | "goToProjectShortcut" | "router" | "setRailExpanded" | "setAppShellRail" | "inViewObject" | "toggleCreateTaskGlobally" | "duplicateTaskHandler" | "openAiWriterHandler" | "summarizeTicketHandler" | "viewSubTasksHandler" | "commentFunctionHandler" | "isMbl" | "setShowAiChatInterface" | "showAiChatInterface" | "setAiChatAutoOpenSuppressed" | "setAiChatExplicitOpenAt" | "setAiChatPinned" | "aiChatPinned" | "setIsSidebarMode" | "copyURLFunctionHandler" | "moveTaskToInboxHandler" | "starTaskHandler" | "setReminderHandler" | "myTasksSnoozeEnabled" | "removeParentHandler" | "removeSubtaskHandler" | "commentAudioSpeechToText" | "toggleTimeTrackingHandler" | "setCalendarSettings" | "endTour" | "setSelectedTourId" | "startTour"> &
  Pick<ReturnType<typeof createBoardCommandActions>, "acceptTaskHandler" | "saveTaskTemplateHandler" | "generateStatusUpdateHandler" | "toggleStalenessHandler" | "toggleStalenessViewHandler" | "toggleAutoArchiveHandler" | "sortByStalenessHandler"> &
  Pick<ReturnType<typeof createGeneralCommandActions>, "hideActiveColumn" | "markUnread" | "GoToHandler" | "toggleBoardTimeTrackingHandler" | "redirectToTrash" | "GoToOnboarding" | "copyCurrentPageURL" | "subscribeGoogleCalendar" | "copyBranchNameHandler" | "assignToMeHandler" | "deleteAllChats"> &
  Pick<ReturnType<typeof createCommandModalCallbacks>, "redirectToManageSubscriptions">;

export function createCommandDispatcher(context: Context) {
  const {
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
  } = context;


  const handleAction = (mode?: CommandMode, action?: string) => {
    if (context.newTaskWindow && (mode === CommandMode.CreateTaskWithAiWriter || mode === CommandMode.OpenAiTaskWriter)) {
      setShowCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
      return;
    }
    if (mode === CommandMode.CopyViewURL && !copyCurrentUrlEnabled) {
      boardCloseHandler();
      return;
    }

    if (mode) {
      setShowCommands((prev) => ({ ...prev, mode }));
      setCommandMode(mode);
    }

    switch (mode) {
      case CommandMode.UndoLatest:
      case CommandMode.ReloadApp:
      case CommandMode.ToggleBoardZoom:
      case CommandMode.EditBoard:
      case CommandMode.AutoAssignColumn:
      case CommandMode.ArchiveBoard:
      case CommandMode.DeleteBoard:
      case CommandMode.Setting:
      case CommandMode.SetTheme:
      case CommandMode.ToggleDarkMode:
      case CommandMode.BoardSettings:
      case CommandMode.ManageTeams:
      case CommandMode.ManageBoards:
      case CommandMode.AICustomInstruction:
      case CommandMode.Skills:
      case CommandMode.NewBoard:
      case CommandMode.BoardCreationAssistant:
      case CommandMode.ToggleWhiteTheme:
      case CommandMode.ToggleFilterValueMatch:
      case CommandMode.ToggleAmoledTheme:
      case CommandMode.ToggleDiaTheme:
      case CommandMode.ToggleDarkTheme:
      case CommandMode.InviteMember:
      case CommandMode.DeleteMessage:
      case CommandMode.FollowTask:
      case CommandMode.UnFollowTask:
      case CommandMode.DeleteTask:
      case CommandMode.ArchiveTask:
      case CommandMode.AcceptTask:
      case CommandMode.DeclineTask:
      case CommandMode.RemoveTaskNotification:
      case CommandMode.QuickTips:
      case CommandMode.ShowAnnouncements:
      case CommandMode.ToggleHistory:
      case CommandMode.ToggleAllComments:
      case CommandMode.ToggleEmptyColumns:
      case CommandMode.HideColumn:
      case CommandMode.ToggleArchivedOnBoard:
      case CommandMode.ToggleArchivedSearchResults:
      case CommandMode.ArchiveShowActiveBoardsOnly:
      case CommandMode.ArchiveShowAllBoards:
      case CommandMode.ArchiveShowArchivedBoardsOnly:
      case CommandMode.ToggleBoardLayout:
      case CommandMode.ConfigureTableColumns:
      case CommandMode.ManageCustomFields:
      case CommandMode.GoToBoardSurface:
      case CommandMode.GoToTableSurface:
      case CommandMode.ToggleRailExpanded:
        return dispatchCommandGroup1(context, mode, action);
      case CommandMode.ToggleAppShellRail:
      case CommandMode.ManageTeamMembers:
      case CommandMode.TeamSettings:
      case CommandMode.UpgradeToAddAi:
      case CommandMode.ManageSubscriptions:
      case CommandMode.Billing:
      case CommandMode.ManageTeamAIAPIKeys:
      case CommandMode.Shortcut:
      case CommandMode.Setting:
      case CommandMode.MarkUnread:
      case CommandMode.SwipeThroughUnread:
      case CommandMode.ClearInboxToZero:
      case CommandMode.ArchiveAllReadNotifications:
      case CommandMode.ArchiveReactionNotifications:
      case CommandMode.SearchTask:
      case CommandMode.GotoInbox:
      case CommandMode.GotoSnippets:
      case CommandMode.GoToBoard:
      case CommandMode.GotoInboxArchives:
      case CommandMode.GotoReminders:
      case CommandMode.GoToTimers:
      case CommandMode.GoToTimeThisTask:
      case CommandMode.LogTimeOnTask:
      case CommandMode.GoToTimeThisBoard:
      case CommandMode.GotoReports:
      case CommandMode.BoardVelocity:
      case CommandMode.GotoBoardVelocityReport:
      case CommandMode.ToggleBoardTimeTracking:
      case CommandMode.GoToTimeMyWeek:
      case CommandMode.GoToWelcome:
      case CommandMode.HelpCenter:
      case CommandMode.HelpCenter:
      case CommandMode.GotoTrash:
      case CommandMode.GotoTaskArchives:
      case CommandMode.GoToAllTasks:
      case CommandMode.GoToMyTasks:
      case CommandMode.SaveTaskTemplate:
      case CommandMode.GenerateStatusUpdate:
      case CommandMode.CreateTask:
      case CommandMode.CreateTaskWithAiWriter:
      case CommandMode.UseSnippet:
      case CommandMode.CreateSnippet:
      case CommandMode.CreateSnippetFromDraft:
      case CommandMode.DuplicateTask:
        return dispatchCommandGroup2(context, mode, action);
      case CommandMode.DuplicateTaskToBoard:
      case CommandMode.OpenAiTaskWriter:
      case CommandMode.SummarizeTicket:
      case CommandMode.ViewSubTasks:
      case CommandMode.CopyCommentURL:
      case CommandMode.BranchInNewChat:
      case CommandMode.CopyCommentToAiChat:
      case CommandMode.SummarizeComment:
      case CommandMode.FastLikeComment:
      case CommandMode.GoToOnboarding:
      case CommandMode.AIChatInterface:
      case CommandMode.PinAIChatOpen:
      case CommandMode.FullScreenAIChat:
      case CommandMode.ToggleAIChatView:
      case CommandMode.CreateTaskFromComment:
      case CommandMode.CopyViewURL:
      case CommandMode.SubscribeGoogleCalendar:
      case CommandMode.CopyUrlTask:
      case CommandMode.ShowInInbox:
      case CommandMode.CopyFormattedURLTask:
      case CommandMode.CopyPublicUrlTask:
      case CommandMode.CopyPublicFormattedUrlTask:
      case CommandMode.CopyTaskID:
      case CommandMode.CopyTaskTitleAndID:
      case CommandMode.CopyBranchName:
      case CommandMode.StarTask:
      case CommandMode.StarComment:
      case CommandMode.PinComment:
      case CommandMode.ReplyToComment:
      case CommandMode.ReactToComment:
      case CommandMode.EditComment:
      case CommandMode.GoToDrafts:
      case CommandMode.GoToStarred:
      case CommandMode.GoToPinned:
      case CommandMode.GoToAgents:
      case CommandMode.ManageAgents:
      case CommandMode.GoToAgentChat:
      case CommandMode.AgentChatNextAgent:
      case CommandMode.AgentChatPreviousAgent:
      case CommandMode.AgentChatSendMessage:
      case CommandMode.AgentChatOpenLinks:
      case CommandMode.AgentChatAddAgent:
      case CommandMode.AgentChatNextTeam:
      case CommandMode.AgentChatPreviousTeam:
      case CommandMode.DisabledAgents:
      case CommandMode.GoToCalender:
      case CommandMode.GoToDueDates:
      case CommandMode.SetReminder:
        return dispatchCommandGroup3(context, mode, action);
      case CommandMode.MyTasksSnooze:
      case CommandMode.RemoveParent:
      case CommandMode.RemoveSubtask:
      case CommandMode.SuggestReply:
      case CommandMode.SpeechToText:
      case CommandMode.AssignToMe:
      case CommandMode.ToggleTimeTracking:
      case CommandMode.ToggleStaleness:
      case CommandMode.ToggleStalenessView:
      case CommandMode.ToggleAutoArchive:
      case CommandMode.SortByTimeInColumn:
      case CommandMode.SortByLastComment:
      case CommandMode.CalendarSettings:
      case CommandMode.ToggleCalendarWeekends:
      case CommandMode.CalendarWeekStartsMonday:
      case CommandMode.CalendarWeekStartsSunday:
      case CommandMode.ToggleSystemTheme:
      case CommandMode.StartKanbanTutorial:
      case CommandMode.StartTaskWriterTutorial:
      case CommandMode.CopyCommentContent:
      case CommandMode.GotoProjectInbox:
      case CommandMode.DeleteAllChats:
      case CommandMode.CreateCustomField:
      case CommandMode.TaskDescriptionVersions:
      default:
        return dispatchCommandGroup4(context, mode, action);
    }
  };
  return {
  handleAction,
  };
}

function dispatchCommandGroup1(context: Context, mode?: CommandMode, action?: string) {
  const {
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
  } = context;
  switch (mode) {
      case CommandMode.UndoLatest:
        void undoLatest()
          .then((didUndo) => {
            if (!didUndo) toast("Nothing to undo");
          })
          .finally(boardCloseHandler);
        return;
      case CommandMode.ReloadApp:
        window.location.reload();
        return;
      case CommandMode.ToggleBoardZoom: {
        const boardId = _currentProject?.id;
        if (boardId !== undefined) {
          setBoardZoomedOutByProject((current) =>
            toggleProjectBoardZoom(current, boardId)
          );
        }
        boardCloseHandler();
        return;
      }
      case CommandMode.EditBoard:
      case CommandMode.AutoAssignColumn:
        break;
      case CommandMode.ArchiveBoard:
      case CommandMode.DeleteBoard:
        if (!_currentProject || currentUser.id.toString() !== _currentProject.ownerId.toString()) {
          toast.error("Only board owner can manage this board");
          boardCloseHandler();
          return;
        }
        break;
      case CommandMode.Setting:
        openSettings(isSettingsSectionId(action) ? action : undefined);
        setShowShortcuts(false);
        boardCloseHandler();
        break;
      case CommandMode.SetTheme:
      case CommandMode.ToggleDarkMode:
        // Older clients can retain a command mode while this bundle replaces
        // the retired theme submenu. Keep those numeric enum values useful.
        openSettings("appearance");
        setShowShortcuts(false);
        boardCloseHandler();
        break;
      case CommandMode.BoardSettings:
      case CommandMode.ManageTeams:
      case CommandMode.ManageBoards:
        openSettings("board-general");
        boardCloseHandler();
        break;
      case CommandMode.AICustomInstruction:
        openSettings("board-ai");
        boardCloseHandler();
        break;
      case CommandMode.Skills:
        openSettings("skills");
        boardCloseHandler();
        break;
      case CommandMode.NewBoard:
      case CommandMode.BoardCreationAssistant:
        break;
      case CommandMode.ToggleWhiteTheme:
        switchToTheme("porcelain");
        boardCloseHandler();
        break;
      case CommandMode.ToggleFilterValueMatch:
        setShowCommands((prev) => ({ ...prev, mode: CommandMode.ShowFilterHTC }));
        setCommandMode(CommandMode.ShowFilterHTC);
        return;
      case CommandMode.ToggleAmoledTheme:
        switchToTheme("amoled");
        boardCloseHandler();
        break;

      case CommandMode.ToggleDiaTheme:
        switchToTheme("dia");
        boardCloseHandler();
        break;

      case CommandMode.ToggleDarkTheme:
        switchToTheme("graphite");
        boardCloseHandler();
        break;

      case CommandMode.InviteMember:
        break;
      // case CommandMode.auc
      case CommandMode.DeleteMessage:
        break;
      case CommandMode.FollowTask:
        followTaskHandler();
        break;
      case CommandMode.UnFollowTask:
        unFollowTaskHandler();
        break;
      case CommandMode.DeleteTask:
        break;
      case CommandMode.ArchiveTask:
        if (hasBulkSelection && bulkSelection) {
          void bulkSelection.archiveSelected().finally(boardCloseHandler);
          return;
        }
        archiveHandler();
        return;
      case CommandMode.AcceptTask:
        void acceptTaskHandler();
        return;
      case CommandMode.DeclineTask:
        void archiveHandler().finally(boardCloseHandler);
        return;
      case CommandMode.RemoveTaskNotification:
        removeNotificationHandler();
        return;
      case CommandMode.QuickTips:
        setShowQuickTips((prev) => !prev);
        boardCloseHandler();
        break;
      case CommandMode.ShowAnnouncements:
        openAnnouncements();
        boardCloseHandler();
        break;
      case CommandMode.ToggleHistory:
        setShowTaskHistory((prev) => !prev);
        boardCloseHandler();
        break;
      case CommandMode.ToggleAllComments:
        setToggleAllCommentsSignal((prev) => prev + 1);
        boardCloseHandler();
        break;
      case CommandMode.ToggleEmptyColumns:
        if (_currentProject) {
          const current =
            getActiveEmptySectionSettingFromProject(_currentProject);
          saveEmptySectionsAPI(
            _currentProject,
            current === "Hidden" ? "Show" : "Hidden"
          );
        }
        boardCloseHandler();
        break;
      case CommandMode.HideColumn:
        void hideActiveColumn();
        boardCloseHandler();
        return;
      case CommandMode.ToggleArchivedOnBoard:
        toggleShowArchivedOnBoard();
        boardCloseHandler();
        break;
      case CommandMode.ToggleArchivedSearchResults:
        callbackHandler?.(
          !paletteContextOptions?.searchOptions?.includeArchived,
          "ToggleArchivedSearchResults"
        );
        boardCloseHandler();
        break;
      case CommandMode.ArchiveShowActiveBoardsOnly:
        setArchiveBoardScope("active");
        boardCloseHandler();
        break;
      case CommandMode.ArchiveShowAllBoards:
        setArchiveBoardScope("all");
        boardCloseHandler();
        break;
      case CommandMode.ArchiveShowArchivedBoardsOnly:
        setArchiveBoardScope("archived");
        boardCloseHandler();
        break;
      case CommandMode.ToggleBoardLayout:
        toggleBoardLayout();
        boardCloseHandler();
        break;
      case CommandMode.ConfigureTableColumns:
        if (onMyTasks && myTasksViewsEnabled && myTasksTableColumnsEnabled) {
          setMyTasksColumnsPickerRequest((current) => current + 1);
          boardCloseHandler();
        }
        break;
      case CommandMode.ManageCustomFields:
        break;
      case CommandMode.GoToBoardSurface:
      case CommandMode.GoToTableSurface: {
        const layout =
          mode === CommandMode.GoToBoardSurface ? "board" : "table";
        changeBoardLayout(layout);
        boardCloseHandler();
        if (!pathname?.startsWith("/project")) {
          if (_currentProject?.id) {
            goToProjectShortcut(_currentProject.id, true, false, layout);
          } else {
            router.push(`/project?surface=${layout}`);
          }
        }
        return;
      }
      case CommandMode.ToggleRailExpanded:
        setRailExpanded((prev) => !prev);
        boardCloseHandler();
        break;
  }
}

function dispatchCommandGroup2(context: Context, mode?: CommandMode, action?: string) {
  const {
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
  } = context;
  switch (mode) {
      case CommandMode.ToggleAppShellRail:
        setAppShellRail((prev) => !prev);
        boardCloseHandler();
        break;
      case CommandMode.ManageTeamMembers:
        redirectToManageSubscriptions("Members");
        break;
      case CommandMode.TeamSettings:
        redirectToManageSubscriptions("Settings");
        break;
      case CommandMode.UpgradeToAddAi:
        redirectToManageSubscriptions("Upgrade");
        break;
      case CommandMode.ManageSubscriptions:
        redirectToManageSubscriptions("Upgrade");
        break;
      case CommandMode.Billing:
        redirectToManageSubscriptions("Billing");
        break;
      case CommandMode.ManageTeamAIAPIKeys:
        redirectToManageSubscriptions("API Keys");
        break;
      case CommandMode.Shortcut:
        break;
      case CommandMode.Setting:
        break;
      case CommandMode.MarkUnread:
        markUnread();
        break;
      case CommandMode.SwipeThroughUnread:
        break;
      // Archiving the inbox is destructive, so these open the confirm sheet and
      // let it run the archive against a preview the person has actually seen.
      // Handled by the conditional render below — just keep commandMode set.
      case CommandMode.ClearInboxToZero:
      case CommandMode.ArchiveAllReadNotifications:
      case CommandMode.ArchiveReactionNotifications:
        break;
      case CommandMode.SearchTask:
        GoToHandler(`/search?searchTerm=${encodeURIComponent(action ?? "")}`);
        break;
      case CommandMode.GotoInbox:
        GoToHandler(globalConstants.inboxRoute);
        break;
      case CommandMode.GotoSnippets:
        GoToHandler("/snippets");
        break;
      case CommandMode.GoToBoard: {
        const projectId = Number(action);
        if (Number.isInteger(projectId) && projectId > 0) {
          boardCloseHandler();
          goToProjectShortcut(projectId, true);
        }
        return;
      }
      case CommandMode.GotoInboxArchives:
        GoToHandler(globalConstants.inboxArchivesRoute);
        break;
      case CommandMode.GotoReminders:
        GoToHandler(globalConstants.reminderRouterRoute);
        break;
      case CommandMode.GoToTimers:
        GoToHandler("/time?running=1");
        break;
      case CommandMode.GoToTimeThisTask:
        {
          const url = timeQuickLogTaskUrl(
            inViewObject.taskId,
            inViewObject.taskProjectId,
            _currentProject?.id
          );
          if (url) GoToHandler(url);
        }
        break;
      case CommandMode.LogTimeOnTask:
        {
          const url = timeQuickLogTaskUrl(
            inViewObject.taskId,
            inViewObject.taskProjectId,
            _currentProject?.id
          );
          GoToHandler(url ?? "/time");
        }
        break;
      case CommandMode.GoToTimeThisBoard:
        if (_currentProject?.id) {
          GoToHandler(`/time?board=${_currentProject.id}`);
        }
        break;
      case CommandMode.GotoReports:
        GoToHandler("/report");
        break;
      case CommandMode.BoardVelocity:
      case CommandMode.GotoBoardVelocityReport: {
        // Fall back to the board id in the URL: silently doing nothing when the
        // atom has not hydrated reads to the user as a dead command.
        const velocityProjectId =
          _currentProject?.id ??
          Number(pathname?.match(/project-(\d+)/)?.[1] ?? NaN);
        if (Number.isInteger(velocityProjectId) && velocityProjectId > 0) {
          GoToHandler(`/report/project-${velocityProjectId}/velocity`);
        } else {
          toast.error("Open a board first to see its velocity report");
        }
        break;
      }
      case CommandMode.ToggleBoardTimeTracking:
        void toggleBoardTimeTrackingHandler();
        return;
      case CommandMode.GoToTimeMyWeek: {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysSinceMonday = (from.getDay() + 6) % 7;
        from.setDate(from.getDate() - daysSinceMonday);
        const to = new Date(from);
        to.setDate(to.getDate() + 6);
        to.setHours(23, 59, 59, 999);
        const params = new URLSearchParams({
          user: "me",
          from: from.toISOString(),
          to: to.toISOString(),
        });
        GoToHandler(`/time?${params.toString()}`);
        break;
      }
      case CommandMode.GoToWelcome:
        GoToHandler(
          `/onboarding?teamTitle=${_currentProject?.team.title}&id=${_currentProject?.team.id}`
        );
        break;
      case CommandMode.HelpCenter:
        GoToHandler(`https://hypertask.ai/help`, true);
        break;
      case CommandMode.HelpCenter:
        GoToHandler("/scheduled");
        break;
      case CommandMode.GotoTrash:
        redirectToTrash();
        break;
      case CommandMode.GotoTaskArchives:
        GoToHandler(globalConstants.taskArchivesRoute);
        break;
      case CommandMode.GoToAllTasks:
        GoToHandler(globalConstants.allTasksRoute);
        break;
      case CommandMode.GoToMyTasks:
        GoToHandler(globalConstants.myTasksRoute);
        break;
      case CommandMode.SaveTaskTemplate:
        saveTaskTemplateHandler();
        return;
      case CommandMode.GenerateStatusUpdate:
        generateStatusUpdateHandler();
        return;
      case CommandMode.CreateTask:
        toggleCreateTaskGlobally();
        boardCloseHandler();
        break;
      // Same task as CreateTask, opened straight into the AI Task Writer — the
      // palette twin of Ctrl/Cmd+J on the board (HTPR-4903).
      case CommandMode.CreateTaskWithAiWriter:
        toggleCreateTaskGlobally(undefined, {
          defaultEditMode: "Description-ai",
          defaultFocus: "Description",
        });
        boardCloseHandler();
        break;
      case CommandMode.UseSnippet:
        boardCloseHandler();
        if (!openSnippetPicker()) {
          toast.error("Focus an editor before using a snippet");
        }
        return;
      case CommandMode.CreateSnippet:
      case CommandMode.CreateSnippetFromDraft:
        // Snippets are managed on their own full page. Creating from a draft
        // hands the editor's content over through sessionStorage, since the
        // page is a fresh navigation and cannot read the editor behind it.
        // Read the mode being handled, not the state set moments ago, which
        // still holds whichever command ran before this one.
        // An empty draft also clears any handoff an earlier from-draft run
        // left behind, so a plain Create snippet never inherits it.
        putSnippetDraftHandoff(
          currentUser?.id,
          mode === CommandMode.CreateSnippetFromDraft
            ? getLastFocusedTiptapEditor()?.getHTML() ?? ""
            : ""
        );
        boardCloseHandler();
        router.push("/snippets");
        return;
      case CommandMode.DuplicateTask:
        duplicateTaskHandler();
        break;
  }
}

function dispatchCommandGroup3(context: Context, mode?: CommandMode, action?: string) {
  const {
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
  } = context;
  switch (mode) {
      case CommandMode.DuplicateTaskToBoard:
        duplicateTaskHandler(true);
        break;
      case CommandMode.OpenAiTaskWriter:
        openAiWriterHandler();
        break;
      case CommandMode.SummarizeTicket:
        summarizeTicketHandler();
        break;
      case CommandMode.ViewSubTasks:
        viewSubTasksHandler();
        break;
      case CommandMode.CopyCommentURL:
        commentFunctionHandler("CopyCommentLinkURL");
        break;
      case CommandMode.BranchInNewChat:
        commentFunctionHandler("BranchInNewChat");
        break;
      case CommandMode.CopyCommentToAiChat:
        commentFunctionHandler("CopyCommentToAiChat");
        break;
      case CommandMode.SummarizeComment:
        commentFunctionHandler("SummarizeComment");
        break;
      case CommandMode.FastLikeComment:
        commentFunctionHandler("FastLikeComment");
        break;
      case CommandMode.GoToOnboarding:
        GoToOnboarding();
        break;
      case CommandMode.AIChatInterface:
        //prevent mobile and login page from ever opening
        if (isMbl || pathname?.startsWith("/login")) break;
        setShowAiChatInterface(!showAiChatInterface);
        setAiChatAutoOpenSuppressed(showAiChatInterface);
        // Opening (current state closed) is an explicit user action.
        if (!showAiChatInterface) setAiChatExplicitOpenAt(Date.now());
        if (showAiChatInterface) setAiChatPinned(false);
        boardCloseHandler();
        break;
      case CommandMode.PinAIChatOpen:
        //prevent mobile and login page from ever opening
        if (isMbl || pathname?.startsWith("/login")) break;
        setAiChatPinned(!aiChatPinned);
        if (!aiChatPinned) {
          setAiChatExplicitOpenAt(Date.now());
          setShowAiChatInterface(true);
          setAiChatAutoOpenSuppressed(false);
        }
        boardCloseHandler();
        break;
      case CommandMode.FullScreenAIChat:
        if (isMbl || pathname?.startsWith("/login")) break;
        router.push(
          buildFullScreenChatPath(
            `${window.location.pathname}${window.location.search}${window.location.hash}`
          )
        );
        boardCloseHandler();
        break;
      case CommandMode.ToggleAIChatView:
        //prevent mobile
        if (isMbl || !showAiChatInterface) break;
        setIsSidebarMode((prev) => !prev);
        boardCloseHandler();
        break;
      case CommandMode.CreateTaskFromComment:
        commentFunctionHandler("CreateTaskFromComment");
        break;
      case CommandMode.CopyViewURL:
        void copyCurrentPageURL();
        return;
      case CommandMode.SubscribeGoogleCalendar:
        subscribeGoogleCalendar();
        break;
      case CommandMode.CopyUrlTask:
        copyURLFunctionHandler("Private");
        break;
      case CommandMode.ShowInInbox:
        moveTaskToInboxHandler();
        return;
      case CommandMode.CopyFormattedURLTask:
        copyURLFunctionHandler("PrivateFormatted");
        return;
      case CommandMode.CopyPublicUrlTask:
        copyURLFunctionHandler("Public");
        return;
      case CommandMode.CopyPublicFormattedUrlTask:
        copyURLFunctionHandler("PublicFormatted");
        return;
      case CommandMode.CopyTaskID:
        copyURLFunctionHandler("ID");
        return;
      case CommandMode.CopyTaskTitleAndID:
        copyURLFunctionHandler("TitleAndID");
        return;
      case CommandMode.CopyBranchName:
        void copyBranchNameHandler();
        return;
      case CommandMode.StarTask:
        starTaskHandler();
        return;
      case CommandMode.StarComment:
        commentFunctionHandler("StarComment", "Private");
        return;
      case CommandMode.PinComment:
        commentFunctionHandler("StarComment", "Public");
        return;
      case CommandMode.ReplyToComment:
        commentFunctionHandler("ReplyToComment");
        return;
      case CommandMode.ReactToComment:
        commentFunctionHandler("ReactToComment");
        return;
      case CommandMode.EditComment:
        commentFunctionHandler("EditComment");
        return;
      case CommandMode.GoToDrafts:
        boardCloseHandler();
        router.push("/drafts");
        return;
      case CommandMode.GoToStarred:
        boardCloseHandler();
        router.push("/starred");
        return;
      case CommandMode.GoToPinned:
        boardCloseHandler();
        router.push("/pinned");
        return;
      // Every way of asking for agents lands on the agents page. The enum
      // members stay (CommandMode is numeric and persisted in client state);
      // only what they do changed, and their modals no longer render.
      case CommandMode.GoToAgents:
      case CommandMode.ManageAgents:
        boardCloseHandler();
        router.push("/agents");
        return;
      case CommandMode.GoToAgentChat:
        boardCloseHandler();
        router.push("/agents/chat");
        return;
      // Agent Chat is already open when these fire (the palette entries only
      // show while onAgentChat is true); AgentChatClient owns the roster,
      // composer, and mention state these actually need, so this just hands
      // the request off via CustomEvent instead of duplicating that state.
      case CommandMode.AgentChatNextAgent:
        boardCloseHandler();
        dispatchAgentChatCommand("next-agent");
        return;
      case CommandMode.AgentChatPreviousAgent:
        boardCloseHandler();
        dispatchAgentChatCommand("previous-agent");
        return;
      case CommandMode.AgentChatSendMessage:
        boardCloseHandler();
        dispatchAgentChatCommand("send-message");
        return;
      case CommandMode.AgentChatOpenLinks:
        boardCloseHandler();
        dispatchAgentChatCommand("open-links");
        return;
      case CommandMode.AgentChatAddAgent:
        boardCloseHandler();
        dispatchAgentChatCommand("add-agent");
        return;
      case CommandMode.AgentChatNextTeam:
        boardCloseHandler();
        dispatchAgentChatCommand("next-team");
        return;
      case CommandMode.AgentChatPreviousTeam:
        boardCloseHandler();
        dispatchAgentChatCommand("previous-team");
        return;
      case CommandMode.DisabledAgents:
        boardCloseHandler();
        router.push("/agents?active=off");
        return;
      case CommandMode.GoToCalender:
        if (isMbl) boardCloseHandler();
        else {
          boardCloseHandler();
          router.push("/calendar");
        }
        return;
      case CommandMode.GoToDueDates:
        boardCloseHandler();
        router.push("/scheduled");
        return;
      case CommandMode.SetReminder:
        setReminderHandler();
        return;
  }
}

function dispatchCommandGroup4(context: Context, mode?: CommandMode, action?: string) {
  const {
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
  } = context;
  switch (mode) {
      case CommandMode.MyTasksSnooze:
        if (myTasksSnoozeEnabled) {
          setCommandMode(CommandMode.RemindMe);
          setShowCommands((prev) => ({ ...prev, mode: CommandMode.RemindMe }));
        } else {
          boardCloseHandler();
        }
        return;
      case CommandMode.RemoveParent:
        removeParentHandler();
        return;
      case CommandMode.RemoveSubtask:
        removeSubtaskHandler();
        return;
      case CommandMode.SuggestReply:
        if (!inViewObject.taskId) {
          toast.error("Open a task first to suggest a reply");
          boardCloseHandler();
          break;
        }
        boardCloseHandler();
        window.dispatchEvent(new CustomEvent(AI_SUGGEST_REPLY_EVENT));
        break;
      case CommandMode.SpeechToText:
        commentAudioSpeechToText();
        return;
      case CommandMode.AssignToMe:
        if (hasBulkSelection && bulkSelection) {
          void bulkSelection
            .assignSelected(currentUser, "assign")
            .finally(boardCloseHandler);
          return;
        }
        assignToMeHandler();
        return;
      case CommandMode.ToggleTimeTracking:
        void toggleTimeTrackingHandler();
        return;
      case CommandMode.ToggleStaleness:
        void toggleStalenessHandler();
        return;
      case CommandMode.ToggleStalenessView:
        void toggleStalenessViewHandler();
        return;
      case CommandMode.ToggleAutoArchive:
        void toggleAutoArchiveHandler();
        return;
      case CommandMode.SortByTimeInColumn:
        void sortByStalenessHandler("TimeInColumn");
        return;
      case CommandMode.SortByLastComment:
        void sortByStalenessHandler("TimeWithoutComment");
        return;
      case CommandMode.CalendarSettings:
        // openSettings before closing: closing first unmounts this handler's
        // host and the navigation never happens (matches BoardSettings above).
        openSettings("calendar");
        boardCloseHandler();
        return;
      case CommandMode.ToggleCalendarWeekends:
        setCalendarSettings((current) => ({
          ...current,
          showWeekends: !current.showWeekends,
        }));
        boardCloseHandler();
        return;
      case CommandMode.CalendarWeekStartsMonday:
        setCalendarSettings((current) => ({
          ...current,
          weekStartsOn: "monday",
        }));
        boardCloseHandler();
        return;
      case CommandMode.CalendarWeekStartsSunday:
        setCalendarSettings((current) => ({
          ...current,
          weekStartsOn: "sunday",
        }));
        boardCloseHandler();
        return;
      case CommandMode.ToggleSystemTheme:
        switchToTheme("system");
        boardCloseHandler();
        break;
      case CommandMode.StartKanbanTutorial:
        // Check if user is on kanban board page
        if (pathname?.startsWith("/project") || pathname?.match(/^\/[^\/]+$/)) {
          // End any existing tour first to ensure fresh start
          endTour();
          setSelectedTourId(TOUR_IDS.PROJECT);
          // Pass tour ID directly to ensure correct tour starts
          setTimeout(() => {
            startTour(TOUR_IDS.PROJECT);
          }, 150);
          boardCloseHandler();
        } else {
          toast.error(
            "Please navigate to a kanban board to start the tutorial"
          );
          boardCloseHandler();
        }
        break;
      case CommandMode.StartTaskWriterTutorial:
        // Check if user is on kanban board page
        if (pathname?.startsWith("/project") || pathname?.match(/^\/[^\/]+$/)) {
          // End any existing tour first to ensure fresh start
          endTour();
          setSelectedTourId(TOUR_IDS.TASK_WRITER);
          // Pass tour ID directly to ensure correct tour starts
          setTimeout(() => {
            startTour(TOUR_IDS.TASK_WRITER);
          }, 150);
          boardCloseHandler();
        } else {
          toast.error(
            "Please navigate to a kanban board to start the tutorial"
          );
          boardCloseHandler();
        }
        break;
      case CommandMode.CopyCommentContent:
        commentFunctionHandler("CopyCommentContent");
        return;
      case CommandMode.GotoProjectInbox:
        GoToHandler(
          `${globalConstants.inboxRoute}&projectId=${_currentProject?.id}`
        );
        return;
      case CommandMode.DeleteAllChats:
        deleteAllChats();
        return;

      case CommandMode.CreateCustomField:
        // handled by conditional render below — just keep commandMode set
        break;

      case CommandMode.TaskDescriptionVersions:
        // The modal below owns loading, inspection, confirmation, and restore.
        break;

      default:
        break;
  }
}
