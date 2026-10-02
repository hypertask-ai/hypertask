import { TaskRelations, ISection } from "@/models/model";
import axios from "axios";

import { useCallback } from "react";
import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { wrapBlockQuote } from "@/utils/helperFunctions/TaskDetail";
import { LIKESHORTCUTEVENT } from "@/lib/constants/constants";
import type { TaskDetailContext } from "./TaskDetailContext";
function createTaskDetailCommandActions(getContext: () => TaskDetailContext) {
  const { currentId, comments, markAsDone, setCurrentTask, summarizeTicket, callBackHandlerSubtaskLinking, currentUser, currentTask, handleStarTask, navigateToNextTask, setShowRemindMeModal, callBackHandlerRemoveParent, PostFollower, queryClient, setAiChatAutoOpenSuppressed, showAiChatInterface, setAiChatExplicitOpenAt, setShowAiChatInterface, copyCommentToAiChat, summarizeComment, setEditMode, focusOn, copyTicketNumber, copyTitleAndTicketNumber, copyTaskURL, copyTaskFormattedURL, copySharedTaskURL, sharedLink, copySharedTaskFormattedURL } = getContext();


  // =============================== CALLBACK HANDLER FROM COMMANDS
  const callback = (payload: any, mode: string) => {
    const { handleReplyCommentFromHTC, handleReactToCommentFromHTC, deleteComment, moveTaskToNextColumn, openAifromHtc, viewSubTasksfromHtc, copyCommentURLFromHTC, copyCommentContentFromHTC, createTaskFromCommentHTC, handleEditCommentFromHTC, handleStarCommentFromHTC, toggleRemoveSubtaskModal, UnFollowCallback, getTask } = getContext();
    if (mode === taskDetailConfig.commandModes.delete) deleteComment(payload);
    else if (mode === taskDetailConfig.commandModes.archive) return markAsDone();
    else if (mode === taskDetailConfig.commandModes.acceptTask)
      return moveTaskToNextColumn(payload);
    else if (mode === taskDetailConfig.commandModes.dueDate)
      // @ts-ignore
      setCurrentTask((old) => ({ ...old, dueDate: payload }));
    else if (mode === taskDetailConfig.commandModes.assignees)
      // @ts-ignore
      setCurrentTask((old) => ({ ...old, assignees: payload }));
    else if (mode === "WaitingOn")
      setCurrentTask((old) => (old ? { ...old, ...payload } : old));
    else if (mode === taskDetailConfig.commandModes.openAiWriter) openAifromHtc();
    else if (mode === taskDetailConfig.commandModes.viewSubTasks) viewSubTasksfromHtc();
    else if (mode === taskDetailConfig.commandModes.copyCommentLinkUrl) copyCommentURLFromHTC();
    else if (mode === taskDetailConfig.commandModes.copyCommentContent) copyCommentContentFromHTC();
    else if (mode === taskDetailConfig.commandModes.createTaskFromComment) createTaskFromCommentHTC();
    else if (mode === taskDetailConfig.commandModes.editComment) handleEditCommentFromHTC();
    else if (mode === taskDetailConfig.commandModes.branchInNewChat) branchInNewChat();
    else if (mode === taskDetailConfig.commandModes.copyCommentToAiChat) copyFocusedCommentToAiChat();
    else if (mode === taskDetailConfig.commandModes.summarizeComment) summarizeFocusedComment();
    else if (mode === taskDetailConfig.commandModes.summarizeTicket) void summarizeTicket();
    else if (mode === taskDetailConfig.commandModes.fastLikeComment) fastLikeFocusedComment();
    else if (mode === taskDetailConfig.commandModes.replyToComment) handleReplyCommentFromHTC();
    else if (mode === taskDetailConfig.commandModes.reactToComment) handleReactToCommentFromHTC();
    else if (mode === taskDetailConfig.commandModes.addSubtask) callBackHandlerSubtaskLinking(payload);
    else if (mode === taskDetailConfig.commandModes.moveTaskToInbox)
      moveTaskToInbox(
        currentUser.id,
        currentTask?.projectId!,
        currentTask?.id!
      );
    else if (mode === taskDetailConfig.commandModes.starTask) handleStarTask();
    else if (mode === taskDetailConfig.commandModes.starComment) handleStarCommentFromHTC(payload);
    else if (mode === taskDetailConfig.commandModes.copyFunctions) handleCopyFunctionsFromHTC(payload);
    else if (mode === taskDetailConfig.commandModes.archiveTaskNotification) navigateToNextTask(true, true);
    else if (mode === taskDetailConfig.commandModes.setReminder) setShowRemindMeModal((prev) => !prev);
    else if (mode === taskDetailConfig.commandModes.removeParent) callBackHandlerRemoveParent();
    else if (mode === taskDetailConfig.commandModes.removeSubtask) toggleRemoveSubtaskModal();
    else if (mode === taskDetailConfig.commandModes.addRelation)
      setCurrentTask((previous) =>
        previous
          ? {
              ...previous,
              relatedFromTasks: [
                ...(previous.relatedFromTasks ?? []),
                ...(payload as TaskRelations[]),
              ],
            }
          : previous
      );
    else if (mode === taskDetailConfig.commandModes.followTask)
      PostFollower(Number(currentUser?.id), Number(currentTask?.id));
    //Wont touch how this is called. Just shifting the place where its called.
    else if (mode === taskDetailConfig.commandModes.unfollowTask) UnFollowCallback();
    else if (mode === taskDetailConfig.commandModes.speechToText) audioInputHandler();
    else if (mode === taskDetailConfig.commandModes.toggleTimeTracking)
      toggleTimeTracking();
    else if (mode === "DescriptionRestored") void getTask();
  };

  const toggleTimeTracking = async () => {
    if (!currentTask?.id) return;
    try {
      const summary = await axios.get(`/api/time/task?taskId=${currentTask.id}`);
      await axios.post(
        summary.data.runningEntry ? "/api/time/stop" : "/api/time/start",
        { taskId: currentTask.id }
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time", "task", currentTask.id] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? "Unable to update timer");
    }
  };

  const branchInNewChat = async () => {
    setAiChatAutoOpenSuppressed(false);
    if(!showAiChatInterface) {
      setAiChatExplicitOpenAt(Date.now());
      setShowAiChatInterface(true);
    }
    const deadline = Date.now() + 5000;
    while (
      (!getContext().startNewSession || !getContext().aiChatEditor) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const chat = getContext();
    if (!chat.startNewSession) return;
    await chat.startNewSession();
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;

    const comment = comments[commentIndex];
    if (!comment) return;
    const wrapblockquote = wrapBlockQuote(comment.text, comment.creator!, true);
    getContext().aiChatEditor?.commands.setContent(wrapblockquote);
    getContext().aiChatEditor?.commands.focus();
  }

  const copyFocusedCommentToAiChat = () => {
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;
    copyCommentToAiChat(comments[commentIndex]);
  };

  const summarizeFocusedComment = () => {
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;
    void summarizeComment(comments[commentIndex]);
  };

  const fastLikeFocusedComment = () => {
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return; // == null, not !commentIndex: index 0 is a valid comment
    const comment = comments[commentIndex];
    if (!comment || comment.activity) return;
    window.dispatchEvent(
      new CustomEvent(LIKESHORTCUTEVENT, {
        detail: { currentId: `comment-${commentIndex}` },
      })
    );
  };

  const audioInputHandler = (improve: boolean = false) => {
    //get current focused ID. Alright. If we have current focused then
    //opoen audio on that alright.
    const shouldImprove = improve ? taskDetailConfig.audioButtons.improveSuffix : "";
    if (currentId === taskDetailConfig.elementIds.comment) {
      setEditMode(taskDetailConfig.editModes.comment);
      focusOn(taskDetailConfig.elementIds.commentInput, false);
      document.getElementById(taskDetailConfig.elementIds.bottom)?.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: "start",
      });
      document
        .getElementById(taskDetailConfig.audioButtons.createComment + "-" + taskDetailConfig.audioButtons.suffix + shouldImprove)
        ?.click();
    } else if (currentId === descriptionContainerId) {
      focusOn(taskDetailConfig.editModes.description);
      document
        .getElementById(taskDetailConfig.audioButtons.popoverWrapperPrefix + taskDetailConfig.editModes.description)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setEditMode(taskDetailConfig.editModes.description);
      focusOn(descriptionContainerId);
      setTimeout(
        () =>
          document
            .getElementById(
              taskDetailConfig.audioButtons.readEditDescription + "-" + taskDetailConfig.audioButtons.suffix + shouldImprove
            )
            ?.click(),
        taskDetailConfig.delays.audioButtonClick
      );
    }

    return;
  };

  const moveTaskModalCallback = (section: ISection) => {
    setCurrentTask((prev) =>
      prev
        ? {
            ...prev,
            sectionId: section.id,
            section: section.section_title,
          }
        : prev
    );
  };

  const moveTaskToInbox = async (
    userId: number,
    projectId: number,
    taskId: number
  ) => {
    const response = await axios.post(taskDetailConfig.apiEndpoints.moveTaskToInbox, {
      userId,
      projectId,
      taskId,
    });
    if (response.status === taskDetailConfig.httpStatus.ok) {
      await toast.success(taskDetailConfig.toastMessages.taskMovedToInbox);
      navigateToNextTask(true, true, true, taskDetailConfig.positions.forceNavigate);
    }
  };

  //Handles copy functions from HTC
  const handleCopyFunctionsFromHTC = (
    payload:
      | "Private"
      | "PrivateFormatted"
      | "Public"
      | "PublicFormatted"
      | "TitleAndID"
      | "ID"
  ) => {
    switch (payload) {
      case taskDetailConfig.copyTypes.id:
        copyTicketNumber(currentTask?.ticketNumber ?? "");
        return;
      case taskDetailConfig.copyTypes.titleAndId:
        copyTitleAndTicketNumber(
          currentTask?.title!,
          currentTask?.ticketNumber!
        );
        return;
      case taskDetailConfig.copyTypes.private:
        copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
        return;
      case taskDetailConfig.copyTypes.privateFormatted:
        copyTaskFormattedURL(
          currentTask?.title!,
          currentTask?.ticketNumber!,
          currentTask?.uniqueIndex,
          currentTask?.projectId
        );
        return;
      case taskDetailConfig.copyTypes.public:
        copySharedTaskURL(sharedLink.id);
        return;
      case taskDetailConfig.copyTypes.publicFormatted:
        copySharedTaskFormattedURL(
          sharedLink.id,
          currentTask?.title!,
          currentTask?.ticketNumber!
        );
        return;
      default:
        break;
    }
  };

  const getCurrentCommentIndex = (createTask = false) => {
    if (!currentId.startsWith("comment-")) return;
    if (currentId === taskDetailConfig.elementIds.commentInput) return;
    const commentIndex = parseInt(currentId.split("-")[1]);
    if (comments[commentIndex]?.activity) return;
    if (createTask && !comments[commentIndex].creatorId) return;
    return commentIndex;
  };
  return { callback, toggleTimeTracking, branchInNewChat, copyFocusedCommentToAiChat, summarizeFocusedComment, fastLikeFocusedComment, audioInputHandler, moveTaskModalCallback, moveTaskToInbox, handleCopyFunctionsFromHTC, getCurrentCommentIndex };
}

export function useTaskDetailCommandActions(getContext: () => TaskDetailContext) {
  const actions = createTaskDetailCommandActions(getContext);
  const { getCurrentCommentIndex } = actions;
  const { currentId, comments, toggleEmojiPicker, replyToCommentHandler } = getContext();


  const handleReactToCommentFromHTC = useCallback(() => {
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;
    toggleEmojiPicker(commentIndex);
  }, [currentId, comments]);

  const handleReplyCommentFromHTC = useCallback(() => {
    const commentIndex = getCurrentCommentIndex();
    if (commentIndex == null) return;
    replyToCommentHandler(commentIndex);
  }, [currentId, comments]);
  return { ...actions, handleReactToCommentFromHTC, handleReplyCommentFromHTC };
}
