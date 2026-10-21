import { IUser, IAttachment, IAssignees } from "@/models/model";

import { useCallback } from "react";
import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { ViewVisibility } from "@prisma/client";
import globalConstants from "@/lib/constants";
import { hasFigmaEmbed } from "@/utils/helperFunctions/hasFigmaEmbed";
import type { TaskDetailContext } from "./TaskDetailContext";
export function useTaskDetailCommentActions(getContext: () => TaskDetailContext) {
  const { currentId, comments, editCommentHandler, handlePinComment, currentTask, toggleCreateTaskGlobally, refocusAndOpenTaskWriter, queryClient, _parsedTask, defaultCommentFocus, scrollVirtualize, _setActiveItem, setInViewObject, showAssignModal, setCurrentTask, updateTaskInCache, currentProject, setShowAssignModal, setShowTaskDeleteModal, setShowLinksModal, showMoveModal, navigate, setShowMoveModal } = getContext();


  const handleEditCommentFromHTC = useCallback(() => {
    const { getCurrentCommentIndex } = getContext();
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;
    editCommentHandler(commentIndex);
  }, [currentId, comments]);

  const handleStarCommentFromHTC = useCallback(
    (type: ViewVisibility) => {
    const { getCurrentCommentIndex } = getContext();
      const commentIndex = getCurrentCommentIndex();
      if (commentIndex == null) return;
      console.log(
        "🚀 ~ handleStarCommentFromHTC ~ commentIndex:",
        comments[commentIndex]
      );
      handlePinComment(comments[commentIndex]?.id, type);
    },
    [currentId, comments]
  );

  const createTaskFromCommentHTC = useCallback(() => {
    const { getCurrentCommentIndex } = getContext();
    const commentIndex = getCurrentCommentIndex(true);
    if (commentIndex == null) return;

    const linkhtml = taskDetailConfig.urls.templates.commentLink(
      currentTask?.projectId!,
      String(currentTask?.uniqueIndex!),
      currentTask?.ticketNumber!,
      commentIndex
    );
    const mentionhtml = taskDetailConfig.urls.templates.mention(
      comments[commentIndex].creator?.displayName!,
      comments[commentIndex].creator?.id!
    );
    const heading = `${mentionhtml} said in ${linkhtml}`;

    toggleCreateTaskGlobally({
      sectionId: currentTask?.sectionId!,
      sectionTitle: currentTask?.section!,
      position: taskDetailConfig.positions.top,
      prefilledDescription: `<p>${heading}<blockquote>${comments[commentIndex].text}</blockquote></p>`,
      prefilledAttachments: processAttachmentsForNewTask(
        comments[commentIndex].attachments
      ),
      createTaskFromComment: {
        task: currentTask!,
        commentIndex,
      },
    });
  }, [currentId, comments]);

  const processAttachmentsForNewTask = (attachments?: IAttachment[]) => {
    if (!attachments || attachments.length === 0) return [];
    let temp: any[] = [];
    for (const attachment of attachments) {
      temp.push({
        file: {
          name: attachment.fileName,
          size: attachment.fileSize,
          source: attachment.fileSource,
          type: attachment.fileType,
        },
        id: attachment.id,
      });
    }
    console.log("🚀 ~ processAttachmentsForNewTask ~ temp:", temp);
    return temp;
  };

  const copyCommentURLFromHTC = () => {
    const currentURL = `${process.env.NEXT_PUBLIC_BASEURL}${taskDetailConfig.urls.taskDetailPattern}${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
    navigator.clipboard.writeText(currentURL + `${taskDetailConfig.urls.commentHashPrefix}${currentId.replace("comment-", "")}`);
    toast(taskDetailConfig.toastMessages.commentLinkCopied);
  };
  const copyCommentContentFromHTC = async () => {
    const { getCurrentCommentIndex } = getContext();
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;

    const comment = comments[commentIndex];
    if (!comment) return;

    const commentElement = hasFigmaEmbed(comment.text)
      ? document.getElementById(`comment-${commentIndex}-input`)
      : document.getElementById(`comment-${comment.id}-input`);
    if (!commentElement) return;

    const range = document.createRange();
    range.selectNodeContents(commentElement);

    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    selection.addRange(range);

    const serializer = new XMLSerializer();
    const selectedNode = range.cloneContents();
    const selectedHtml = serializer.serializeToString(selectedNode);
    const selectedText = selection.toString();

    selection.removeAllRanges();

    if (selectedText) {
      try {
        if (
          navigator.clipboard &&
          typeof navigator.clipboard.write === "function"
        ) {
          const clipboardItem = new ClipboardItem({
            "text/html": new Blob([selectedHtml], { type: "text/html" }),
            "text/plain": new Blob([selectedText], { type: "text/plain" }),
          });
          await navigator.clipboard.write([clipboardItem]);
          toast(taskDetailConfig.toastMessages.commentContentCopied);
        } else {
          await navigator.clipboard.writeText(selectedText);
          toast(taskDetailConfig.toastMessages.commentContentCopied);
        }
      } catch (error) {
        console.error("Failed to copy comment content:", error);
        toast.error(taskDetailConfig.toastMessages.errorCopyCommentContent);
      }
    }
  };

  const viewSubTasksfromHtc = () => {
    return linksModalToggle();
  };

  const openAifromHtc = useCallback(() => {
    refocusAndOpenTaskWriter(currentId);
  }, [currentId]);

  const deleteComment = async (id: number) => {
    let currentIndex = parseInt(currentId.split("-")[1]);
    queryClient.refetchQueries({
      queryKey: [globalConstants.CommentsTQPrefixKey, _parsedTask.id],
    });

    if (currentIndex >= 0) {
      if (comments.length === 1) {
        defaultCommentFocus();
      } else if (currentIndex === comments.length - 1) {
        scrollVirtualize("comment", currentIndex - 1);
      } else if (currentIndex < comments.length - 1)
        setTimeout(() => {
          scrollVirtualize("comment", currentIndex);
        }, 1);
    }
  };

  const updateActiveItemAndItemInView = (taskId: number | null) => {
    _setActiveItem(taskId);
    setInViewObject({
      taskId: taskId,
      taskProjectId: currentTask?.projectId ?? null,
      sectionId: currentTask?.sectionId ?? null,
      taskTicketNumber: currentTask?.ticketNumber ?? null,
      sectionTitle: currentTask?.section ?? null,
      taskTitle: currentTask?.title ?? null,
    });
  };


  const toggleModal = (_assignees?: IAssignees[], keepOpen?: boolean) => {
    if (!showAssignModal && !_assignees && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    if (Array.isArray(_assignees)) {
      if (!currentTask) return;
      setCurrentTask((prev) => {
        if (!prev) return prev;
        else return { ...prev, assignees: _assignees };
      });
      const taskToReturn = { assignees: _assignees };
      try {
        updateTaskInCache(
          taskToReturn,
          currentTask.id,
          currentTask.projectId,
          currentTask.sectionId,
          currentProject
        );
      } catch (error) {
        console.error("🚀 ~ toggleModal ~ updateTaskInCache:", error);
      }
    }
    if (!keepOpen) setShowAssignModal((prev) => !prev);
  }

  const toggleDeleteModal = () => {
    return setShowTaskDeleteModal((prev) => !prev);
  };

  const linksModalToggle = (_assignees?: IUser[]) => {
    setShowLinksModal((prev) => !prev);
  };
  const toggleMoveModal = () => {
    if (!showMoveModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    navigate("Refresh");
    setShowMoveModal((prev) => !prev);
  };
  return { handleEditCommentFromHTC, handleStarCommentFromHTC, createTaskFromCommentHTC, processAttachmentsForNewTask, copyCommentURLFromHTC, copyCommentContentFromHTC, viewSubTasksfromHtc, openAifromHtc, deleteComment, updateActiveItemAndItemInView, toggleModal, toggleDeleteModal, linksModalToggle, toggleMoveModal };
}
