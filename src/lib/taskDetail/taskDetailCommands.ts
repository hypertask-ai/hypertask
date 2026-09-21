import "@/styles/taskDetail.scss";
import toast from "react-hot-toast";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { requestCommentSnippetPicker } from "@/lib/snippets";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import { shouldAdvanceAfterNotificationArchive } from "@/lib/taskDetailArchiveNavigation";
import { clearArchiveShortcutNudge } from "@/lib/notifications/archiveShortcutNudge";
import { CommandMode } from "@/models/enums";
import globalConstants from "@/lib/constants";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { keyboard_shortcuts, matchesShortcut } from "@/lib/utils/keyboardShortcuts";

type CommandContext = Record<string, any>;

export function dispatchTaskDetailCommand(e: KeyboardEvent, getContext: () => CommandContext) {
  const { CTRL_ENTERHandler, EnterHandler, PostFollower, UnFollowCallback, _parsedTask, aHandler, activeModals, audioInputHandler, carousalItems, copySharedTaskFormattedURL, copySharedTaskURL, copyTaskFormattedURL, copyTaskURL, copyTicketNumber, copyTitleAndTicketNumber, currentTask, currentUser, defaultCommentFocus, editMode, editModeCheck, focusOn, gPressHandler, goToProjectShortcut, handleStarTask, idToDelete, isApple, isRecording, isSummaryExpanded, lastGPress, lastM_APress, linksModalToggle, markAsDone, moveTaskToNextColumn, navigate, navigateToNextTask, navigateToPreviousTask, requestDescriptionFocus, resetShowCommands, returnCurrentFocusedType, scrollVirtualize, searchParams, sectionsForProjectTQ, setArchiveNudge, setCarousalItems, setEditMode, setIsSummaryExpand, setShowCommands, setShowCommentDeleteModal, setShowCreateLabelModal, setShowDropdown, setShowShortcuts, sharedLink, showAssignModal, showCommands, showCommentDeleteModal, showCreateLabelModal, showEmojiPickerAtComment, showMoveModal, showPriorityModal, showShortucts, taskTimer, tipTapClassName, titleEscapeHandler, toggleCreateTaskGlobally, toggleDeleteModal, toggleDueDate, toggleEstimateModal, toggleHistory, toggleLabelModal, toggleMoveModal, toggleMoveToBoardModal, togglePriorityModal, toggleSubtaskLinkingModal, undoData, undoHandler, updateActiveItemAndItemInView } = getContext();
    // For a reason unbeknownst to me, commenting this out fixes the issue related to HTPR-3368
    // updateActiveItemAndItemInView(currentTask && currentTask?.id);

    // if (loading) return
    const classNamesToReturnFrom = [...taskDetailConfig.classNames.returnFrom];
      if (
      document.querySelector(".modal") ||
      showAssignModal ||
      showCreateLabelModal ||
      document.getElementById(taskDetailConfig.elementIds.carouselContainer) ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === taskDetailConfig.elementIds.modalButtons ||
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === taskDetailConfig.modals.htc ||
      // loading||
      !currentTask ||
      Boolean(document.activeElement?.closest(".chatwindow")) ||
      classNamesToReturnFrom.includes(document?.activeElement?.className as any) ||
      document.querySelector("em-emoji-picker") ||
      isRecording ||
      document.activeElement?.id === taskDetailConfig.elementIds.boardManager
    )
      return;
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    const isInsideTipTap = Boolean(
      document.activeElement?.closest(".ProseMirror")
    );
    const isInputFocused = taskDetailConfig.classNames.inputFocused.includes(
      (document.activeElement as HTMLElement)?.tagName?.toLowerCase() as any
    );
    if (
      e.key === ";" &&
      !cmdControl &&
      !e.altKey &&
      !isInsideTipTap &&
      !isInputFocused
    ) {
      // Nav-mode ; only: when already typing in an editor/input, let that
      // editor's own Snippets suggestion handle ; instead of stealing focus
      // to the comment composer.
      e.preventDefault();
      requestCommentSnippetPicker();
      return;
    }
    // [ctrl]/[cmd] + [o] for the links modal. Checked before the input/editor guards
    // below, otherwise it never fires: the comment composer holds focus by default
    // on this page, so isInsideTipTap returns out before we ever reach it.
    if (e.keyCode === KeyCodes.O && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return linksModalToggle();
    }

    if (e.keyCode === KeyCodes.ESCAPE && carousalItems)
      return setCarousalItems(undefined);
    // ------------------ if user in htc, return focus
    if (e.key === taskDetailConfig.keyboard.escape && document.activeElement?.id === taskDetailConfig.modals.htc) {
      return defaultCommentFocus();
    } else if (
      e.key === taskDetailConfig.keyboard.escape &&
      (showShortucts ||
        showCreateLabelModal ||
        showCommentDeleteModal ||
        isSummaryExpanded ||
        editMode === taskDetailConfig.editModes.title)
    ) {
      setShowShortcuts(false);
      resetShowCommands();
      setShowCommentDeleteModal(false);
      setShowCreateLabelModal(false);
      setIsSummaryExpand(false);
      if (editMode === taskDetailConfig.editModes.title) return titleEscapeHandler();
      else {
        defaultCommentFocus();
      }
      return;
    }

    // [ctrl] [#]
    if (e.ctrlKey && e.shiftKey && e.key === "#") {
      idToDelete && setShowCommentDeleteModal(true);
      // deleteCommentById(idToDelete)
      return;
    }

    // //--------------------- check if user inside the text editor
    // else if (
    //   e.key === "Escape" &&
    //   (editMode === "description" ||
    //     document.activeElement?.className === tipTapClassName)
    // ) {
    //   if (isRecording) return;
    //   if (showMentionList) return;
    //   setEditState(null);

    //   setEditMode(null);
    //   if (currentId === "comment-input") {
    //     defaultCommentFocus();
    //     setShowMentionList(false);
    //     // setEditMode(null)
    //   } else {
    //     returnFocusToComment();
    //   }
    //   return;
    // }

    //--------------------- if its any other key than escape, return
    else if (
      (isInputFocused && e.key !== taskDetailConfig.keyboard.escape) ||
      document.activeElement?.className === tipTapClassName ||
      activeModals.includes(document.activeElement?.id!) ||
      showMoveModal ||
      showPriorityModal ||
      showEmojiPickerAtComment?.show ||
      isInsideTipTap
    )
      return;
    //--------------------- If user is is not inside assignees just go back
    else if (
      e.key === taskDetailConfig.keyboard.escape &&
      !activeModals.includes(document.activeElement?.id!)
    ) {
      console.log("going back");
      // return onGoback();
      document.getElementById(taskDetailConfig.elementIds.taskDetailPageBackButton)?.click();
    } else {
      // setEditMode(null)
      resetShowCommands();
      setShowDropdown(false);
    }

    // ------------------ USER PRESSING ENTER WITH FOCUS ON THE CONTAINER ITEM ------------------
    if (showCommands.show || showEmojiPickerAtComment?.show) return;
    // ========================= ENTER
    if (e.key === "Enter" && !cmdControl) return EnterHandler(e);
    // ========================= CTRL + ENTER
    if (e.key === "Enter" && cmdControl) return CTRL_ENTERHandler(e);

    // [ctrl] + [d] []
    if (
      (e.keyCode === KeyCodes.D && e.ctrlKey && !e.shiftKey) ||
      (editMode === taskDetailConfig.editModes.description && editModeCheck)
    ) {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.description);
      if (currentTask?.id) requestDescriptionFocus(currentTask.id);
      focusOn("description", false);
      scrollVirtualize("edit-description");
      return;
      // document?.getElementById(currentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // setTimeout(() => {
      // commentRef.current?.focus()
      // document.getElementById("bottom")?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" })
      // }, 600);
    }
    // [shift][m]
    if (e.keyCode === KeyCodes.M && e.shiftKey && !cmdControl) {
      e.preventDefault();
      return toggleMoveToBoardModal();
    }


    // [shift][r] → reply with an AI-suggested draft; opens the composer and
    // inserts the suggestion there (never posts anything automatically).
    // Bare R stays reserved for emoji reactions; g-sequence keeps priority.
    if (
      e.keyCode === KeyCodes.R &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.repeat &&
      (lastGPress.current === null ||
        new Date().getTime() - lastGPress.current >=
          globalConstants.gThenKeyDelay)
    ) {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.comment);
      focusOn(taskDetailConfig.elementIds.commentInput);
      window.dispatchEvent(new CustomEvent(AI_SUGGEST_REPLY_EVENT));
      return;
    }

    // [ctrl] + [m] [comment edit mode]
    if (
      (e.keyCode === KeyCodes.M && !e.shiftKey && cmdControl) ||
      (editMode === taskDetailConfig.editModes.comment && editModeCheck)
    ) {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.comment);
      focusOn(taskDetailConfig.elementIds.commentInput);
      return;
    }

    // moving task to next/previous column logic

    // [ctrl/cmd] + [shift] + [h] → toggle history (activity) events in the feed
    if (cmdControl && e.shiftKey && e.keyCode === KeyCodes.H) {
      e.preventDefault();
      toggleHistory();
      return;
    }

    // shift + [h]
    if (
      (e.keyCode === KeyCodes.H || e.key === "ArrowLeft") &&
      e.shiftKey &&
      !cmdControl
    ) {
      e.preventDefault();
      const i = sectionsForProjectTQ.findIndex(
        (s: { id: number | undefined }) => s.id === currentTask.sectionId
      );
      if (i === -1) return;
      const prev = i > 0 ? sectionsForProjectTQ[i - 1] : null;
      if (prev) moveTaskToNextColumn(prev);
    }

    // shift + [l]
    if ((e.keyCode === KeyCodes.L || e.key === "ArrowRight") && e.shiftKey) {
      e.preventDefault();
      const i = sectionsForProjectTQ.findIndex(
        (s: { id: number | undefined }) => s.id === currentTask.sectionId
      );
      const next =
        i < sectionsForProjectTQ.length - 1
          ? sectionsForProjectTQ[i + 1]
          : null;
      if (next) moveTaskToNextColumn(next);
    }

    if (e.ctrlKey) {
      if (e.keyCode === KeyCodes.TAB) {
        e.preventDefault();
        console.log("ctrl+tab"); // chromium fullscreen (think PWA)
      }
    }

    // [cmd/ctrl][shift][d] [comment edit mode with audio]
    if (
      e.shiftKey &&
      cmdControl &&
      e.keyCode === KeyCodes.D &&
      editMode !== taskDetailConfig.editModes.descriptionAi &&
      editMode !== taskDetailConfig.editModes.newCommentAi &&
      editMode !== taskDetailConfig.editModes.editCommentAi
    ) {
      e.preventDefault();
      audioInputHandler();
    }

    // [cmd/ctrl][shift][f] [comment edit mode with audio + improve]
    if (
      e.shiftKey &&
      cmdControl &&
      e.keyCode === KeyCodes.F &&
      editMode !== "description-ai" &&
      editMode !== "new-comment-ai"
    ) {
      e.preventDefault();
      audioInputHandler(true);
    }

    if (
      e.keyCode === KeyCodes.V &&
      e.altKey &&
      editMode !== "description-ai" &&
      editMode !== "new-comment-ai"
    ) {
      e.preventDefault();
      audioInputHandler();
    }

    // [g]
    if (e.keyCode === KeyCodes.G) return gPressHandler(e, e.shiftKey);
    if(e.keyCode === KeyCodes.C) {
      const now = new Date().getTime();
      if (lastGPress.current && now - lastGPress.current < 500) {
        navigate("Calendar");
        return;
      }
    }

    // [c] for creating a task
    if (
      e.keyCode === KeyCodes.C &&
      !(e.shiftKey || e.ctrlKey || e.metaKey)
    ) {
      e.preventDefault();
      if (currentTask && currentTask.sectionId) {
        toggleCreateTaskGlobally({
          sectionId: currentTask.sectionId,
          sectionTitle: currentTask.section,
          position: taskDetailConfig.positions.top,
        });
      }
    }

    // [cmd/ctrl][shift][o]
    if (e.keyCode === KeyCodes.EQUALS && e.shiftKey && cmdControl) {
      e.preventDefault();
      if (currentTask && currentTask.sectionId) toggleSubtaskLinkingModal();
    }

    // [d] for due date
    if (matchesShortcut(e, keyboard_shortcuts.dueDateModal.default)) {
      e.preventDefault();
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.drafts);
      else {
        updateActiveItemAndItemInView(currentTask.id);
        return toggleDueDate();
      }
    }

    if (e.keyCode === KeyCodes.U && lastGPress.current !== null) {
      e.preventDefault();
      navigate(taskDetailConfig.navigation.scheduled);
      return;
    }
    // [m] for move task
    if (
      e.keyCode === KeyCodes.M &&
      !e.ctrlKey &&
      !e.metaKey &&
      (lastGPress.current === null ||
        new Date().getTime() - lastGPress.current >=
          globalConstants.gThenKeyDelay)
    ) {
      e.preventDefault();
      const now = new Date().getTime();
      if (lastM_APress.current && now - lastM_APress.current < taskDetailConfig.delays.doubleKeyPress) {
        lastM_APress.current = null;
        return;
      }
      lastM_APress.current = now;
      e.preventDefault();
      return toggleMoveModal();
    }

    // [i] for summary
    if (e.keyCode === KeyCodes.I && !e.shiftKey && !e.ctrlKey && !cmdControl) {
      e.preventDefault();
      if (lastGPress.current === null) {
        if (!isSummaryExpanded) scrollVirtualize("description");
        return setIsSummaryExpand((prev: boolean) => !prev);
      }
    }
    // [p] for set priority
    if (e.keyCode === KeyCodes.P && !cmdControl) {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.pinned);
      else {
        e.preventDefault();
        updateActiveItemAndItemInView(currentTask.id);
        return togglePriorityModal();
      }
    }

    // [s] for size/estimate && ([g] then [s] Starred tasks & comments)
    if (e.keyCode === KeyCodes.S && !e.shiftKey && !e.altKey && !cmdControl) {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.starred);
      else {
        e.preventDefault();
        updateActiveItemAndItemInView(currentTask.id);
        return toggleEstimateModal();
      }
    }

    // [Z] FOR UNDO
    if (e.keyCode === KeyCodes.Z && undoData.length > 0) {
      // undoHandler(actualUndo[0])
      const firstUndoData = undoData[undoData.length - 1];
      return undoHandler(firstUndoData, firstUndoData.toastId);
    }

    // [ctrl]/[cmd] + [e]
    if (e.keyCode === KeyCodes.E && cmdControl) {
      e.preventDefault();
      if (lastGPress.current === null) {
        if (!shouldRunArchiveShortcut(e)) return;
        setArchiveNudge((current: any) =>
          clearArchiveShortcutNudge(current, currentUser.id),
        );
        return markAsDone();
      }
    }

    // ========== [g] then  [t]

    if (e.keyCode === KeyCodes.T) {
      if (lastGPress.current !== null)
        goToProjectShortcut(_parsedTask.projectId, true);
      else {
        if (!e.altKey && !e.shiftKey && !cmdControl) {
          e.preventDefault();
          updateActiveItemAndItemInView(currentTask.id);
          toggleLabelModal();
          return true;
        }
      }
    }
    // [a] for assign && ([g] then [a] All Tasks)
    if (e.keyCode === KeyCodes.A && !e.shiftKey) {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.allTasks);
      else {
        e.preventDefault();
        return aHandler();
      }
    }

    // [shift][b] for blocked by person (plain B is Log time)
    if (
      e.keyCode === KeyCodes.B &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      updateActiveItemAndItemInView(currentTask.id);
      return setShowCommands({
        show: true,
        mode: CommandMode.OpenBlockedByModal,
      });
    }

    // [shift][#/3] delete task modal
    if (e.keyCode === KeyCodes.THREE && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      toggleDeleteModal();
    }

    // press [e]
    if (e.keyCode === KeyCodes.E && !cmdControl) {
      if (lastGPress.current !== null) return;
      setArchiveNudge((current: any) =>
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
      return true;
    }

    // press [j]
    if (e.keyCode === KeyCodes.J && !cmdControl) {
      const inboxFlow = searchParams?.get("inboxFlow");
      return navigateToNextTask(false, true, undefined, undefined, inboxFlow);
    }

    // press [cmd/ctrl][j]
    if (e.keyCode === KeyCodes.J && cmdControl) {
      e.preventDefault();
      if (returnCurrentFocusedType() === "Others") {
        focusOn("description");
        document
          .getElementById("popover-wrapper-" + "description")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        setEditMode("description-ai");
        return true;
      }
    }
    //[cmdControl][shift][,]
    if (
      e.keyCode === KeyCodes.SEMICOLON &&
      cmdControl &&
      e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
    }
    //[cmdControl][,]
    if (
      (e.keyCode === KeyCodes.SEMICOLON || e.keyCode === KeyCodes.COMMA) &&
      cmdControl &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskFormattedURL(
        currentTask?.title!,
        currentTask?.ticketNumber!,
        currentTask?.uniqueIndex,
        currentTask?.projectId
      );
    }

    //[cmdControl][shift][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && e.shiftKey) {
      e.preventDefault();
      return copySharedTaskURL(sharedLink.id);
    }

    //[cmdControl][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return copySharedTaskFormattedURL(
        sharedLink.id,
        currentTask?.title!,
        currentTask?.ticketNumber!
      );
    }

    //[cmdControl][I]
    if (e.keyCode === KeyCodes.I && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return copyTitleAndTicketNumber(
        currentTask?.title!,
        currentTask?.ticketNumber!
      );
    }

    //[cmdControl][shift][i]
    if (e.keyCode === KeyCodes.I && cmdControl && e.shiftKey) {
      e.preventDefault();
      return copyTicketNumber(currentTask?.ticketNumber!);
    }

    // press [k]
    if (e.keyCode === KeyCodes.K && !cmdControl) {
      const inboxFlow = searchParams?.get("inboxFlow");
      return navigateToPreviousTask(false, false, inboxFlow);
    }

    if (e.keyCode === KeyCodes.S && cmdControl && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      return setShowCommands({
        show: true,
        mode: CommandMode.ShareTaskPublic,
      });
    }

    // [alt][s]
    if (e.keyCode === KeyCodes.S && e.altKey && !e.shiftKey) {
      e.preventDefault();
      return handleStarTask();
    }

    // [f]
    if (e.keyCode === KeyCodes.F && !e.altKey && !e.shiftKey && !cmdControl) {
      e.preventDefault();
      return PostFollower(Number(currentUser?.id), Number(currentTask?.id));
    }

    // [alt][f]
    if (e.keyCode === KeyCodes.F && e.altKey && !e.shiftKey) {
      e.preventDefault();
      return UnFollowCallback();
    }

    // [alt][t] — start/stop the timer for this task
    if (e.keyCode === KeyCodes.T && e.altKey && !e.shiftKey) {
      e.preventDefault();
      // Only when time tracking is on for this board (or a timer is already running).
      if (taskTimer.data?.enabled === false && !taskTimer.data?.runningEntry) return;
      taskTimer
        .toggle()
        .catch((error: any) =>
          toast.error(error?.message ?? "Unable to update timer")
        );
      return;
    }

}
