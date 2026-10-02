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

  //callback for creating task from comment from htc
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

  //for processing comment attachments if any when creating new task from comment
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

  //callback for copying comment url from htc
  const copyCommentURLFromHTC = () => {
    const currentURL = `${process.env.NEXT_PUBLIC_BASEURL}${taskDetailConfig.urls.taskDetailPattern}${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
    navigator.clipboard.writeText(currentURL + `${taskDetailConfig.urls.commentHashPrefix}${currentId.replace("comment-", "")}`); // Copy it to the clipboard
    toast(taskDetailConfig.toastMessages.commentLinkCopied);
  };
  /**
   * Function for copying comment text. Similar to how text is copied when clicking Ctrl+C on a comment after selection.
   * Check useGetSelectionDetails.tsx on how this works.
   * Just copying comment.Text was not working as expected due to formatting issues and tiptap pasterules.
   * @return {*}
   */
  const copyCommentContentFromHTC = async () => {
    const { getCurrentCommentIndex } = getContext();
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;

    const comment = comments[commentIndex];
    if (!comment) return;

    // Ordinary comments use their database ID. Figma comments keep their
    // Tiptap editor mounted with an index-based ID across read and edit modes.
    // Select the expected ID directly so a database ID cannot collide with a
    // different comment's array index.
    const commentElement = hasFigmaEmbed(comment.text)
      ? document.getElementById(`comment-${commentIndex}-input`)
      : document.getElementById(`comment-${comment.id}-input`);
    if (!commentElement) return;

    // Create a range that covers all text content in the comment
    const range = document.createRange();
    range.selectNodeContents(commentElement);

    // Get the current selection and clear it
    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    selection.addRange(range);

    // Get both HTML and plain text formats (like native Ctrl+C)
    const serializer = new XMLSerializer();
    const selectedNode = range.cloneContents();
    const selectedHtml = serializer.serializeToString(selectedNode);
    const selectedText = selection.toString();

    // Clear the selection to avoid visual highlighting
    selection.removeAllRanges();

    // Copy to clipboard with both HTML and plain text formats to preserve formatting
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
          // Fallback for browsers without full Clipboard API support
          await navigator.clipboard.writeText(selectedText);
          toast(taskDetailConfig.toastMessages.commentContentCopied);
        }
      } catch (error) {
        console.error("Failed to copy comment content:", error);
        toast.error(taskDetailConfig.toastMessages.errorCopyCommentContent);
      }
    }
  };

  //callback for opening links modal from htc
  const viewSubTasksfromHtc = () => {
    return linksModalToggle();
  };

  //callback for opening ai writer from htc
  const openAifromHtc = useCallback(() => {
    refocusAndOpenTaskWriter(currentId);
  }, [currentId]);

  // =============================== DELETE COMMENT HANDLER
  const deleteComment = async (id: number) => {
    // reset the focus to one up or one lower.
    let currentIndex = parseInt(currentId.split("-")[1]);
    // remove the comment from view.
    // setComments((comments) =>
    // comments?.filter((comment) => String(comment.id) !== String(id))
    // );
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
      // markAsUnarchive(_selectedTask, index)
    }
  };

  // ======================== update active item and inViewObejct
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

  //  ===================================================================================================
  //  ============================================= MODAL CLOSE HANDLERS ================================
  //  ===================================================================================================

  // ----------------------- Assign User Close modal -----------------
  const toggleModal = (_assignees?: IAssignees[], keepOpen?: boolean) => {
    // Same stale-pointer guard as togglePriorityModal: the assign menu's
    // refetch keys come from inViewObject (HTPR-3731).
    if (!showAssignModal && !_assignees && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    // Only update when we actually got the fresh assignee rows. reactstrap's
    // <Modal toggle={onClose}> passes the close *event* as the first arg on a
    // backdrop/Escape dismiss; a bare `if (_assignees)` treated that event as
    // the array and overwrote assignees with a SyntheticEvent, blanking the
    // panel until reload (HTPR-3731). Mirrors the Array.isArray guard the
    // Ctrl+K handler already uses in commands.tsx.
    if (Array.isArray(_assignees)) {
      if (!currentTask) return;
      // Update the open task's own panel first: it must never depend on the
      // board-cache bookkeeping below succeeding (HTPR-3731).
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
    // keepOpen lets the assign menu refresh the task without closing, so
    // multiple people can be toggled in one session.
    if (!keepOpen) setShowAssignModal((prev) => !prev);
  }

  // ------------------------ # delete modal toggler
  const toggleDeleteModal = () => {
    return setShowTaskDeleteModal((prev) => !prev);
  };

  // ----------------------- Links Modal Close modal -----------------
  const linksModalToggle = (_assignees?: IUser[]) => {
    setShowLinksModal((prev) => !prev);
  };
  const toggleMoveModal = () => {
    // if(currentProject?.sorting_mode==="Priority"){
    //   return toast("Cannot move tasks while kanban is in Priority mode")
    // }
    // Same stale-pointer guard as togglePriorityModal (HTPR-3731): MoveToColumn
    // moves inViewObject.taskId, which goes stale after arrow/inbox navigation
    // and then moves the WRONG task (HTPR-4543). Re-point it at the open task.
    if (!showMoveModal && currentTask)
      updateActiveItemAndItemInView(currentTask.id);
    navigate("Refresh");
    setShowMoveModal((prev) => !prev);
  };
  return { handleEditCommentFromHTC, handleStarCommentFromHTC, createTaskFromCommentHTC, processAttachmentsForNewTask, copyCommentURLFromHTC, copyCommentContentFromHTC, viewSubTasksfromHtc, openAifromHtc, deleteComment, updateActiveItemAndItemInView, toggleModal, toggleDeleteModal, linksModalToggle, toggleMoveModal };
}
