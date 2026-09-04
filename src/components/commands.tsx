import { useContext, useEffect, useState } from "react";

import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  activeSectionIdAtom,
  activeItemAtom,
  currentProjectAtom,
  showCommandsAtom,
  inViewObjectAtom,
  showQuickTipsAtom,
  showShortcutsAtom,
  showAIChatInterfaceAtom,
  isAiChatSidebarModeAtom,
  aiChatAutoOpenSuppressedAtom,
  aiChatPinnedAtom,
  agentToEditAtom,
  showTaskHistoryAtom,
  toggleAllCommentsSignalAtom,
  archiveBoardScopeAtom,
  boardLayoutAtom,
  boardZoomedOutAtom,
  tableVisibleColumnsAtom,
  setTableStalenessColumns,
  appShellRailAtom,
  appShellRailExpandedAtom,
  calendarSettingsAtom,
  type IShowHypertaskHTC,
} from "@/store";
import { CommandMode } from "@/models/enums";
import { dispatchAgentChatCommand } from "@/lib/agents/chatPaletteCommands";
import { toggleProjectBoardZoom } from "@/hooks/Kanban/mobileBoardGestures";
import {
  IAgent,
  IAllCommands,
  IEstimate,
  IPriority,
  IProject,
  IProjectsAll,
  ISection,
  ITask,
  ITaskLabel,
  IUser,
  IViewType,
  preSelectParamPricing,
} from "@/models/model";
import axios from "axios";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { parseCookies } from "nookies";
import { useQueryClient } from "@tanstack/react-query";
import { createTeam } from "@/utils/api/Homepage";
import { markAsUnseen } from "@/utils/api/Inbox";
import { setRecurrenceApiHandler } from "@/utils/api/Task Detail";
import type { PickerOption } from "./Modals/OptionPicker";
import { RECURRENCE_LABELS, RECURRENCE_RULES } from "@/lib/recurrence";
import {
  LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
  type LearnTutorialColumnCreatedDetail,
} from "@/lib/tutorial/learnTutorialState";

import dynamic from "next/dynamic";
// ─── Dynamic Imports ────────────────────────────────────────────────────────────
const InviteMember = dynamic(() => import("./Modals/commands/inviteMember"));
const EditBoard = dynamic(() => import("./Modals/commands/editBoard"));
const CreateBoard = dynamic(() => import("./Modals/commands/createBoard"));
const BoardCreationAssistant = dynamic(
  () => import("./Modals/BoardCreationAssistant")
);
const AddColumn = dynamic(() => import("./Modals/commands/addColumn"));
const CreateTeam = dynamic(() => import("./Modals/CreateTeam/CreateTeam"));
const MoveTaskGlobal = dynamic(() => import("./Modals/MoveTaskToBoard"));
const ConfirmTaskDelete = dynamic(
  () => import("./Modals/confirmDeleteModals/confirmtTaskDelete")
);
const ConfirmArchiveBoard = dynamic(
  () => import("./Modals/commands/confirmArchiveBoard")
);
const ConfirmDeleteBoard = dynamic(
  () => import("./Modals/commands/confirmDeleteBoard")
);
const ManageLabels = dynamic(() => import("./Modals/ManageLabels"));
const CreateLabel = dynamic(() => import("./Modals/CreateLabel/CreateLabel"));
const RemindMeComponent = dynamic(
  () => import("./Modals/RemindMe/RemindMeComponent")
);
const TrialModal = dynamic(() => import("./Modals/TrialPlan/TrialModal"));
const SubtaskLinkingModal = dynamic(
  () => import("./Modals/SubtaskLinkingModal/SubtaskLinking")
);
const McpTokenModal = dynamic(() => import("./Modals/McpToken/McpTokenModal"));
const SwitchAccountModal = dynamic(
  () => import("./Modals/commands/SwitchAccount/SwitchAccountModal")
);
const SignOutModal = dynamic(() => import("./Modals/SignOut/SignOutModal"));
const CliInstallModal = dynamic(() => import("./Modals/CliInstall/CliInstallModal"));
const RestApiModal = dynamic(() => import("./Modals/RestApi/RestApiModal"));
const AgentModal = dynamic(() => import("./Modals/Agent/agent.modal"), {
  ssr: false,
});
const Shortcut = dynamic(() => import("./sidebars/keyboardShortcuts"));
const ManageColumns = dynamic(() => import("./Modals/commands/manageColumn"));
const MoveToColumn = dynamic(() => import("./Modals/commands/moveToColumn"));
const DeleteMessage = dynamic(() => import("./Modals/commands/DeleteMessage"));
const ManageFavorites = dynamic(() => import("./Modals/ManageFavorites"));
const SetPriorityModal = dynamic(() => import("./Modals/TaskPriority"));
const BoardPriorityMode = dynamic(
  () => import("./Modals/Kanban/BoardPriorityMode")
);
const TaskEstimateModal = dynamic(
  () => import("./Modals/TaskEstimate/TaskEstimate")
);
const AllFilterHTC = dynamic(
  () => import("./Modals/FilterModals/SelectFilters/FilterHTC")
);
const DueDateModal = dynamic(() => import("./Modals/DueDate"));
const StartDateModal = dynamic(() => import("./Modals/StartDate"));
const OptionPickerModal = dynamic(() => import("./Modals/OptionPicker"));
const AssignModal = dynamic(() => import("./Modals/AssignToUser/AssignToUser"));
const BlockedByPersonModal = dynamic(
  () => import("./Modals/BlockedByPerson/BlockedByPerson")
);
const AutoAssignColumn = dynamic(
  () => import("./Modals/commands/autoAssignColumn")
);
const ConfirmModal = dynamic(
  () => import("@/components/Modals/Common Modals/ConfirmActionModal")
);
const SubtaskSettings = dynamic(
  () => import("./Modals/SubTaskSettings/SubTaskSettings")
);
const ManageViews = dynamic(
  () => import("./Modals/ViewModals/ManageViewsModals")
);
const ViewsForBoard = dynamic(
  () => import("./Modals/ViewModals/ViewsForBoardModal")
);
const ShareTaskModal = dynamic(() => import("./Modals/ShareTaskModal"));
const RenameTaskModal = dynamic(() => import("./Modals/RenameTask.modal"));
const FeedbackModal = dynamic(() => import("./Modals/Feedback/FeedbackModal"));
const TaskRelationPicker = dynamic(
  () => import("./Modals/TaskRelationPicker/TaskRelationPicker")
);
const TableColumnsPicker = dynamic(
  () => import("./PageComponents/Kanban/TableView/TableColumnsPicker")
);
const SwipeUnread = dynamic(() => import("./Modals/SwipeUnread/SwipeUnread"), {
  ssr: false,
});
const CreateCustomFieldModal = dynamic(
  () => import("./Modals/CustomField/CreateCustomFieldModal")
);
const ManageCustomFieldsModal = dynamic(
  () => import("./Modals/CustomField/ManageCustomFieldsModal")
);
const SmartSplitModal = dynamic(
  () => import("./Modals/ViewModals/SmartSplitModal")
);
const TaskDescriptionHistoryModal = dynamic(
  () => import("./Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal")
);

