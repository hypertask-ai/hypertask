import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import useCopyURL from "@/hooks/General/useCopyURL";
import { ICurrentInViewObject } from "@/store";
import { usePathname } from "next/navigation";
import UpdateKanban from "../useUpdateTaskInBoards";
import toast from "react-hot-toast";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { IProject, ITask } from "@/models/model";
import { ViewVisibility } from "@prisma/client";
import useHypertasksNavigate from "../Route/useHypertasksNavigate";
import { shareLinkRoute } from "@/lib/constants/APIRouteConstants";
import useCreateTask from "./useCreateTask";
import {
  TDefaultEditFocus,
  TSectionPayload,
} from "@/models/CreateTaskModalModels/model";
import useFollowerKanban from "@/hooks/General/useFollowerKanban";
import { useRemoveParentTask } from "../Tasks";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7185_DELETE_TASK_UNDO_FLAG } from "@/lib/flags/definitions/htpr-7185-delete-task-undo";
import { HTPR_7473_DELETE_CANCEL_CLOSES_FLAG } from "@/lib/flags/definitions/htpr-7473-delete-cancel-closes";

interface IProps {
  callbackHandler?: (payload: any, mode: string) => void | Promise<void>;
  boardCloseHandler: () => void;
  toggleCreateTaskGlobally: (
    column_payload?: TSectionPayload,
    defaultEditFocus?: TDefaultEditFocus,
    duplicate?: any
  ) => void;
  inViewObject: ICurrentInViewObject;
  _currentProject: IProject | null;
  currentUser: any;
  _activeItem: number | null;
}

