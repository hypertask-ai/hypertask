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


  const closeCallback = async () => {
    router.refresh();
    boardCloseHandler();
  };

  const switchToInvite = (mode: CommandMode, projectId: number) => {
    setCommandMode(mode);
    setCallbackProjectId(projectId);
  };

  const redirectToManageSubscriptions = (preSelect: preSelectParamPricing) => {
    boardCloseHandler();
    router.push(constructPricingPageUrl(_currentProject!, preSelect));
  };

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

  function toggleAssignModal(updatedAssignees?: any[], keepOpen?: boolean) {
    if (Array.isArray(updatedAssignees)) {
      updateTaskInCache(
        { assignees: updatedAssignees },
        inViewObject.taskId,
        inViewObject.taskProjectId,
        inViewObject.sectionId,
        taskProject
      );
      refreshRowTaskList();
      if (pathname?.startsWith("/detail") && callbackHandler)
        callbackHandler(updatedAssignees, "Assignees");
    }
    if (!keepOpen) boardCloseHandler();
  }

  async function togglePriorityModal(refresh?: boolean | IPrioritiesConstants) {
    if (refresh && refresh === true)
      await queryClient.refetchQueries({ queryKey: ["priority", _activeItem] });
    queryClient.invalidateQueries({ queryKey: ["inbox"] });

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

  async function toggleEstimateModal(refresh?: boolean | IEstimateConstants) {
    if (refresh)
      await queryClient.refetchQueries({ queryKey: ["estimate", _activeItem] });
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
    const estimateData: IEstimate | undefined = await queryClient.getQueryData([
      "estimate",
      inViewObject.taskId,
    ]);
    const taskToReturn = { estimate: estimateData };
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

  const togglRemindMeModal = async (refresh?: boolean) => {
    boardCloseHandler();
    if (refresh && myTasksSnoozeEnabled) {
      window.dispatchEvent(new CustomEvent("my-tasks-snooze-changed"));
    }
  };

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
    }
    if (shouldCloseOnUpdate) boardCloseHandler();
  };
  const toggleBoardSortingHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

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
    if (newAgent?.id) router.push(`/agents/${newAgent.id}`);
  }

  const toggleInboxSettingsHandler = async (refresh?: boolean) => {
    if (refresh) {
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    }
    boardCloseHandler();
  };

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
