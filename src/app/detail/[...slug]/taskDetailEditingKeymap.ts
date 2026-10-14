import taskDetailConfig from "@/lib/configs/taskDetail.config";
import globalConstants from "@/lib/constants";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import { keyboard_shortcuts, matchesShortcut } from "@/lib/utils/keyboardShortcuts";
import type { TaskDetailKeyboardContext, TaskDetailCommand } from "./TaskDetailKeyboardContext";
export function taskDetailEditingKeymap(context: TaskDetailKeyboardContext & { currentTask: NonNullable<TaskDetailKeyboardContext["currentTask"]> }, e: KeyboardEvent, cmdControl: boolean): TaskDetailCommand[] {
  const { EnterHandler, CTRL_ENTERHandler, editMode, editModeCheck, setEditMode, currentTask, requestDescriptionFocus, focusOn, scrollVirtualize, toggleMoveToBoardModal, lastGPress, toggleHistory, sectionsForProjectTQ, moveTaskToNextColumn, audioInputHandler, gPressHandler, navigate, toggleCreateTaskGlobally, toggleSubtaskLinkingModal, updateActiveItemAndItemInView, toggleDueDate, lastM_APress, toggleMoveModal, isSummaryExpanded, setIsSummaryExpand, togglePriorityModal } = context;
  return [


    {
      action: "enter",
      matches: () => e.key === "Enter" && !cmdControl,
      run: () => { return { stop: true, value: EnterHandler(e) }; },
    },


    {
      action: "controlEnter",
      matches: () => e.key === "Enter" && cmdControl,
      run: () => { return { stop: true, value: CTRL_ENTERHandler(e) }; },
    },

    {
      action: "description",
      matches: () => (e.keyCode === KeyCodes.D && e.ctrlKey && !e.shiftKey) ||
      (editMode === taskDetailConfig.editModes.description && editModeCheck),
      run: () => {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.description);
      if (currentTask?.id) requestDescriptionFocus(currentTask.id);
      focusOn("description", false);
      scrollVirtualize("edit-description");
      return { stop: true };
    },
    },


    {
      action: "moveToBoard",
      matches: () => e.keyCode === KeyCodes.M && e.shiftKey && !cmdControl,
      run: () => {
      e.preventDefault();
      return { stop: true, value: toggleMoveToBoardModal() };
    },
    },

    {
      action: "suggestReply",
      matches: () => e.keyCode === KeyCodes.R &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.repeat &&
      (lastGPress.current === null ||
        new Date().getTime() - lastGPress.current >=
          globalConstants.gThenKeyDelay),
      run: () => {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.comment);
      focusOn(taskDetailConfig.elementIds.commentInput);
      window.dispatchEvent(new CustomEvent(AI_SUGGEST_REPLY_EVENT));
      return { stop: true };
    },
    },

    {
      action: "comment",
      matches: () => (e.keyCode === KeyCodes.M && !e.shiftKey && cmdControl) ||
      (editMode === taskDetailConfig.editModes.comment && editModeCheck),
      run: () => {
      e.preventDefault();
      setEditMode(taskDetailConfig.editModes.comment);
      focusOn(taskDetailConfig.elementIds.commentInput);
      return { stop: true };
    },
    },

    {
      action: "history",
      matches: () => cmdControl && e.shiftKey && e.keyCode === KeyCodes.H,
      run: () => {
      e.preventDefault();
      toggleHistory();
      return { stop: true };
    },
    },

    {
      action: "previousColumn",
      matches: () => (e.keyCode === KeyCodes.H || e.key === "ArrowLeft") &&
      e.shiftKey &&
      !cmdControl,
      run: () => {
      e.preventDefault();
      const i = sectionsForProjectTQ.findIndex(
        (s: { id: number | undefined }) => s.id === currentTask.sectionId
      );
      if (i === -1) return { stop: true };
      const prev = i > 0 ? sectionsForProjectTQ[i - 1] : null;
      if (prev) moveTaskToNextColumn(prev);
    },
    },

    {
      action: "nextColumn",
      matches: () => (e.keyCode === KeyCodes.L || e.key === "ArrowRight") && e.shiftKey,
      run: () => {
      e.preventDefault();
      const i = sectionsForProjectTQ.findIndex(
        (s: { id: number | undefined }) => s.id === currentTask.sectionId
      );
      const next =
        i < sectionsForProjectTQ.length - 1
          ? sectionsForProjectTQ[i + 1]
          : null;
      if (next) moveTaskToNextColumn(next);
    },
    },



    {
      action: "controlTab",
      matches: () => e.ctrlKey,
      run: () => {
      if (e.keyCode === KeyCodes.TAB) {
        e.preventDefault();
        console.log("ctrl+tab");
      }
    },
    },

    {
      action: "dictate",
      matches: () => e.shiftKey &&
      cmdControl &&
      e.keyCode === KeyCodes.D &&
      editMode !== taskDetailConfig.editModes.descriptionAi &&
      editMode !== taskDetailConfig.editModes.newCommentAi &&
      editMode !== taskDetailConfig.editModes.editCommentAi,
      run: () => {
      e.preventDefault();
      audioInputHandler();
    },
    },

    {
      action: "dictateAndImprove",
      matches: () => e.shiftKey &&
      cmdControl &&
      e.keyCode === KeyCodes.F &&
      editMode !== "description-ai" &&
      editMode !== "new-comment-ai",
      run: () => {
      e.preventDefault();
      audioInputHandler(true);
    },
    },



    {
      action: "altDictate",
      matches: () => e.keyCode === KeyCodes.V &&
      e.altKey &&
      editMode !== "description-ai" &&
      editMode !== "new-comment-ai",
      run: () => {
      e.preventDefault();
      audioInputHandler();
    },
    },

    {
      action: "gSequence",
      matches: () => e.keyCode === KeyCodes.G,
      run: () => { return { stop: true, value: gPressHandler(e, e.shiftKey) }; },
    },


    {
      action: "calendar",
      matches: () => e.keyCode === KeyCodes.C,
      run: () => {
      const now = new Date().getTime();
      if (lastGPress.current && now - lastGPress.current < 500) {
        navigate("Calendar");
        return { stop: true };
      }
    },
    },

    {
      action: "createTask",
      matches: () => e.keyCode === KeyCodes.C &&
      !(e.shiftKey || e.ctrlKey || e.metaKey),
      run: () => {
      e.preventDefault();
      if (currentTask && currentTask.sectionId) {
        toggleCreateTaskGlobally({
          sectionId: currentTask.sectionId,
          sectionTitle: currentTask.section,
          position: taskDetailConfig.positions.top,
        });
      }
    },
    },

    {
      action: "linkSubtask",
      matches: () => e.keyCode === KeyCodes.EQUALS && e.shiftKey && cmdControl,
      run: () => {
      e.preventDefault();
      if (currentTask && currentTask.sectionId) toggleSubtaskLinkingModal();
    },
    },

    {
      action: "dueDate",
      matches: () => matchesShortcut(e, keyboard_shortcuts.dueDateModal.default),
      run: () => {
      e.preventDefault();
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.drafts);
      else {
        updateActiveItemAndItemInView(currentTask.id);
        return { stop: true, value: toggleDueDate() };
      }
    },
    },



    {
      action: "scheduled",
      matches: () => e.keyCode === KeyCodes.U && lastGPress.current !== null,
      run: () => {
      e.preventDefault();
      navigate(taskDetailConfig.navigation.scheduled);
      return { stop: true };
    },
    },


    {
      action: "moveTask",
      matches: () => e.keyCode === KeyCodes.M &&
      !e.ctrlKey &&
      !e.metaKey &&
      (lastGPress.current === null ||
        new Date().getTime() - lastGPress.current >=
          globalConstants.gThenKeyDelay),
      run: () => {
      e.preventDefault();
      const now = new Date().getTime();
      if (lastM_APress.current && now - lastM_APress.current < taskDetailConfig.delays.doubleKeyPress) {
        lastM_APress.current = null;
        return { stop: true };
      }
      lastM_APress.current = now;
      e.preventDefault();
      return { stop: true, value: toggleMoveModal() };
    },
    },

    {
      action: "summary",
      matches: () => e.keyCode === KeyCodes.I && !e.shiftKey && !e.ctrlKey && !cmdControl,
      run: () => {
      e.preventDefault();
      if (lastGPress.current === null) {
        if (!isSummaryExpanded) scrollVirtualize("description");
        return { stop: true, value: setIsSummaryExpand((prev) => !prev) };
      }
    },
    },


    {
      action: "priority",
      matches: () => e.keyCode === KeyCodes.P && !cmdControl,
      run: () => {
      if (lastGPress.current !== null) navigate(taskDetailConfig.navigation.pinned);
      else {
        e.preventDefault();
        updateActiveItemAndItemInView(currentTask.id);
        return { stop: true, value: togglePriorityModal() };
      }
    },
    },
  ];
}