// ─── Static Imports ─────────────────────────────────────────────────────────────
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import globalConstants from "@/lib/constants";
import useInviteCallbackHandlers from "@/hooks/MultiPages/useInviteCallbackHandlers";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { useGetBoardInviteURL } from "@/hooks/Homepage/Invites/useGetBoardInviteURL";
import Commands from "./Modals/commands/HTC/commands";
import { useGetSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { constructPricingPageUrl } from "@/utils/helperFunctions/helperFunctions";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import {
  getActiveColumnsViewFromProject,
  getViewFromProject,
  getActiveEmptySectionSettingFromProject,
  getActiveSortingStackFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useToggleShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { getActiveStalenessFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import useHTCTaskAndComments from "@/hooks/MultiPages/HTC/useHTCTaskAndComments";
import { useTourContext } from "@/lib/tours";
import { TOUR_IDS } from "@/lib/tours/types";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { IPrioritiesConstants } from "@/lib/constants/constants";
import { IEstimateConstants } from "@/lib/constants/constants";
import { useAssignTaskUser } from "@/hooks/Task Detail/useAssignTaskUser";
import {
  isSettingsSectionId,
  useSettingsNavigation,
} from "./Modals/Settings/settingsNavigation";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import {
  getLastFocusedTiptapEditor,
  putSnippetDraftHandoff,
  openSnippetPicker,
} from "@/lib/snippets";
import { boardRunningTimersQueryKey } from "@/hooks/Task Detail/useTimeTracking";
import { getAcceptDestination } from "@/utils/triageDestination";
import { buildBranchName } from "@/utils/branchName";
import InboxZeroSheet from "@/components/notifications/InboxZeroSheet";
import { INBOX_ZERO_PRESETS } from "@/lib/inboxZero";
import { timeQuickLogTaskUrl } from "@/lib/timeQuickLog";
import { useGlobalUIState } from "./ProviderGlobal/useGlobalUIState";
import { buildFullScreenChatPath } from "@/lib/aiChatDisplayMode";
import { useUndoContext } from "@/hooks/General/useUndo";
import { useKanbanBulkSelectionOptional } from "@/lib/contexts/Kanban/BulkSelectionContext";
import {
  openTaskTemplateDraft,
  taskTemplatePickerForProject,
  type TaskTemplatePickerState,
} from "@/lib/taskTemplatePrefill";

interface IHTCProps {
  callbackHandler?: (payload: any, mode: string) => void | Promise<void>;
  contextOptions?: IAllCommands;
}

const HypertasksCommands = ({ callbackHandler, contextOptions }: IHTCProps) => {
  const queryClient = useQueryClient();
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
  const [aiChatPinned, setAiChatPinned] = useRecoilState(aiChatPinnedAtom);
  const { resetShowCommands, toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { switchToTheme } = useDarkMode();
  const { openSettings } = useSettingsNavigation();
  const { openAnnouncements } = useGlobalUIState();
  const billing = useCurrentBoardBilling();
  const { undoLatest } = useUndoContext();
  const bulkSelection = useKanbanBulkSelectionOptional();
  const hasBulkSelection = (bulkSelection?.selectedCount ?? 0) > 0;
  const bulkTasks = bulkSelection?.selectedTasks ?? [];
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
  const { startTour, setSelectedTourId, endTour } = useTourContext();
  const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom);
  const boardLayout = useRecoilValue(boardLayoutAtom);
  const [, setTableVisibleColumns] = useRecoilState(tableVisibleColumnsAtom);
  const [_activeItem, setActiveItem] = useRecoilState(activeItemAtom);
  const [callbackProjectId, setCallbackProjectId] = useState<number | null>(null);
  const [inViewObject, __] = useRecoilState(inViewObjectAtom);
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
    _currentProject,
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

  const setRecurrenceHandler = async (option: PickerOption) => {
    boardCloseHandler();
    if (!inViewObject.taskId) return;
    const rule = option.id === null ? null : String(option.id);
    try {
      await setRecurrenceApiHandler(rule, inViewObject.taskId);
      queryClient.invalidateQueries({ queryKey: ["task-", inViewObject.taskId] });
      toast.success(rule ? `Repeats ${option.label.toLowerCase()}` : "Repeat off");
    } catch {
      toast.error("Could not update the repeat rule");
    }
  };

  const saveTaskTemplateHandler = async () => {
    boardCloseHandler();
    if (!inViewObject.taskId) return;
    try {
      await axios.post("/api/task-templates", { taskId: inViewObject.taskId });
      toast.success("Saved as template");
    } catch {
      toast.error("Could not save the template");
    }
  };

  const openTaskTemplateHandler = (option: PickerOption) => {
    const opened = openTaskTemplateDraft(
      option.id,
      taskTemplatePickerForCurrentProject.templates,
      taskTemplatePickerForCurrentProject.context,
      (duplicate) =>
        toggleCreateTaskGlobally(undefined, undefined, duplicate),
    );
    if (!opened) {
      toast.error("Could not find an open column for this task");
      boardCloseHandler();
      return;
    }

    boardCloseHandler();
  };

  const generateStatusUpdateHandler = async () => {
    boardCloseHandler();
    if (!_currentProject?.id) return;
    const pending = toast.loading("Writing the status update…");
    try {
      const { data } = await axios.post("/api/reports/status-update", {
        projectId: _currentProject.id,
      });
      toast.dismiss(pending);
      toast.success("Status update ready");
      if (data?.url) router.push(data.url);
    } catch (error: any) {
      toast.dismiss(pending);
      toast.error(
        error?.response?.data?.error ?? "Could not generate the status update"
      );
    }
  };

  const toggleStalenessHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const enabled = !_currentProject.stalenessEnabled;
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? { ...project, stalenessEnabled: enabled }
        : project;

    try {
      await axios.post("/api/projects/staleness", {
        projectId: _currentProject.id,
        enabled,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(`Staleness turned ${enabled ? "on" : "off"}`);
    } catch {
      toast.error("Unable to update staleness");
    } finally {
      boardCloseHandler();
    }
  };

  const toggleAutoArchiveHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const enabled = _currentProject.autoArchiveAfterDays == null;
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? { ...project, autoArchiveAfterDays: enabled ? 180 : null }
        : project;

    try {
      await axios.post("/api/projects/auto-archive", {
        projectId: _currentProject.id,
        enabled,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(
        enabled
          ? "Auto-archive on: tasks idle for 6 months get archived"
          : "Auto-archive turned off"
      );
    } catch {
      toast.error("Unable to update auto-archive");
    } finally {
      boardCloseHandler();
    }
  };

  const updateAutoAssignHandler = async (
    sectionId: number,
    {
      autoAssignUserId,
      autoAssignAgentId,
    }: {
      autoAssignUserId: number | null;
      autoAssignAgentId: string | null;
    },
  ) => {
    if (!_currentProject) return boardCloseHandler();

    const updateSections = (sections?: ISection[]) =>
      sections?.map((section) =>
        (section.id ?? section.sectionId) === sectionId
          ? { ...section, autoAssignUserId, autoAssignAgentId }
          : section
      );
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? {
            ...project,
            section: updateSections(project.section),
            sections: updateSections(project.sections) ?? project.sections,
            filteredSections:
              updateSections(project.filteredSections) ?? project.filteredSections,
          }
        : project;

    try {
      await axios.post("/api/sections/auto-assign", {
        sectionId,
        autoAssignUserId,
        autoAssignAgentId,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(
        autoAssignUserId == null && autoAssignAgentId == null
          ? "Column auto-assign cleared"
          : "Column auto-assign updated"
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ?? "Unable to update column auto-assign"
      );
    } finally {
      boardCloseHandler();
    }
  };

  const toggleStalenessViewHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const next = !getActiveStalenessFromProject(_currentProject);
    try {
      // Persist into the active saved view so it survives navigation. When the
      // board has no saved view, the primary view IS the board, so fall back to
      // the board-level setting.
      const persisted = await saveStalenessToViewAPI(_currentProject, next);
      if (persisted === "none") {
        await axios.post("/api/projects/staleness", {
          projectId: _currentProject.id,
          enabled: next,
        });
      }
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      await queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] });
      if (boardLayout === "table") {
        setTableVisibleColumns((visible) => setTableStalenessColumns(visible, next));
      }
      toast.success(`Staleness ${next ? "shown" : "hidden"} on this view`);
    } catch {
      toast.error("Unable to update staleness for this view");
    } finally {
      boardCloseHandler();
    }
  };

  const sortByStalenessHandler = async (
    mode: "TimeInColumn" | "TimeWithoutComment"
  ) => {
    if (!_currentProject) return boardCloseHandler();

    try {
      // Keep any tie-break levels: this command changes the primary sort, it is not a request to
      // clear the rest of the stack. A duplicate of the new primary is dropped on read.
      await setBoardSortingViewAndReturn(
        _currentProject,
        mode,
        "Descending",
        getActiveSortingStackFromProject(_currentProject)
      );
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    } catch {
      toast.error("Unable to sort this board");
    } finally {
      boardCloseHandler();
    }
  };

  const acceptTaskHandler = async () => {
    const taskId = inViewObject.taskId;
    const sourceSectionId = inViewObject.sectionId;

    if (!taskId || !sourceSectionId || !_currentProject) {
      toast.error("Unable to find this task on the board");
      boardCloseHandler();
      return;
    }

    const destinationSection = getAcceptDestination(
      _currentProject.section ?? _currentProject.sections ?? [],
      sourceSectionId
    );
    const destinationSectionId =
      destinationSection?.sectionId ?? destinationSection?.id;

    if (!destinationSection || !destinationSectionId) {
      toast.error("No later column is available for this task");
      boardCloseHandler();
      return;
    }

    try {
      if (callbackHandler) {
        await callbackHandler(destinationSection, "AcceptTask");
      } else {
        await axios.put("/api/tasks/moveTask", {
          projectId: _currentProject.id,
          taskId,
          section_title: destinationSection.section_title,
          sectionId: destinationSectionId,
        });
        // Match the established move pattern: a hidden destination column is
        // synced by removing from the source list, a visible one by moving the
        // item. Accept can land on a hidden column since getAcceptDestination
        // reads the unfiltered section list.
        if (!destinationSection.visibility) {
          await removeFromListWithStatus(
            sourceSectionId,
            inViewObject.taskProjectId ?? _currentProject.id,
            taskId,
            "Move"
          );
          setActiveItem(null);
        } else {
          await moveItem({
            destinationSectionId,
            itemId: taskId,
            sourceSectionId,
          });
        }
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Unable to accept task");
    } finally {
      boardCloseHandler();
    }
  };

  const handleAction = (mode?: CommandMode, action?: string) => {
    if (mode) {
      setShowCommands((prev) => ({ ...prev, mode }));
      setCommandMode(mode);
    }

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
        if (showAiChatInterface) setAiChatPinned(false);
        boardCloseHandler();
        break;
      case CommandMode.PinAIChatOpen:
        //prevent mobile and login page from ever opening
        if (isMbl || pathname?.startsWith("/login")) break;
        setAiChatPinned(!aiChatPinned);
        if (!aiChatPinned) {
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
        copyViewURL();
        break;
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
  };

  const subscribeGoogleCalendar = async () => {
    boardCloseHandler();
    try {
      const { data } = await axios.get("/api/calendar/feed-url");
      if (!data?.url) throw new Error("no url");
      await navigator.clipboard?.writeText(data.url);
      window.open(
        `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=${encodeURIComponent(
          data.url
        )}`,
        "_blank"
      );
      toast.success(
        "Feed URL copied — paste it in Google Calendar if it isn't prefilled"
      );
    } catch {
      toast.error("Could not generate your calendar feed URL");
    }
  };

  const copyViewURL = () => {
    const baseURL =
      String(process.env.NEXT_PUBLIC_BASEURL) ?? "https://app.hypertask.ai";
    const activeView: IViewType | undefined =
      getViewFromProject(_currentProject);
    if (activeView) {
      if (activeView.type === "Unsaved")
        return toast.error(`${activeView.type} views cannot be shared!`);
      if (
        activeView.type === "Applied" &&
        activeView.view.visibility === "Private"
      )
        return toast.error(`Private views cannot be shared!`);
      toast(`View ${activeView.view.title} copied to clipboard`);
      navigator.clipboard.writeText(
        `${baseURL}/project?id=${_currentProject?.id}${
          activeView === null ? "" : `&view=${activeView.view.slug}`
        }`
      );
      return boardCloseHandler();
    } else toast("No active views.");
  };

  const copyBranchNameHandler = async () => {
    const ticketNumber = inViewObject.taskTicketNumber;
    const title = inViewObject.taskTitle;

    if (!ticketNumber || !title) {
      boardCloseHandler();
      return;
    }

    try {
      await navigator.clipboard.writeText(buildBranchName(ticketNumber, title));
      toast.success("Branch name copied");
    } catch {
      toast.error("Unable to copy branch name");
    } finally {
      boardCloseHandler();
    }
  };

  const assignToMeHandler = async () => {
    if (!inViewObject.taskId) return boardCloseHandler();

    try {
      const updatedAssignees = await assignTaskUser(
        currentUser,
        inViewObject.taskId,
        "assign"
      );
      toggleAssignModal(updatedAssignees);
    } catch {
      toast.error("Unable to assign this task");
      boardCloseHandler();
    }
  };

  const GoToHandler = (href: string, shouldNewTab?: boolean) => {
    boardCloseHandler();
    shouldNewTab ? window.open(href, "_blank") : router.push(href);
  };

  // Replay the onboarding sequence on demand. Carry the current board so the
  // connect-AI / tutorial / launch steps land back on it when finished.
  const GoToOnboarding = () => {
    boardCloseHandler();
    router.push(
      `/onboarding?projectId=${_currentProject?.id}&teamTitle=${encodeURIComponent(
        _currentProject?.team?.title ?? ""
      )}&id=${_currentProject?.teamId}`
    );
  };

  const deleteAllChats = async () => {
    const response = await axios.delete(
      "/api/ai-chat/delete-session?delete=ALL"
    );
    if (response.status === 200) {
      toast.success("All chat sessions deleted successfully");
    } else {
      toast.error("Failed to delete all chat sessions");
    }
    queryClient.invalidateQueries({
      queryKey: ["chat-sessions", currentUser?.uid],
    });
    boardCloseHandler();
  };

  const toggleBoardTimeTrackingHandler = async () => {
    if (!_currentProject?.id) {
      boardCloseHandler();
      return;
    }

    const enabled = !_currentProject.timeTrackingEnabled;
    try {
      const { data } = await axios.post("/api/projects/time-tracking", {
        projectId: _currentProject.id,
        enabled,
      });
      const newState = data.enabled as boolean;
      setCurrentProject({ ..._currentProject, timeTrackingEnabled: newState });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: boardRunningTimersQueryKey(_currentProject.id),
        }),
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
      ]);
      toast.success(
        newState
          ? "Time tracking on for this board"
          : "Time tracking off for this board"
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ?? "Unable to update time tracking"
      );
    } finally {
      boardCloseHandler();
    }
  };

  const createBoard = async (
    mode: string,
    title: string,
    teamId: string | null,
    googleAccountId: string | null,
    teamTitle?: string
  ) => {
    if (!_currentProject) return;
    // The create route rejects with a reason the user needs to see (e.g. the free
    // board limit); without this the rejection was silent and the modal just hung.
    try {
      if (mode === "CreateTeamBoard" && teamTitle) {
        const body = {
          userId: currentUser?.id,
          teamTitle: teamTitle,
        };
        const response = await createTeam(body);
        const { data } = await axios.post("/api/projects/create", {
          userId: currentUser?.id,
          title,
          googleAccountId: response.data.googleAccountId,
          teamId: response.data.id,

        });
        receieveResponse(data, "Team");
      } else {
        const { data } = await axios.post("/api/projects/create", {
          userId: currentUser?.id,
          title,
          googleAccountId: googleAccountId,
          teamId: teamId,

        });
        receieveResponse(data, "Board");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ?? "Unable to create board"
      );
      boardCloseHandler();
    }
  };
  // =========== create board and update cache
  const receieveResponse = async (data: any, type: "Team" | "Board") => {
    if (data) {
      setCurrentProject(data);
    }
    router.refresh();
    await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    await queryClient.refetchQueries({ queryKey: ["getAllTeamsMinimal"] });
    await queryClient.refetchQueries({ queryKey: ["getAllFavorites"] });
    goToProjectShortcut(data.id, true);
    boardCloseHandler();
  };

  const redirectToTrash = () => {
    if (!_currentProject) return;
    router.push(`/trash/${_currentProject.id}`);
  };

  // ================ mark as unread function.
  const markUnread = async () => {
    if (_activeItem) {
      await markAsUnseen(inViewObject.taskId, false, "byTaskId");
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      queryClient.refetchQueries({ queryKey: ["inbox"] });
      toast("Marked as Unread");
      boardCloseHandler();
    }
  };

  const hideActiveColumn = async () => {
    const currentProject = _currentProject as IProject | null;
    if (!currentProject) return;

    const sections = getActiveColumnsViewFromProject(currentProject);
    const section = sections.find((section) => section.id === activeSectionId);
    if (!section || !section.visibility) return;

    const sendUpdateSection = {
      ...section,
      visibility: false,
    };
    const updatedSections = sections.map((section) =>
      section.id === sendUpdateSection.id
        ? { ...section, ...sendUpdateSection }
        : section
    );

    queryClient.setQueryData(
      [
        globalConstants.GetAllManageColumnsPrefixKey,
        currentProject.id,
        currentUser.id,
      ],
      updatedSections
    );
    setBoardColumnsViewAPI(currentProject, updatedSections);
  };

  const createColumn = async (title: string, ranking: string | undefined) => {
    if (!_currentProject) return;

    // HTPR-5527: axios rejects on 4xx/5xx, so an unguarded call left the dialog
    // open forever with no message when the create failed.
    let response;
    try {
      response = await axios.post("/api/section/create", {
        projectId: _currentProject.id,
        title,
        ranking,
      });
    } catch (error) {
      console.log("🤔 ~ createColumn ~ error:", error);
      toast.error("Error creating column");
      boardCloseHandler();
      return;
    }

    let createdSectionForReveal: ISection | undefined;
    if (response.status === 200) {
      try {
        const createdSection = response.data?.section;
        if (
          Number.isSafeInteger(createdSection?.id) &&
          Number.isSafeInteger(createdSection?.projectId) &&
          typeof createdSection?.section_title === "string"
        ) {
          window.dispatchEvent(
            new CustomEvent<LearnTutorialColumnCreatedDetail>(
              LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
              {
                detail: {
                  columnId: createdSection.id,
                  projectId: createdSection.projectId,
                  title: createdSection.section_title,
                },
              }
            )
          );
        }
        toast.success(`Column ${title} created successfully`);
        const { projectToUpdateIndex } = getProjectIdxAndAllData(
          _currentProject?.id
        );
        // HTPR-5542: pass the created section, not just the refreshed view. A
        // board that has never saved a view has no Project_View row, so the
        // route answers project_view: null and a view-only update was skipped —
        // the column existed in the database but never reached the board.
        createdSectionForReveal = Number.isSafeInteger(createdSection?.id)
          ? { ...createdSection, items: [] }
          : undefined;
        updateProjectView(
          projectToUpdateIndex,
          response.data.project_view,
          Number.isSafeInteger(createdSection?.id)
            ? { ...createdSection, items: [] }
            : undefined
        );
      } catch (error: any) {
        console.log("🤔 ~ createColumn ~ error:", error);
      }
    } else toast.error("Error creating column");
    boardCloseHandler();
    return createdSectionForReveal;
  };

  const updateBoard = async (title: string) => {
    if (!_currentProject) return;

    setCurrentProject({ ..._currentProject, title });
    renameBoard(title, _currentProject.id);
    boardCloseHandler();

    await axios.post("/api/projects/update", {
      projectId: _currentProject.id,
      title,
      sorting_mode: _currentProject.sorting_mode,
    });
  };

  const removeMemberLocal = async (member: IUser) => {
    if (!_currentProject) return;
    await removeMemberFromBoard(member, _currentProject);
    boardCloseHandler();
  };

  const addAgentToBoardLocal = async (agent: IAgent) => {
    if (!_currentProject) return;
    await addAgentToBoard(agent, _currentProject);
    boardCloseHandler();
  };

  const removeAgentFromBoardLocal = async (agent: IAgent) => {
    if (!_currentProject) return;
    await removeAgentFromBoard(agent, _currentProject);
    boardCloseHandler();
  };

  //  ----------------------------INVITE NEW MEMBER
  const inviteNewMemberHandlerLocal = async (emails: string[]) => {
    if (!_currentProject) return;
    await inviteNewMembersToBoard(emails, _currentProject, currentUser);
    boardCloseHandler();
  };

  function toggleManageColumns(add: boolean = false) {
    if (add) {
      setShowCommands({ show: true, mode: CommandMode.AddColumn });
      setCommandMode(CommandMode.AddColumn);
      return;
    }
    boardCloseHandler();
  }

  // ---------------------------- TASK MOVE TO DIFFERENT COLUMN HANDLER
  const closeCallback = async () => {
    // console.log(task)
    //inboxRefetchHandler();
    router.refresh();
    boardCloseHandler();
  };

  // --------------------------- switch to invite
  const switchToInvite = (mode: CommandMode, projectId: number) => {
    setCommandMode(mode);
    setCallbackProjectId(projectId);
  };

  // =============== redirect to manage subscriptions page
  const redirectToManageSubscriptions = (preSelect: preSelectParamPricing) => {
    boardCloseHandler();
    router.push(constructPricingPageUrl(_currentProject!, preSelect));
  };

  // --------------------------- Delete Comment
  const DeleteMessageHandler = (id: number) => {
    if (callbackHandler) callbackHandler(id, "DELETE");
    boardCloseHandler();
  };

  async function toggleRenameTaskModal(title: string) {
    if (title.length === 0 || title === inViewObject?.taskTitle)
      return boardCloseHandler();
    const taskToReturn = { title: title };

    updateTaskInCache(
      taskToReturn,
      inViewObject.taskId,
      inViewObject.taskProjectId,
      inViewObject.sectionId,
      _currentProject
    );
    boardCloseHandler();
  }

  // ============ [A] sync assignees into the kanban card after assigning via HTC
  function toggleAssignModal(updatedAssignees?: any[], keepOpen?: boolean) {
    // AssignToUser calls onClose(response.data.body, true) with the fresh
    // assignees rows on assign/unassign, or onClose() with nothing on a
    // plain dismiss.
    if (Array.isArray(updatedAssignees)) {
      updateTaskInCache(
        { assignees: updatedAssignees },
        inViewObject.taskId,
        inViewObject.taskProjectId,
        inViewObject.sectionId,
        _currentProject
      );
      // The open task detail view holds its own currentTask copy that the board
      // cache update above doesn't touch, so bridge the fresh assignees to it.
      if (pathname?.startsWith("/detail") && callbackHandler)
        callbackHandler(updatedAssignees, "Assignees");
    }
    // keepOpen mirrors the detail view: keep the menu up so several people
    // can be toggled in one session (HTPR-3731).
    if (!keepOpen) boardCloseHandler();
  }

  // ============ [shift [s]] toggle priority modal
  async function togglePriorityModal(refresh?: boolean | IPrioritiesConstants) {
    if (refresh && refresh === true)
      await queryClient.refetchQueries({ queryKey: ["priority", _activeItem] });
    queryClient.invalidateQueries({ queryKey: ["inbox"] });

    // ====================== find the project (inViewObject)
    const priority_data: IPriority | undefined = await queryClient.getQueryData(
      ["priority", inViewObject.taskId]
    );
    const taskToReturn = { priority: priority_data! as IPriority };

    updateTaskInCache(
      taskToReturn,
      inViewObject.taskId,
      inViewObject.taskProjectId,
      inViewObject.sectionId,
      _currentProject
    );
    boardCloseHandler();
  }

  // ============ [S] toggle priority modal
  async function toggleEstimateModal(refresh?: boolean | IEstimateConstants) {
    if (refresh)
      await queryClient.refetchQueries({ queryKey: ["estimate", _activeItem] });
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
    const estimateData: IEstimate | undefined = await queryClient.getQueryData([
      "estimate",
      inViewObject.taskId,
    ]);
    const taskToReturn = { estimate: estimateData };
    // console.log("🚀 ~ toggleEstimateModal ~ estimateData:", estimateData)
    // console.log("🚀 ~ toggleEstimateModal ~ taskToReturn:", taskToReturn)
    updateTaskInCache(
      taskToReturn,
      inViewObject.taskId,
      inViewObject.taskProjectId,
      inViewObject.sectionId,
      _currentProject
    );

    boardCloseHandler();
  }

  // ============ toggle estimate modal
  const togglRemindMeModal = async (refresh?: boolean) => {
    boardCloseHandler();
  };

  // ============ toggle estimate modal
  const toggleLabelModal = async (
    taskLabels?: ITaskLabel[],
    refresh?: boolean,
    shouldCloseOnUpdate = true
  ) => {
    if (refresh && taskLabels) {
      await queryClient.prefetchQuery({
        queryKey: ["taskLabels", inViewObject.taskId],
      });
      const taskToReturn = { taskLabels: taskLabels };
      updateTaskInCache(
        taskToReturn,
        inViewObject.taskId,
        inViewObject.taskProjectId,
        inViewObject.sectionId,
        _currentProject
      );
      queryClient.refetchQueries({
        queryKey: [globalConstants.CommentsTQPrefixKey, inViewObject.taskId],
      });
      queryClient.refetchQueries({ queryKey: ["inbox"] });

      // updateLabels(taskLabels,sectionId, _activeItem??id)
    }
    if (shouldCloseOnUpdate) boardCloseHandler();
  };
  // ============ toggle board sorting modal
  const toggleBoardSortingHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

  // ============ toggle subtask setting modal
  const toggleSubTaskSettingsHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

  const toggleManageViewsHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

  const toggleBoardViewsHandler = async (
    switchToManage?: boolean,
    refresh?: boolean
  ) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    if (switchToManage) {
      setShowCommands({ show: true, mode: CommandMode.ManageViews });
      setCommandMode(CommandMode.ManageViews);
      return;
    }
    boardCloseHandler();
  };

  function closeCallbackCreateAgent(newAgent?: IAgent) {
    setAgentToEdit(null);
    boardCloseHandler();
    // A new agent has a page of its own now, so creating one takes you there
    // rather than back to the list modal it was launched from.
    if (newAgent?.id) router.push(`/agents/${newAgent.id}`);
  }

  // ============ toggle inbox split setting modal
  const toggleInboxSettingsHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

  // ============ toggle board sorting modal
  const toggleSubtaskLinkingHandler = async (
    refresh?: boolean,
    task?: ITask
  ) => {
    boardCloseHandler();
    if (refresh) {
      if (callbackHandler) callbackHandler(task, "AddSubtask");
      return queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    }
  };

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

  return (
    <>
      {commandMode === CommandMode.Shortcut && <Shortcut />}
      <div
        id="htc-container"
        className={
          isMbl
            // Mobile: this transparent full-screen layer only positions inline
            // palette content, but reactstrap command sub-modals (Set theme,
            // Set priority, …) portal to <body> at a LOWER z-index than this
            // z-[9999] overlay — so the overlay sat on top of them and swallowed
            // every tap (visible but dead). pointer-events-none lets taps fall
            // through to those portaled modals; the inner wrapper re-enables
            // pointer events for content that renders inline here.
            ? "fixed inset-0 z-[9999] bg-transparent pointer-events-none"
            : "fixed left-0 right-0 top-[180px] z-[9999] flex items-center justify-center bg-transparent"
        }
      >
        <div className={isMbl ? "bg-transparent pointer-events-auto" : "rounded-[5px] bg-modalBackground customshadow-4"}>
          {commandMode === CommandMode.Command && (
            <Commands
              isOpen={commandMode === CommandMode.Command}
              handleAction={handleAction}
              contextOptions={paletteContextOptions}
              showByokApiKeys={billing?.storePlanId === "BYOK"}
              appShellRailOn={appShellRailOn && !isMbl}
              scope={(showCommands as IShowHypertaskHTC).scope}
            />
          )}

          {commandMode === CommandMode.SwipeThroughUnread && (
            <SwipeUnread
              userId={currentUser.id}
              onClose={boardCloseHandler}
            />
          )}

          {commandMode === CommandMode.SendFeedback && (
            <FeedbackModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.TrialModal && _currentProject && (
            <TrialModal closeCallback={boardCloseHandler} />
          )}
          {commandMode === CommandMode.MoveTaskToBoard && (
            <MoveTaskGlobal closeHTC={boardCloseHandler} />
          )}
          {relationPicker && activeTaskId && (
            <TaskRelationPicker
              closeHandler={boardCloseHandler}
              currentTaskId={activeTaskId}
              header={relationPicker.header}
              relationType={relationPicker.relationType}
              onRelationAdded={async (relations) => {
                await callbackHandler?.(relations, "AddRelation");
                if (commandMode === CommandMode.DeclineAsDuplicateOf) {
                  // Archive in its own try so a failure here is not reported as
                  // a relation error (the relation already succeeded) and does
                  // not block the picker from closing.
                  try {
                    await archiveHandler();
                  } catch {
                    toast.error("Marked as duplicate, but could not archive the task");
                  }
                }
              }}
            />
          )}
          {commandMode === CommandMode.Logout && (
            <SignOutModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.DeleteTask && (
            <ConfirmTaskDelete
              confirmDelete={confirmDelete}
              content="Clicking confirm will delete this task! Task can be recovered within 30 days."
            />
          )}
          {commandMode === CommandMode.ArchiveBoard && (
            <ConfirmArchiveBoard onClose={boardCloseHandler} />
          )}
          {commandMode === CommandMode.DeleteBoard && (
            <ConfirmDeleteBoard onClose={boardCloseHandler} />
          )}

          {commandMode === CommandMode.ShowFilterHTC && (
            <AllFilterHTC toggle={boardCloseHandler} view="Kanban" />
          )}

          {commandMode === CommandMode.DeleteMessage && (
            <DeleteMessage callback={DeleteMessageHandler} />
          )}
          {commandMode === CommandMode.SetDueDate && (
            <DueDateModal
              mode={"Update"}
              closeHandler={(callback, reset) => {
                boardCloseHandler();
                if (callback) setDueDateCallback(callback);
                else if (reset) setDueDateCallback(undefined);
              }}
            />
          )}
          {commandMode === CommandMode.SetStartDate && (
            <StartDateModal
              closeHandler={(date, reset) => {
                boardCloseHandler();
                if (date || reset) {
                  queryClient.invalidateQueries({
                    queryKey: ["task-", inViewObject.taskId],
                  });
                  if (callbackHandler) callbackHandler(date ?? undefined, "StartDate");
                }
              }}
            />
          )}
          {commandMode === CommandMode.SetRecurrence && (
            <OptionPickerModal
              header="Repeat task"
              placeholder="Type to filter…"
              options={[
                ...(_activeTask?.recurrence
                  ? [{ id: null, label: "Don't repeat" }]
                  : []),
                ...RECURRENCE_RULES.map((rule) => ({
                  id: rule,
                  label: RECURRENCE_LABELS[rule],
                  hint: _activeTask?.recurrence === rule ? "Current" : undefined,
                })),
              ]}
              onSelect={setRecurrenceHandler}
              onClose={boardCloseHandler}
            />
          )}
          {commandMode === CommandMode.NewTaskFromTemplate && (
            <OptionPickerModal
              header="New task from template"
              placeholder="Type to filter templates…"
              options={taskTemplatePickerForCurrentProject.templates.map(
                (template) => ({
                  id: template.id,
                  label: template.name,
                }),
              )}
              emptyMessage="No templates yet — use “Save task as template” on a task first"
              onSelect={openTaskTemplateHandler}
              onClose={boardCloseHandler}
            />
          )}
          {commandMode === CommandMode.OpenAssignModal && (
            hasBulkSelection && bulkSelection && bulkTasks[0] ? (
              <AssignModal
                onClose={boardCloseHandler}
                task={{
                  id: bulkTasks[0].id,
                  title: bulkTasks[0].title,
                  link: "",
                }}
                assignees={_activeTaskAssignees}
                bulkTaskIds={bulkTasks.map((task) => task.id)}
                onBulkAssign={(assignee) =>
                  bulkSelection.assignSelected(assignee, "assign")
                }
              />
            ) : inViewObject.taskId ? (
            <AssignModal
              onClose={toggleAssignModal}
              task={{
                id: inViewObject.taskId,
                title: inViewObject.taskTitle ?? "",
                link: "",
              }}
              assignees={_activeTaskAssignees}
            />
            ) : null
          )}
          {commandMode === CommandMode.OpenBlockedByModal &&
            inViewObject.taskId && (
              <BlockedByPersonModal
                taskId={inViewObject.taskId}
                projectId={
                  _activeTask?.projectId ?? inViewObject.taskProjectId ?? 0
                }
                waitingOnUserId={_activeTask?.waitingOnUserId}
                onClose={(fields) => {
                  if (fields && callbackHandler) {
                    callbackHandler(fields, "WaitingOn");
                  }
                  boardCloseHandler();
                }}
              />
            )}
          {commandMode === CommandMode.AutoAssignColumn && _currentProject && (
            <AutoAssignColumn
              project={_currentProject}
              onClose={boardCloseHandler}
              onSelect={updateAutoAssignHandler}
            />
          )}
          {commandMode === CommandMode.CreateTeam &&
            currentUser.UserSetting.trialStatus && (
              <CreateTeam createBoard={createBoard} />
            )}
          {commandMode === CommandMode.NewBoard && (
            <CreateBoard
              createBoard={createBoard}
              payload={showCommands.payload}
            />
          )}
          {commandMode === CommandMode.BoardCreationAssistant && (
            <BoardCreationAssistant onClose={boardCloseHandler} />
          )}
          {commandMode === CommandMode.ManageFavorites && (
            <ManageFavorites onClose={boardCloseHandler} />
          )}

          {commandMode === CommandMode.AddColumn && (
            <AddColumn
              createColumn={createColumn}
              toggleModal={boardCloseHandler}
              // hideColumn ={hideColumn}
              // renameColumn =
            />
          )}

          {
            // _currentProject?.sorting_mode==="Manual"&&
            commandMode === CommandMode.MoveToColumn &&
            hasBulkSelection &&
            bulkSelection &&
            bulkTasks[0] &&
            _currentProject ? (
              <MoveToColumn
                projectId={_currentProject.id}
                task={{
                  taskId: bulkTasks[0].id,
                  projectId: bulkTasks[0].projectId,
                  sectionId: bulkTasks[0].sectionId ?? null,
                }}
                bulkTaskIds={bulkTasks.map((task) => task.id)}
                onBulkMove={(section) => bulkSelection.moveSelected(section)}
                moveTaskToColumnHandler={boardCloseHandler}
                title="Move selected tasks to column"
              />
            ) : (
            contextOptions?.task && commandMode === CommandMode.MoveToColumn && !hasBulkSelection && (
              <MoveToColumn
                projectId={contextOptions.task.projectId}
                task={contextOptions.task}
                moveTaskToColumnHandler={boardCloseHandler}
              />
            )
            )
          }
          {(commandMode === CommandMode.ManageColumn ||
            commandMode === CommandMode.DeleteColumn ||
            commandMode === CommandMode.RenameColumn) && (
            <ManageColumns toggleModal={toggleManageColumns} />
          )}

          {commandMode === CommandMode.EditBoard && (
            <EditBoard updateBoard={updateBoard} />
          )}

          {commandMode === CommandMode.BoardJoinResetLink && (
            <InviteMember
              startingScreen="ShareLink"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
          {commandMode === CommandMode.InviteMember && (
            <InviteMember
              startingScreen="Home"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
          {commandMode === CommandMode.ManageMembers && (
            <InviteMember
              startingScreen="Home"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
          {commandMode === CommandMode.SortKanbanBoard && (
            <BoardPriorityMode closeHandler={toggleBoardSortingHandler} />
          )}
          {commandMode === CommandMode.ManageLabels && (
            <ManageLabels
              onClose={boardCloseHandler}
              // closeHandler={boardCloseHandler}
            />
          )}
          {commandMode === CommandMode.PriorityModal && (
            <SetPriorityModal mode="Task" closeHandler={togglePriorityModal} />
          )}
          {commandMode === CommandMode.EstimateModal && (
            <TaskEstimateModal mode="Task" closeHandler={toggleEstimateModal} />
          )}

          {commandMode === CommandMode.LabelModal && (
            hasBulkSelection && bulkSelection ? (
              <CreateLabel
                currentProject={_currentProject ?? undefined}
                taskIds={bulkTasks.map((task) => task.id)}
                onBulkLabel={(label) => bulkSelection.labelSelected(label)}
                closeHandler={boardCloseHandler}
                onManageTags={() => {
                  setShowCommands({
                    show: true,
                    mode: CommandMode.ManageLabels,
                  });
                  setCommandMode(CommandMode.ManageLabels);
                }}
              />
            ) : (
            <CreateLabel
              closeHandler={toggleLabelModal}
              onManageTags={() => {
                setShowCommands({
                  show: true,
                  mode: CommandMode.ManageLabels,
                });
                setCommandMode(CommandMode.ManageLabels);
              }}
            />
            )
          )}
          {commandMode === CommandMode.RemindMe && (
            <RemindMeComponent closeHandler={togglRemindMeModal} />
          )}
          {commandMode === CommandMode.SubtaskSettings && (
            <SubtaskSettings toggle={toggleSubTaskSettingsHandler} />
          )}
          {commandMode === CommandMode.ManageViews && (
            <ManageViews toggle={toggleManageViewsHandler} />
          )}
          {commandMode === CommandMode.CreateSmartSplit && _currentProject && (
            <SmartSplitModal
              projectId={_currentProject.id}
              onClose={toggleManageViewsHandler}
            />
          )}
          {commandMode === CommandMode.ShowBoardViews && _currentProject && (
            <ViewsForBoard
              toggle={toggleBoardViewsHandler}
              project={_currentProject as IProject}
            />
          )}
          {commandMode === CommandMode.CreateSubTask && inViewObject && (
            <SubtaskLinkingModal
              closeHandler={toggleSubtaskLinkingHandler}
              taskInfo={{
                id: inViewObject.taskId!,
                projectId: inViewObject.taskProjectId!,
                section: inViewObject.sectionTitle!,
                sectionId: inViewObject.sectionId!,
                title: inViewObject.taskTitle!,
                ticketNumber: inViewObject.taskTicketNumber!,
              }}
            />
          )}
          {commandMode === CommandMode.ShareTaskPublic && inViewObject && (
            <ShareTaskModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.GenerateMcpToken && (
            <McpTokenModal
              currentUser={currentUser}
              closeHandler={boardCloseHandler}
              onOpenCli={() => handleAction(CommandMode.CliInstall)}
            />
          )}
          {commandMode === CommandMode.SwitchAccount && (
            <SwitchAccountModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.CliInstall && (
            <CliInstallModal
              closeHandler={boardCloseHandler}
              onOpenMcp={() => handleAction(CommandMode.GenerateMcpToken)}
            />
          )}
          {commandMode === CommandMode.RestApi && (
            <RestApiModal
              closeHandler={boardCloseHandler}
              onOpenMcp={() => handleAction(CommandMode.GenerateMcpToken)}
              onOpenCli={() => handleAction(CommandMode.CliInstall)}
            />
          )}
          {commandMode === CommandMode.ConfigureTableColumns && (
            <TableColumnsPicker closeHandler={boardCloseHandler} projectId={_currentProject?.id} />
          )}
          {commandMode === CommandMode.ManageCustomFields && (
            <ManageCustomFieldsModal closeHandler={boardCloseHandler} projectId={_currentProject?.id} />
          )}
          {commandMode === CommandMode.RenameTask && inViewObject && (
            <RenameTaskModal closeCallback={toggleRenameTaskModal} />
          )}
          {commandMode === CommandMode.CreateAgent && (
            <AgentModal key={agentToEdit?.id ?? "create"} closeHandler={closeCallbackCreateAgent} />
          )}
          {/* Managing agents and reviewing switched-off ones is the /agents
              page now, so neither modal is rendered from the palette. */}
          {commandMode === CommandMode.CreateCustomField && (
            <CreateCustomFieldModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.TaskDescriptionVersions && activeTaskId && (
            <TaskDescriptionHistoryModal
              taskId={activeTaskId}
              onClose={boardCloseHandler}
              onRestored={() => callbackHandler?.(undefined, "DescriptionRestored")}
            />
          )}
          {inboxZeroRules && (
            <InboxZeroSheet
              key={commandMode}
              initialRules={inboxZeroRules}
              onClose={boardCloseHandler}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default HypertasksCommands;