const useHTCTaskAndComments = ({
  callbackHandler,
  inViewObject,
  boardCloseHandler,
  _currentProject,
  currentUser,
  _activeItem,
  toggleCreateTaskGlobally,
}: IProps) => {
  const deleteTaskUndo = useFlag(HTPR_7185_DELETE_TASK_UNDO_FLAG);
  const deleteCancelCloses = useFlag(HTPR_7473_DELETE_CANCEL_CLOSES_FLAG);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const {
    copyTaskFormattedURL,
    copyTaskURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTicketNumber,
    copyTitleAndTicketNumber,
  } = useCopyURL();
  const { updateTaskInCache, removeFromListWithStatus } = UpdateKanban();
  const { addFollowerKanban, removeFollowerKanban } = useFollowerKanban();
  const { starTask } = useStarAndPin();
  const { getTask } = useCreateTask();
  const { navigate } = useHypertasksNavigate();
  const { removeParentTask } = useRemoveParentTask();
  const { goToProjectShortcut } = useProjectQuery();


  const commentAudioSpeechToText = () => {
    if (callbackHandler) callbackHandler(undefined, "SpeechToText");
    boardCloseHandler();
  };

  const followTaskHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "FollowTask");
    else _activeItem && addFollowerKanban(_activeItem);
    boardCloseHandler();
  };

  const unFollowTaskHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "UnfollowTask");
    else _activeItem && removeFollowerKanban(_activeItem);
    boardCloseHandler();
  };

  const starTaskHandler = async () => {
    if (pathname?.startsWith("/detail") && callbackHandler)
      return callbackHandler(undefined, "StarTask");
    else if (inViewObject) {
      const response = await starTask(
        inViewObject?.taskId!,
        inViewObject.taskProjectId!
      );
      if (response.status === 200) {
        const taskToReturn = { savedContent: [{ ...response.data }] };
        updateTaskInCache(
          taskToReturn,
          inViewObject?.taskId!,
          inViewObject?.taskProjectId!,
          inViewObject.sectionId,
          _currentProject
        );
        toast(`Starred Task ${inViewObject.taskTicketNumber?.toUpperCase()}`);
      } else {
        const taskToReturn = { savedContent: [] };
        updateTaskInCache(
          taskToReturn,
          inViewObject?.taskId!,
          inViewObject?.taskProjectId!,
          inViewObject.sectionId,
          _currentProject
        );
        toast(`Unstarred Task ${inViewObject.taskTicketNumber?.toUpperCase()}`);
      }
    }
    boardCloseHandler();
  };

  const copyPrivateURLHandler = async (formatted: boolean = false) => {
    if (_activeItem) {
      const copied = await axios.post(`/api/tasks/getTaskMinimal`, {
        id: _activeItem,
      });

      if (formatted)
        copyTaskFormattedURL(
          copied?.data?.title,
          copied?.data?.ticketNumber,
          copied?.data?.uniqueIndex,
          copied?.data?.projectId
        );
      else copyTaskURL(copied?.data?.uniqueIndex, copied?.data?.projectId);
    }
  };

  const copyPublicURLHandler = async (formatted: boolean = false) => {
    if (!inViewObject) return;
    const response = await axios.post(shareLinkRoute, {
      userId: currentUser?.id,
      taskId: inViewObject.taskId,
      projectId: inViewObject.taskProjectId,
    });

    if (response.status === 200) {
      const data = response.data.data;
      if (formatted)
        copySharedTaskFormattedURL(
          data.id,
          inViewObject.taskTitle!,
          inViewObject.taskTicketNumber!
        );
      else copySharedTaskURL(data.id);
    }
  };

  const copyURLFunctionHandler = (
    payload:
      | "Private"
      | "PrivateFormatted"
      | "Public"
      | "PublicFormatted"
      | "TitleAndID"
      | "ID"
  ) => {
    boardCloseHandler();
    if (pathname?.startsWith("/detail") && callbackHandler)
      callbackHandler(payload, "CopyFunctions");
    else
      switch (payload) {
        case "ID":
          if (!inViewObject) return;
          copyTicketNumber(inViewObject?.taskTicketNumber ?? "");
          return;
        case "TitleAndID":
          if (!inViewObject) return;
          copyTitleAndTicketNumber(
            inViewObject.taskTitle!,
            inViewObject.taskTicketNumber!
          );
          return;
        case "Private":
          copyPrivateURLHandler();
          return;
        case "PrivateFormatted":
          copyPrivateURLHandler(true);
          return;
        case "Public":
          copyPublicURLHandler();
          return;
        case "PublicFormatted":
          copyPublicURLHandler(true);
          return;
        default:
          break;
      }
  };

  const moveTaskToInboxHandler = async () => {
    boardCloseHandler();
    if (pathname?.startsWith("/detail") && callbackHandler)
      callbackHandler(undefined, "MoveTaskToInbox");
    else {
      const response = await axios.post("/api/notifications/moveTaskToInbox", {
        userId: currentUser.id,
        projectId: inViewObject.taskProjectId,
        taskId: inViewObject.taskId,
      });
      if (response.status === 200) {
        await toast.success("Task moved to inbox");
        queryClient.invalidateQueries({ queryKey: ["inbox"] });
        const taskToReturn = { _count: { notifications: 1 } };
        updateTaskInCache(
          taskToReturn,
          inViewObject.taskId,
          inViewObject.taskProjectId,
          inViewObject.sectionId,
          _currentProject
        );
      }
    }
  };

  const viewSubTasksHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "ViewSubTasks");
    boardCloseHandler();
  };

  const openAiWriterHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "OpenAiWriter");
    boardCloseHandler();
  };

  const summarizeTicketHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "SummarizeTicket");
    boardCloseHandler();
  };

  const archiveTaskHandler = async () => {
    if (inViewObject.sectionId && inViewObject.taskId && _currentProject) {
      if (callbackHandler) {
        await callbackHandler(inViewObject.taskId, "ARCHIVE");
      } else {
        const hasUndo = await removeFromListWithStatus(
          inViewObject.sectionId,
          _currentProject.id,
          inViewObject.taskId,
          "Archive"
        );
        if (!hasUndo) toast("Task archived!");
        navigate("Refresh");
        boardCloseHandler();
      }
    }
  };

  const removeSubtaskHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "RemoveSubtask");
  };

  const removeParentHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "RemoveParent");
    else if (inViewObject)
      removeParentTask({
        taskId: inViewObject.taskId!,
        projectId: inViewObject.taskProjectId!,
        sectionId: inViewObject.sectionId!,
      });
    boardCloseHandler();
  };

  const setReminderHandler = () => {
    if (callbackHandler) callbackHandler(undefined, "SetReminder");
    boardCloseHandler();
  };

  const toggleTimeTrackingHandler = async () => {
    if (pathname?.startsWith("/detail") && callbackHandler) {
      callbackHandler(undefined, "ToggleTimeTracking");
      boardCloseHandler();
      return;
    }

    const taskId = inViewObject?.taskId;
    if (!taskId) return;
    try {
      const summary = await axios.get(`/api/time/task?taskId=${taskId}`);
      await axios.post(
        summary.data.runningEntry ? "/api/time/stop" : "/api/time/start",
        { taskId }
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time", "task", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? "Unable to update timer");
    } finally {
      boardCloseHandler();
    }
  };
  const removeNotificationHandler = async () => {
    if (callbackHandler) callbackHandler(undefined, "ArchiveTaskNotification");
    else {
    }
    boardCloseHandler();
  };

  const confirmDelete = async (response: boolean) => {
    if (deleteCancelCloses && !response) return boardCloseHandler();
    if (
      response &&
      inViewObject.taskId &&
      _currentProject &&
      inViewObject.sectionId
    ) {
      await removeFromListWithStatus(
        inViewObject.sectionId,
        _currentProject.id,
        inViewObject.taskId,
        "Deleted"
      );
    }
    boardCloseHandler();
    if (pathname?.startsWith("/detail") && callbackHandler) {
      if (deleteTaskUndo && response && _currentProject && inViewObject.sectionId) {
        navigate("Replace", `/project?id=${_currentProject.id}`);
      } else navigate("Back");
    }
  };

  const setDueDateCallback = (date: Date | undefined) => {
    if (!inViewObject.taskId) return;
    const taskToReturn = { dueDate: date };
    updateTaskInCache(
      taskToReturn,
      inViewObject.taskId,
      inViewObject.taskProjectId,
      inViewObject.sectionId,
      _currentProject
    );
    if (callbackHandler) callbackHandler(date, "DueDate");
  };

  const duplicateTaskHandler = (pickBoard = false) => {
    getTask(inViewObject.taskId)
      .then((task) => {
        if (task)
          toggleCreateTaskGlobally(undefined, undefined, {
            ...task,
            description: task.description_?.content || task.description,
            pickBoard,
          });
        boardCloseHandler();
      })
      .catch((error) => {
        console.error("Error fetching task:", error);
      });
  };

  const commentFunctionHandler = (
    type:
      | "EditComment"
      | "ReplyToComment"
      | "ReactToComment"
      | "StarComment"
      | "CreateTaskFromComment"
      | "CopyCommentLinkURL"
      | "CopyCommentContent"
      | "BranchInNewChat"
      | "CopyCommentToAiChat"
      | "SummarizeComment"
      | "FastLikeComment",
    payload: any = undefined
  ) => {
    if (pathname?.startsWith("/detail") && callbackHandler)
      callbackHandler(payload, type);
    boardCloseHandler();
  };

  const taskFunctions = {
    starTaskHandler,
    copyURLFunctionHandler,
    moveTaskToInboxHandler,
    viewSubTasksHandler,
    openAiWriterHandler,
    summarizeTicketHandler,
    archiveHandler: archiveTaskHandler,
    confirmDelete,
    setDueDateCallback,
    removeNotificationHandler,
    duplicateTaskHandler,
    removeSubtaskHandler,
    removeParentHandler,
    setReminderHandler,
    followTaskHandler,
    unFollowTaskHandler,
    commentAudioSpeechToText,
    toggleTimeTrackingHandler,
  };

  const commentFunctions = {
    commentFunctionHandler,
  };

  return {
    ...taskFunctions,
    ...commentFunctions,
  };
};

export default useHTCTaskAndComments;
