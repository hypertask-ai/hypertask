import axios from "axios";
import toast from "react-hot-toast";
import globalAPIHandlers from "@/utils/api/global";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import type { TaskDetailContext } from "./TaskDetailContext";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7002_INBOX_E_FIRST_PRESS_FLAG, HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG } from "@/lib/flags/keys";
import { refreshTaskDetailReadAfterWrite } from "@/lib/taskDetailReads";
export function useTaskDetailModalActions(getContext: () => TaskDetailContext) {
  const inboxEFirstPress = useFlag(HTPR_7002_INBOX_E_FIRST_PRESS_FLAG);
  const dedupe = useFlag(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const { showPriorityModal, currentTask, setShowPriorityModal, queryClient, activeItem, setShowRemindMeModal, searchParams, navigateToNextTask, showEstimateModal, setShowEstimateModal, setCurrentTask, setShowDueDateModal, setShowRemoveSubtaskModal, onGoback, navigate, _parsedTask, setCurrentProject, followers, currentUser, followerKeyPrefix, removeRelation } = getContext();


  //  ===================================================================================================
  //  ============================================= API HANDLER FUNCTIONS ===============================
  //  ===================================================================================================

  // ----------------------- [PRESS P] || [CLICK ON Priority] (set Priority)
  const togglePriorityModal = (refresh?: boolean) => {
    const { updateActiveItemAndItemInView } = getContext();
    // Label clicks reach here without the keyboard handler's pointer update,
    // and the modal writes/refetches via inViewObject/activeItem. Re-point
    // them at the open task before showing, so the pick can't hit a stale
    // task after board hovers or in-detail navigation (HTPR-3731).
    if (!showPriorityModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    setShowPriorityModal((prev) => !prev);
    if (refresh) {
      if (dedupe && currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
      queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.priority, activeItem] });
    }
  };

  const toggleRemindMeModal = async (refresh?: boolean) => {
    setShowRemindMeModal((prev) => !prev);
    if (refresh) {
      // No router.refresh() here: navigateToNextTask queues router.replace to
      // the next task and a refresh's completing transition restores the old
      // URL, cancelling the advance (same bug as Ctrl+E, HTPR-4234). A snooze
      // always leaves the task page (HTPR-4595): next task when the playlist
      // has one, otherwise back to where the user came from.
      const inboxFlow = searchParams?.get("inboxFlow");
      navigateToNextTask(true, true, true, "forceNavigate", inboxFlow);
    }
  };

  // ----------------------- [PRESS S] || [CLICK ON Priority] (set Priority)
  const toggleEstimateModal = (refresh?: boolean) => {
    const { updateActiveItemAndItemInView } = getContext();
    // Same stale-pointer guard as togglePriorityModal (HTPR-3731).
    if (!showEstimateModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    setShowEstimateModal((prev) => !prev);
    if (refresh) {
      if (dedupe && currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
      queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.estimate, activeItem] });
    }
  };

  const setDueDateCallback = (date: Date | undefined) => {
    if (!currentTask) return;
    // setDueDateApiHandler(date, currentTask?.id!)
    // @ts-ignore
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

  // ----------------------- [PRESS #] (delete task)
  const deleteTask = async (state: boolean) => {
    const { toggleDeleteModal } = getContext();
    if (!currentTask || !state) return;
    try {
      const response = await globalAPIHandlers.deleteTaskAPI(currentTask.id);
      if (dedupe && currentUser?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id, { status: taskDetailConfig.taskStatus.deleted });
      console.log("🚀 ~ deleteTask ~ response:", response);
      // @ts-ignore
      setCurrentTask((old) => ({ ...old, status: taskDetailConfig.taskStatus.deleted }));
      await queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.projectsAll] });
      toast(taskDetailConfig.toastMessages.taskDeleted);
      onGoback();
    } catch (error: any) {
      console.log("🚀 ~ deleteTask ~ error:", error);
      toast.error(taskDetailConfig.toastMessages.errorDeletingTask);
    } finally {
      toggleDeleteModal();
    }
  };

  // ---------------------- GET TASK
  const getTask = async (refresh = true) => {
    // Cached Inbox detail already revalidates via its task query. A mount refresh can replay the source URL after E advances.
    if (refresh && !(inboxEFirstPress && window.history.state?.cachedTaskDetail &&
      new URLSearchParams(window.location.search).get("inboxFlow") === "true")) {
      navigate(taskDetailConfig.navigation.refresh);
    }
    if (_parsedTask && _parsedTask.id !== taskDetailConfig.taskIds.newTask) {
      setCurrentProject(_parsedTask.project);
      // setCurrentTask(task)
      // setComments(task.comments)
      // setValue(`${_parsedTask?.title}`);
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
              if (dedupe && currentUser?.id && currentTask?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id);
              // getFollowerById();
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
      // @ts-ignore
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
