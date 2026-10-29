import axios from "axios";
import toast from "react-hot-toast";
import globalAPIHandlers from "@/utils/api/global";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import type { TaskDetailContext } from "./TaskDetailContext";
import { useFlag } from "@/hooks/useFlag";
import { refreshTaskDetailReadAfterWrite } from "@/lib/taskDetailReads";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { HTPR_7185_DELETE_TASK_UNDO_FLAG } from "@/lib/flags/definitions/htpr-7185-delete-task-undo";
import { HTPR_7473_DELETE_CANCEL_CLOSES_FLAG } from "@/lib/flags/definitions/htpr-7473-delete-cancel-closes";
export function useTaskDetailModalActions(getContext: () => TaskDetailContext) {
  const deleteTaskUndo = useFlag(HTPR_7185_DELETE_TASK_UNDO_FLAG);
  const deleteCancelCloses = useFlag(HTPR_7473_DELETE_CANCEL_CLOSES_FLAG);
  const { deleteTodo } = UpdateKanban();
  const { showPriorityModal, currentTask, setShowPriorityModal, queryClient, activeItem, setShowRemindMeModal, searchParams, navigateToNextTask, showEstimateModal, setShowEstimateModal, setCurrentTask, setShowDueDateModal, setShowRemoveSubtaskModal, onGoback, navigate, _parsedTask, setCurrentProject, followers, currentUser, followerKeyPrefix, removeRelation } = getContext();

  const togglePriorityModal = (refresh?: boolean) => {
    const { updateActiveItemAndItemInView } = getContext();
    if (!showPriorityModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    setShowPriorityModal((prev) => !prev);
    if (refresh) {
      if (currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
      queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.priority, activeItem] });
    }
  };

  const toggleRemindMeModal = async (refresh?: boolean) => {
    setShowRemindMeModal((prev) => !prev);
    if (refresh) {
      const inboxFlow = searchParams?.get("inboxFlow");
      navigateToNextTask(true, true, true, "forceNavigate", inboxFlow);
    }
  };

  const toggleEstimateModal = (refresh?: boolean) => {
    const { updateActiveItemAndItemInView } = getContext();
    if (!showEstimateModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    setShowEstimateModal((prev) => !prev);
    if (refresh) {
      if (currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
      queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.estimate, activeItem] });
    }
  };

  const setDueDateCallback = (date: Date | undefined) => {
    if (!currentTask) return;
    // @ts-expect-error Spreading a nullable task produces optional required ITask fields.
    setCurrentTask((old) => ({ ...old, dueDate: date }));
  };

  const toggleDueDate = (refresh?: boolean) =>
    {
    return setShowDueDateModal((prev) => !prev);
  };

  const toggleRemoveSubtaskModal = () =>
    {
    return setShowRemoveSubtaskModal((prev) => !prev);
  };

  const deleteTask = async (state: boolean) => {
    const { toggleDeleteModal } = getContext();
    if (deleteCancelCloses && !state) return toggleDeleteModal();
    if (!currentTask || !state) return;
    try {
      const response = await globalAPIHandlers.deleteTaskAPI(currentTask.id);
      if (deleteTaskUndo) {
        await deleteTodo("Undo task delete", {
          id: currentTask.id,
          projectId: currentTask.projectId,
          status: "Deleted",
        });
      }
      if (currentUser?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id, { status: taskDetailConfig.taskStatus.deleted });
      console.log("🚀 ~ deleteTask ~ response:", response);
      // @ts-expect-error Spreading a nullable task produces optional required ITask fields.
      setCurrentTask((old) => ({ ...old, status: taskDetailConfig.taskStatus.deleted }));
      await queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.projectsAll] });
      if (!deleteTaskUndo) toast(taskDetailConfig.toastMessages.taskDeleted);
      if (deleteTaskUndo) navigate("Replace", `/project?id=${currentTask.projectId}`);
      else onGoback();
    } catch (error: any) {
      console.log("🚀 ~ deleteTask ~ error:", error);
      toast.error(taskDetailConfig.toastMessages.errorDeletingTask);
    } finally {
      toggleDeleteModal();
    }
  };

  const getTask = async (refresh = true) => {
    if (refresh && !(window.history.state?.cachedTaskDetail &&
      new URLSearchParams(window.location.search).get("inboxFlow") === "true")) {
      navigate(taskDetailConfig.navigation.refresh);
    }
    if (_parsedTask && _parsedTask.id !== taskDetailConfig.taskIds.newTask) {
      setCurrentProject(_parsedTask.project);
    }
  };

  const UnFollowCallback = () => {
    const matchedObject = followers.find(
      (item) => item.userId === currentUser?.id
    );
    UnFollow(matchedObject?.id);
  };

  const UnFollow = async (id: any) => {
    if (id) {
      try {
        await axios
          .post(taskDetailConfig.apiEndpoints.unfollowTask, {
            id: id,
          })
          .then((response) => {
            if (response.status === taskDetailConfig.httpStatus.ok) {
              if (currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
              queryClient.refetchQueries({
                queryKey: [followerKeyPrefix, currentTask?.id],
              });
            }
          });
      } catch (error) {
        console.log(error);
      }
    }
  };

  const removeRelationHandler = async (relationId: number) => {
    const response = await removeRelation(relationId);
    if (response) {
      // @ts-expect-error Spreading a nullable task produces optional required ITask fields.
      setCurrentTask((prev) => {
        return {
          ...prev,
          relatedFromTasks: prev?.relatedFromTasks?.filter(
            (item) => item.id !== relationId
          ),
          relatedToTasks: prev?.relatedToTasks?.filter(
            (item) => item.id !== relationId
          ),
        };
      });
    }
  };
  return { togglePriorityModal, toggleRemindMeModal, toggleEstimateModal, setDueDateCallback, toggleDueDate, toggleRemoveSubtaskModal, deleteTask, getTask, UnFollowCallback, UnFollow, removeRelationHandler };
}
