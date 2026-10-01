import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import { shouldAdvanceAfterNotificationArchive } from "@/lib/taskDetailArchiveNavigation";
import { clearArchiveShortcutNudge } from "@/lib/notifications/archiveShortcutNudge";
import { CommandMode } from "@/models/enums";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import type { TaskDetailKeyboardContext, TaskDetailCommand } from "./TaskDetailKeyboardContext";
export function taskDetailNavigationKeymap(context: TaskDetailKeyboardContext & { currentTask: NonNullable<TaskDetailKeyboardContext["currentTask"]> }, e: KeyboardEvent, cmdControl: boolean): TaskDetailCommand[] {
  const { lastGPress, navigate, updateActiveItemAndItemInView, currentTask, toggleEstimateModal, undoData, undoHandler, setArchiveNudge, currentUser, markAsDone, goToProjectShortcut, _parsedTask, toggleLabelModal, aHandler, setShowCommands, toggleDeleteModal, searchParams, navigateToNextTask, returnCurrentFocusedType, focusOn, setEditMode, copyTaskURL, copyTaskFormattedURL, copySharedTaskURL, sharedLink, copySharedTaskFormattedURL, copyTitleAndTicketNumber, copyTicketNumber, navigateToPreviousTask, handleStarTask, PostFollower, UnFollowCallback, taskTimer } = context;
  return [


    // [s] for size/estimate && ([g] then [s] Starred tasks & comments)
    
    {
      action: "estimate",
      matches: () => e.keyCode === KeyCodes.S && !e.shiftKey && !e.altKey && !cmdControl,
      run: () => {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.starred);
      else {
        e.preventDefault();
        updateActiveItemAndItemInView(currentTask.id);
        return { stop: true, value: toggleEstimateModal() };
      }
    },
    },


    // [Z] FOR UNDO
    
    {
      action: "undo",
      matches: () => e.keyCode === KeyCodes.Z && undoData.length > 0,
      run: () => {
      // undoHandler(actualUndo[0])
      const firstUndoData = undoData[undoData.length - 1];
      return { stop: true, value: undoHandler(firstUndoData, firstUndoData.toastId) };
    },
    },


    // [ctrl]/[cmd] + [e]
    
    {
      action: "archive",
      matches: () => e.keyCode === KeyCodes.E && cmdControl,
      run: () => {
      e.preventDefault();
      if (lastGPress.current === null) {
        if (!shouldRunArchiveShortcut(e)) return { stop: true };
        setArchiveNudge((current) =>
          clearArchiveShortcutNudge(current, currentUser.id),
        );
        return { stop: true, value: markAsDone() };
      }
    },
    },


    // ========== [g] then  [t]

    
    {
      action: "projectOrLabel",
      matches: () => e.keyCode === KeyCodes.T,
      run: () => {
      if (lastGPress.current !== null)
        goToProjectShortcut(_parsedTask.projectId, true);
      else {
        if (!e.altKey && !e.shiftKey && !cmdControl) {
          e.preventDefault();
          updateActiveItemAndItemInView(currentTask.id);
          toggleLabelModal();
          return { stop: true, value: true };
        }
      }
    },
    },

    // [a] for assign && ([g] then [a] All Tasks)
    
    {
      action: "assign",
      matches: () => e.keyCode === KeyCodes.A && !e.shiftKey,
      run: () => {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.allTasks);
      else {
        e.preventDefault();
        return { stop: true, value: aHandler() };
      }
    },
    },


    // [shift][b] for blocked by person (plain B is Log time)
    
    {
      action: "blockedBy",
      matches: () => e.keyCode === KeyCodes.B &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey,
      run: () => {
      e.preventDefault();
      updateActiveItemAndItemInView(currentTask.id);
      return { stop: true, value: setShowCommands({
        show: true,
        mode: CommandMode.OpenBlockedByModal,
      }) };
    },
    },


    // [shift][#/3] delete task modal
    
    {
      action: "deleteTask",
      matches: () => e.keyCode === KeyCodes.THREE && e.shiftKey && !e.ctrlKey && !e.metaKey,
      run: () => {
      toggleDeleteModal();
    },
    },


    // press [e]
    
    {
      action: "nextAfterArchive",
      matches: () => e.keyCode === KeyCodes.E && !cmdControl,
      run: () => {
      if (lastGPress.current !== null) return { stop: true };
      setArchiveNudge((current) =>
        clearArchiveShortcutNudge(current, currentUser.id),
      );
      const inboxFlow = searchParams?.get("inboxFlow");
      navigateToNextTask(
        true,
        shouldAdvanceAfterNotificationArchive(inboxFlow),
        undefined,
        undefined,
        inboxFlow,
      );
      return { stop: true, value: true };
    },
    },


    // press [j]
    
    {
      action: "nextTask",
      matches: () => e.keyCode === KeyCodes.J && !cmdControl,
      run: () => {
      const inboxFlow = searchParams?.get("inboxFlow");
      return { stop: true, value: navigateToNextTask(false, true, undefined, undefined, inboxFlow) };
    },
    },


    // press [cmd/ctrl][j]
    
    {
      action: "aiWriter",
      matches: () => e.keyCode === KeyCodes.J && cmdControl,
      run: () => {
      e.preventDefault();
      if (returnCurrentFocusedType() === "Others") {
        focusOn("description");
        document
          .getElementById("popover-wrapper-" + "description")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        setEditMode("description-ai");
        return { stop: true, value: true };
      }
    },
    },

    //[cmdControl][shift][,]
    
    {
      action: "copyUrl",
      matches: () => e.keyCode === KeyCodes.SEMICOLON &&
      cmdControl &&
      e.shiftKey &&
      !e.altKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId) };
    },
    },

    //[cmdControl][,]
    
    {
      action: "copyFormattedUrl",
      matches: () => (e.keyCode === KeyCodes.SEMICOLON || e.keyCode === KeyCodes.COMMA) &&
      cmdControl &&
      !e.shiftKey &&
      !e.altKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copyTaskFormattedURL(
        currentTask?.title!,
        currentTask?.ticketNumber!,
        currentTask?.uniqueIndex,
        currentTask?.projectId
      ) };
    },
    },


    //[cmdControl][shift][.]
    
    {
      action: "copySharedUrl",
      matches: () => e.keyCode === KeyCodes.PERIOD && cmdControl && e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copySharedTaskURL(sharedLink.id) };
    },
    },


    //[cmdControl][.]
    
    {
      action: "copySharedFormattedUrl",
      matches: () => e.keyCode === KeyCodes.PERIOD && cmdControl && !e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copySharedTaskFormattedURL(
        sharedLink.id,
        currentTask?.title!,
        currentTask?.ticketNumber!
      ) };
    },
    },


    //[cmdControl][I]
    
    {
      action: "copyTitle",
      matches: () => e.keyCode === KeyCodes.I && cmdControl && !e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copyTitleAndTicketNumber(
        currentTask?.title!,
        currentTask?.ticketNumber!
      ) };
    },
    },


    //[cmdControl][shift][i]
    
    {
      action: "copyTicket",
      matches: () => e.keyCode === KeyCodes.I && cmdControl && e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: copyTicketNumber(currentTask?.ticketNumber!) };
    },
    },


    // press [k]
    
    {
      action: "previousTask",
      matches: () => e.keyCode === KeyCodes.K && !cmdControl,
      run: () => {
      const inboxFlow = searchParams?.get("inboxFlow");
      return { stop: true, value: navigateToPreviousTask(false, false, inboxFlow) };
    },
    },


    
    {
      action: "share",
      matches: () => e.keyCode === KeyCodes.S && cmdControl && !e.altKey && !e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: setShowCommands({
        show: true,
        mode: CommandMode.ShareTaskPublic,
      }) };
    },
    },


    // [alt][s]
    
    {
      action: "star",
      matches: () => e.keyCode === KeyCodes.S && e.altKey && !e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: handleStarTask() };
    },
    },


    // [f]
    
    {
      action: "follow",
      matches: () => e.keyCode === KeyCodes.F && !e.altKey && !e.shiftKey && !cmdControl,
      run: () => {
      e.preventDefault();
      return { stop: true, value: PostFollower(Number(currentUser?.id), Number(currentTask?.id)) };
    },
    },


    // [alt][f]
    
    {
      action: "unfollow",
      matches: () => e.keyCode === KeyCodes.F && e.altKey && !e.shiftKey,
      run: () => {
      e.preventDefault();
      return { stop: true, value: UnFollowCallback() };
    },
    },


    // [alt][t] — start/stop the timer for this task
    
    {
      action: "timer",
      matches: () => e.keyCode === KeyCodes.T && e.altKey && !e.shiftKey,
      run: () => {
      e.preventDefault();
      // Only when time tracking is on for this board (or a timer is already running).
      if (taskTimer.data?.enabled === false && !taskTimer.data?.runningEntry) return { stop: true };
      taskTimer
        .toggle()
        .catch((error: any) =>
          toast.error(error?.message ?? "Unable to update timer")
        );
      return { stop: true };
    },
    },
  ];
}
