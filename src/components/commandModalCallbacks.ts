import { CommandMode } from "@/models/enums";
import { IAgent, IEstimate, IPriority, ITask, ITaskLabel, preSelectParamPricing } from "@/models/model";
import globalConstants from "@/lib/constants";
import { constructPricingPageUrl } from "@/utils/helperFunctions/helperFunctions";
import { IPrioritiesConstants } from "@/lib/constants/constants";
import { IEstimateConstants } from "@/lib/constants/constants";
import type { IHTCProps } from "./commandTypes";
import type { useCommandsState } from "./useCommandsState";

type Context = Pick<IHTCProps, "callbackHandler"> &
  Pick<ReturnType<typeof useCommandsState>, "router" | "boardCloseHandler" | "setCommandMode" | "setCallbackProjectId" | "_currentProject" | "inViewObject" | "updateTaskInCache" | "taskProject" | "refreshRowTaskList" | "pathname" | "queryClient" | "_activeItem" | "myTasksSnoozeEnabled" | "setShowCommands" | "setAgentToEdit">;

export function createCommandModalCallbacks(context: Context) {
  const {
  router, boardCloseHandler, setCommandMode, setCallbackProjectId, _currentProject,
  callbackHandler, inViewObject, updateTaskInCache, taskProject, refreshRowTaskList,
  pathname, queryClient, _activeItem, myTasksSnoozeEnabled, setShowCommands,
  setAgentToEdit,
  } = context;


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
      taskProject
    );
    boardCloseHandler();
    refreshRowTaskList();
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
        taskProject
      );
      refreshRowTaskList();
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
      taskProject
    );
    boardCloseHandler();
    if (refresh) refreshRowTaskList();
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
      taskProject
    );

    boardCloseHandler();
    if (refresh) refreshRowTaskList();
  }

  // ============ toggle estimate modal
  const togglRemindMeModal = async (refresh?: boolean) => {
    boardCloseHandler();
    if (refresh && myTasksSnoozeEnabled) {
      window.dispatchEvent(new CustomEvent("my-tasks-snooze-changed"));
    }
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
        taskProject
      );
      refreshRowTaskList();
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
  return {
  redirectToManageSubscriptions, DeleteMessageHandler, toggleRenameTaskModal, toggleAssignModal, togglePriorityModal,
  toggleEstimateModal, togglRemindMeModal, toggleLabelModal, toggleBoardSortingHandler, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, closeCallbackCreateAgent, toggleSubtaskLinkingHandler,
  };
}
