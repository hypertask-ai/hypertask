import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { requestCommentSnippetPicker } from "@/lib/snippets";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import type { TaskDetailContext } from "./TaskDetailContext";
import type { TaskDetailCommand } from "./TaskDetailKeyboardContext";
import { taskDetailEditingKeymap } from "./taskDetailEditingKeymap";
import { taskDetailNavigationKeymap } from "./taskDetailNavigationKeymap";
export function dispatchTaskDetailCommand(action: TaskDetailCommand) {
  return action.run();
}

export function createTaskDetailKeyboard(context: TaskDetailContext) {
  const { showAssignModal, showCreateLabelModal, currentTask, isRecording, isApple, linksModalToggle, carousalItems, setCarousalItems, defaultCommentFocus, showShortucts, showCommentDeleteModal, isSummaryExpanded, editMode, setShowShortcuts, resetShowCommands, setShowCommentDeleteModal, setShowCreateLabelModal, setIsSummaryExpand, titleEscapeHandler, idToDelete, tipTapClassName, activeModals, showMoveModal, showPriorityModal, showEmojiPickerAtComment, setShowDropdown, showCommands, controller } = context;


  // =================================== SHORCUT KEYS HANDLERS ====================================

  const handleKeyUp = (event: KeyboardEvent) => {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  };
  const handleKeyDown = (e: KeyboardEvent) => {
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
    const keyboardContext = { ...context, currentTask, handleKeyUp, handleKeyDown };
    const keymap = [
      ...taskDetailEditingKeymap(keyboardContext, e, cmdControl),
      ...taskDetailNavigationKeymap(keyboardContext, e, cmdControl),
    ];
    for (const action of keymap) {
      if (!action.matches()) continue;
      const result = dispatchTaskDetailCommand(action);
      if (result?.stop) return result.value;
    }
  };
  return { handleKeyUp, handleKeyDown };
}
