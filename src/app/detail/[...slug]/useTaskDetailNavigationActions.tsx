import { useFlag } from "@/hooks/useFlag";
import { HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG, HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG } from "@/lib/flags/keys";
import { refreshTaskDetailReadAfterWrite } from "@/lib/taskDetailReads";
import { moveTask, readMoveTaskResponse } from "@/lib/api/typedClient";
import { IComment, ITaskLabel, ISection } from "@/models/model";
import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import globalConstants from "@/lib/constants";
import type { TaskDetailContext } from "./TaskDetailContext";
export function useTaskDetailNavigationActions(getContext: () => TaskDetailContext) {
  const dedupe = useFlag(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const boardCardFresh = useFlag(HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG);
  const { updateCommentsActivityQuery, comments, currentTask, setComments, sectionsForProjectTQ, movingItem, setCurrentTask, setMovingItem, removeFromListWithStatus, moveItem, getProjectIdxAndAllData, setTasksPlayList, currentUser, navigate, setEditMode, focusOn, lastGPress, defaultCommentFocus, scrollVirtualize, editModeCheck, markAsDone, copyTaskURL, undoAction, queryClient, navigateToPreviousTask, showCreateLabelModal, setShowCreateLabelModal, _parsedTask, updateTaskInCache, currentProject, lastM_APress, setShowMoveTaskToBoard, currentId } = getContext();

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
      const response = await moveTask({ projectId: currentTask.projectId, taskId: currentTask.id, section_title: sectionToMoveTo.section_title, sectionId: sectionToMoveTo.id!, section: sectionToMoveTo.section_title });

      if (response.status === taskDetailConfig.httpStatus.ok) {
        if (dedupe && currentUser?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, currentTask.id, { sectionId: sectionToMoveTo.id, section: sectionToMoveTo.section_title });
        const data = await readMoveTaskResponse(response);
        taskUpdateCommentsInCache(data.newComment);

        if (!sectionToMoveTo.visibility)
          await removeFromListWithStatus(
            currentTaskSectionId,
            currentTask.projectId,
            currentTask.id,
            taskDetailConfig.taskStatus.move
          );
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
      lastGPress.current = now;
      setTimeout(() => {
        if (lastGPress.current === now) lastGPress.current = null;
      }, globalConstants.gThenKeyDelay);
      editModeCheck;
      return;
    }
  };

  const EnterHandler = (e: any) => {
    if (document.activeElement?.id === taskDetailConfig.elementIds.markAsDone) markAsDone();
    if (document.activeElement?.id === taskDetailConfig.elementIds.copyTaskUrlButton)
      copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
  };

  const CTRL_ENTERHandler = (e: any) => {
    if (document.activeElement?.id === taskDetailConfig.elementIds.title) {
      setTimeout(() => {
        setEditMode(taskDetailConfig.editModes.title);
      }, taskDetailConfig.delays.titleEditMode);
    }
  };

  const undoHandler = async (data: any, toastId: string) => {
    await undoAction("UNDO_INBOX_ARCHIVE", data);
    queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.inbox] });
    navigate("Refresh");
    toast.dismiss(toastId);
    navigateToPreviousTask(false, true);
  };

  const toggleLabelModal = (
    taskLabels?: ITaskLabel[],
    refresh?: boolean,
    shouldCloseOnUpdate = true
  ) => {
    const { updateActiveItemAndItemInView } = getContext();
    console.log("current label modal value: ", showCreateLabelModal);

    if (!showCreateLabelModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    if (shouldCloseOnUpdate) setShowCreateLabelModal((prev) => !prev);
    if (refresh && taskLabels) {
      queryClient.prefetchQuery({ queryKey: [taskDetailConfig.queryKeys.taskLabels, _parsedTask.id] });

      const taskToReturn = { taskLabels: taskLabels };
      const boardTask = boardCardFresh && currentTask ? currentTask : _parsedTask;
      updateTaskInCache(
        taskToReturn,
        boardTask.id,
        boardTask.projectId,
        boardTask.sectionId,
        currentProject
      );
      queryClient.refetchQueries({
        queryKey: [globalConstants.CommentsTQPrefixKey, _parsedTask.id],
      });
    }
  };

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

  const toggleMoveToBoardModal = () => {
    return setShowMoveTaskToBoard((prev) => !prev);
  };

  const returnFocusToComment = () => {
    const extractedId = currentId.replace("-input", "");
    focusOn(extractedId);
  };
  return { taskUpdateCommentsInCache, moveTaskToNextColumn, returnCurrentFocusedType, titleEscapeHandler, gPressHandler, EnterHandler, CTRL_ENTERHandler, undoHandler, toggleLabelModal, aHandler, toggleMoveToBoardModal, returnFocusToComment };
}
