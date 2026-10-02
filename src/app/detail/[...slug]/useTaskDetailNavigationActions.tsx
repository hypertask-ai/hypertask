import { IComment, ITaskLabel, ISection } from "@/models/model";
import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import globalConstants from "@/lib/constants";
import type { TaskDetailContext } from "./TaskDetailContext";
export function useTaskDetailNavigationActions(getContext: () => TaskDetailContext) {
  const { updateCommentsActivityQuery, comments, currentTask, setComments, sectionsForProjectTQ, movingItem, setCurrentTask, setMovingItem, removeFromListWithStatus, moveItem, getProjectIdxAndAllData, setTasksPlayList, currentUser, navigate, setEditMode, focusOn, lastGPress, defaultCommentFocus, scrollVirtualize, editModeCheck, markAsDone, copyTaskURL, undoAction, queryClient, navigateToPreviousTask, showCreateLabelModal, setShowCreateLabelModal, _parsedTask, updateTaskInCache, currentProject, lastM_APress, setShowMoveTaskToBoard, currentId } = getContext();


  //  ===================================================================================================
  //  ============================================= HELPER FUNCTIONS ====================================
  //  ===================================================================================================

  const taskUpdateCommentsInCache = (newComment: IComment) => {
    updateCommentsActivityQuery(
      comments,
      newComment,
      currentTask!.id,
      (comments: IComment[]) => setComments(comments)
    );
  };

  async function moveTaskToNextColumn(sectionToMoveTo: ISection) {
    try {
      const sectionsInModal: ISection[] = sectionsForProjectTQ;
      if (sectionsInModal.length === 0 || !currentTask || movingItem) return;
      const currentTaskSectionId = currentTask.sectionId!;

      setCurrentTask((prev) =>
        prev
          ? {
              ...prev,
              sectionId: sectionToMoveTo.id,
              section: sectionToMoveTo.section_title,
            }
          : prev
      );

      setMovingItem(true);
      const response = await fetch(taskDetailConfig.apiEndpoints.moveTask, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentTask.projectId,
          taskId: currentTask.id,
          section_title: sectionToMoveTo.section_title,
          sectionId: sectionToMoveTo.id,
          section: sectionToMoveTo?.section_title,
        }),
      });

      if (response.status === taskDetailConfig.httpStatus.ok) {
        const data = await response.json();
        taskUpdateCommentsInCache(data.newComment);

        if (!sectionToMoveTo.visibility)
          await removeFromListWithStatus(
            currentTaskSectionId,
            currentTask.projectId,
            currentTask.id,
            taskDetailConfig.taskStatus.move
          );
        // router.refresh()
        else
          await moveItem({
            destinationSectionId: sectionToMoveTo.id!,
            itemId: currentTask.id,
            sourceSectionId: currentTaskSectionId,
          });

        const { allData, projectToUpdateIndex } =
          getProjectIdxAndAllData(currentTask.projectId);
        const projectAfterMove =
          allData?.updatedProjects?.[projectToUpdateIndex];
        const sourceSection = projectAfterMove?.filteredSections.find(
          (section) =>
            section.sectionId === currentTaskSectionId ||
            section.id === currentTaskSectionId
        );

        // Keep detail navigation anchored to the column being triaged after the moved task leaves it.
        if (projectAfterMove)
          setTasksPlayList(
            (sourceSection?.items ?? []).map((task) => ({
              projectId: task.projectId,
              uniqueIndex: task.uniqueIndex,
            }))
          );
      }

      setMovingItem(false);
    } catch (error) {
      console.error("🚀 ~ moveTaskToNextColumn ~ error:", error);
    }
  }

  function returnCurrentFocusedType() {
    if (
      currentTask?.userId?.toString === currentUser.id.toString &&
      document.activeElement?.id === descriptionContainerId
    )
      return "Description";
    else if (document.activeElement?.id?.indexOf("comment-") === 0)
      return "Edit-Comment";
    else if (document.activeElement?.id === "comment") return "New-Comment";
    else return "Others";
  }
  // handler for when user presses escape during title edit mode, if in "CREATE TASK" mode, then do router.back
  // apparently, this doesn't even run, the actual place it runs is in taskTitle file
  const titleEscapeHandler = () => {
    console.log("🚀 ~ titleEscapeHandler ~ currentTask:", currentTask);
    if (currentTask?.id === -1) return navigate("Back");
    setEditMode(null);
    focusOn("title");
  };

  const gPressHandler = (e: any, shift: boolean) => {
    const now = new Date().getTime();
    const lastGPressedBw500ms =
      lastGPress.current &&
      now - lastGPress.current < taskDetailConfig.delays.doubleKeyPress;
    if (lastGPressedBw500ms) {
      lastGPress.current = null;
      if (shift) {
        defaultCommentFocus();
      } else {
        focusOn(descriptionContainerId, false);
        scrollVirtualize("description");
      }
      e.preventDefault();
    } else {
      // setLastGPress(now);
      lastGPress.current = now;
      setTimeout(() => {
        if (lastGPress.current === now) lastGPress.current = null;
      }, globalConstants.gThenKeyDelay);
      editModeCheck;
      return;
    }
  };

  // --------------- keypress handler for [Enter]
  const EnterHandler = (e: any) => {
    // ==-------------------== Mark As Done
    if (document.activeElement?.id === taskDetailConfig.elementIds.markAsDone) markAsDone();
    if (document.activeElement?.id === taskDetailConfig.elementIds.copyTaskUrlButton)
      copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
  };

  // --------------- keypress handler for [CTRL]+[Enter]
  const CTRL_ENTERHandler = (e: any) => {
    // edit title
    if (document.activeElement?.id === taskDetailConfig.elementIds.title) {
      // console.log("enter pressesss one",document.activeElement?.id)

      setTimeout(() => {
        setEditMode(taskDetailConfig.editModes.title);
      }, taskDetailConfig.delays.titleEditMode);
    }
  };

  // undoHandler function
  const undoHandler = async (data: any, toastId: string) => {
    // console.log('🚀 ~ undoHandler ~ data:', data);
    // first, you need to bring the item back to its place.
    // then, you need to run the API call so there is no render blocking.
    await undoAction("UNDO_INBOX_ARCHIVE", data);
    queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.inbox] });
    navigate("Refresh");
    toast(taskDetailConfig.toastMessages.undoNotificationArchive);
    toast.dismiss(toastId); // Dismiss the toast here
    navigateToPreviousTask(false, true); // false, true means undo wasn't CLICKED, but pressed
  };

  // ============ toggle estimate modal
  const toggleLabelModal = (
    taskLabels?: ITaskLabel[],
    refresh?: boolean,
    shouldCloseOnUpdate = true
  ) => {
    const { updateActiveItemAndItemInView } = getContext();
    console.log("current label modal value: ", showCreateLabelModal);

    // Same stale-pointer guard as togglePriorityModal (HTPR-3731).
    if (!showCreateLabelModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    if (shouldCloseOnUpdate) setShowCreateLabelModal((prev) => !prev);
    if (refresh && taskLabels) {
      queryClient.prefetchQuery({ queryKey: [taskDetailConfig.queryKeys.taskLabels, _parsedTask.id] });

      const taskToReturn = { taskLabels: taskLabels };
      updateTaskInCache(
        taskToReturn,
        _parsedTask.id,
        _parsedTask.projectId,
        _parsedTask.sectionId,
        currentProject
      );
      queryClient.refetchQueries({
        queryKey: [globalConstants.CommentsTQPrefixKey, _parsedTask.id],
      });

      // updateLabels(taskLabels,sectionId, _activeItem??id)
    }
  };

  // [a] handler
  const aHandler = () => {
    const { updateActiveItemAndItemInView, toggleModal } = getContext();
    const now = new Date().getTime();
    if (lastM_APress.current && now - lastM_APress.current < 500) {
      lastM_APress.current = null;
      return;
    }
    lastM_APress.current = now;
    currentTask && updateActiveItemAndItemInView(currentTask.id);
    toggleModal();
  };

  // --------------------=================== END KEYPRESS HELPERS ----------------=====================================
  const toggleMoveToBoardModal = () => {
    return setShowMoveTaskToBoard((prev) => !prev);
  };

  // ---------------------- return focus to comment
  const returnFocusToComment = () => {
    const extractedId = currentId.replace("-input", ""); // Remove the "-input" part
    focusOn(extractedId);
  };
  return { taskUpdateCommentsInCache, moveTaskToNextColumn, returnCurrentFocusedType, titleEscapeHandler, gPressHandler, EnterHandler, CTRL_ENTERHandler, undoHandler, toggleLabelModal, aHandler, toggleMoveToBoardModal, returnFocusToComment };
}
