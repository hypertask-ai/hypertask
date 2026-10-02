import { useCallback, useEffect } from "react";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { keyboard_shortcuts as ks, matchesShortcut } from "@/lib/utils/keyboardShortcuts";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import globalConstants from "@/lib/constants";
import type { CalendarState, CalendarSyncState } from "./useCalendarView";
import type { CalendarTasksState } from "./useCalendarTasks";
import type { CalendarFocusState, CalendarNavigationState } from "./useCalendarFocus";
import type { CalendarTaskActionsState } from "./useCalendarTaskActions";
import type { CalendarDragDropState } from "./useCalendarDragDrop";

export function useCalendarKeyboard({
  projects,
  currentDay,
  currentTask,
  lastGClickRef,
  currentProjectCycleIndexRef,
  goToProjectShortcut,
  showDueDateModal,
  showFilterModal,
  setShowFilterModal,
  router,
  isApple,
  createTaskModal,
  checkedProjects,
  setCurrentViewFromInteraction,
  tasks,
  FOCUS_MORE_INDICATOR,
  toggleDueDateModal,
  handleTaskClick,
  toggleManageTasksModal,
  handleDateSelect,
  handleProjectToggle,
  handlePrevious,
  handleNext,
  shiftFocusHorizontally,
  shiftFocusVertically,
  moveTaskHorizontally,
  moveTaskVertically,
}: Pick<
  CalendarState,
  "projects"
  | "currentDay"
  | "currentTask"
  | "lastGClickRef"
  | "currentProjectCycleIndexRef"
  | "goToProjectShortcut"
  | "showDueDateModal"
  | "showFilterModal"
  | "setShowFilterModal"
  | "router"
  | "isApple"
  | "createTaskModal"
  | "checkedProjects"
> & Pick<
  CalendarSyncState,
  "setCurrentViewFromInteraction"
> & Pick<
  CalendarTasksState,
  "tasks"
> & Pick<
  CalendarFocusState,
  "FOCUS_MORE_INDICATOR"
> & Pick<
  CalendarTaskActionsState,
  "toggleDueDateModal"
  | "handleTaskClick"
  | "toggleManageTasksModal"
> & Pick<
  CalendarNavigationState,
  "handleDateSelect"
  | "handleProjectToggle"
  | "handlePrevious"
  | "handleNext"
  | "shiftFocusHorizontally"
  | "shiftFocusVertically"
> & Pick<
  CalendarDragDropState,
  "moveTaskHorizontally"
  | "moveTaskVertically"
>) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (showDueDateModal?.show || createTaskModal.show || showFilterModal) return;
    if (returnIfModalOrInputActive()) return;
    let cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);

    // Handle Tab key navigation and prevent default focus behavior
    if (matchesShortcut(event, ks.calendar.focus_previous_day)) {
      event.preventDefault();
      shiftFocusHorizontally("left");
    } else if (matchesShortcut(event, ks.calendar.focus_next_day)) {
      event.preventDefault();
      shiftFocusHorizontally("right");
    }

    //I do feel like calling a function to check if it matches the shortcut is a little weird/overkill here. 
    if (matchesShortcut(event, ks.universal_movement.left))
      shiftFocusHorizontally("left");
    else if (matchesShortcut(event, ks.universal_movement.right))
      shiftFocusHorizontally("right");
    else if (matchesShortcut(event, ks.universal_movement.up))
      shiftFocusVertically("up");
    else if (matchesShortcut(event, ks.universal_movement.down))
      shiftFocusVertically("down");
    else if (
      matchesShortcut(event, ks.universal_shift.left)
    ) moveTaskHorizontally("left");
    else if (matchesShortcut(event, ks.universal_shift.right))
      moveTaskHorizontally("right");
    else if (matchesShortcut(event, ks.universal_shift.up))
      moveTaskVertically("up");
    else if (matchesShortcut(event, ks.universal_shift.down))
      moveTaskVertically("down");
    //wdsf

    if (matchesShortcut(event, ks.dueDateModal.default) && currentTask >= 0)
      toggleDueDateModal("Update");

    if (event.keyCode === KeyCodes.ENTER) {
      event.preventDefault();
      if (currentTask === FOCUS_MORE_INDICATOR) {
        setTimeout(() => toggleManageTasksModal(currentDay), 200);
        return;
      }
      if (currentTask >= 0)
        return handleTaskClick(
          currentDay,
          tasks.find((task) => task.id === currentTask)!
        );
      return toggleDueDateModal("Create");
    }

    // [g] press - track for G then T shortcut
    if (event.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastGClickRef.current = now;
      setTimeout(() => {
        lastGClickRef.current = null;
      }, globalConstants.gThenKeyDelay);
    }

    // [g] then [t] for go to project shortcut
    if (event.keyCode === KeyCodes.T) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;

        // Get projectId from current task if available
        if (currentTask >= 0) {
          const task = tasks.find((t) => t.id === currentTask);
          if (task?.projectId) {
            goToProjectShortcut(task.projectId, true);
          }
        }
        return;
      }
    }

    if (
      event.keyCode === KeyCodes.D &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;
        router.push(globalConstants.draftsRoute);
        return;
      }
    }

    if (event.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;
        router.push("/scheduled");
        return;
      }
    }

    if (matchesShortcut(event, ks.calendar.add_task)) {
      event.preventDefault();
      toggleDueDateModal("Create");
    }

    if (matchesShortcut(event, ks.calendar.previous_group)) {
      event.preventDefault();
      handlePrevious();
    }
    if (matchesShortcut(event, ks.calendar.next_group)) {
      event.preventDefault();
      handleNext();
    }
    if (matchesShortcut(event, ks.calendar.focus_today)) {
      event.preventDefault();
      handleDateSelect(new Date());
    }

    if (matchesShortcut(event, ks.calendar.month_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("month");
    }
    if (matchesShortcut(event, ks.calendar.week_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("week");
    }
    if (matchesShortcut(event, ks.calendar.day_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("day");
    }

    if ((event.keyCode === KeyCodes.CLOSE_BRACKET || event.keyCode === KeyCodes.OPEN_BRACKET) && cmdControl) {
      event.preventDefault();
      if (projects.length > 0) {
        if (currentProjectCycleIndexRef.current === -1) {
          currentProjectCycleIndexRef.current = 0;
          document.getElementById(projects[0].name)?.focus();
          return
        }
        const goTo = event.keyCode === KeyCodes.CLOSE_BRACKET ? 1 : -1;
        const nextIndex = (currentProjectCycleIndexRef.current + goTo + projects.length) % projects.length;
        currentProjectCycleIndexRef.current = nextIndex;
        document.getElementById(projects[nextIndex].name)?.focus();
      }
    }
    if (event.keyCode === KeyCodes.SPACE) {
      event.preventDefault();
      const projectToToggle = projects[currentProjectCycleIndexRef.current];
      // ponytail: the cycle index starts at -1, so Space before Ctrl+] has nothing to toggle.
      if (!projectToToggle) return;
      handleProjectToggle(projectToToggle.id, !checkedProjects[projectToToggle.id]);
    }

    if (event.keyCode === KeyCodes.F && event.shiftKey) {
      event.preventDefault();
      setShowFilterModal(true);
    }

    if (matchesShortcut(event, ks.calendar.go_back)) {
      event.preventDefault();
      // HTPR-4821: Escape used to call back() unconditionally, so on a tab whose
      // previous entry is outside the app it walked out of the SPA and left a
      // blank page. The Navigation API only lists same-origin entries, so a
      // current index above 0 means there is an in-app page to return to.
      const nav = (window as any).navigation;
      const canGoBackInApp =
        typeof nav?.currentEntry?.index === "number"
          ? nav.currentEntry.index > 0
          : window.history.length > 1;
      if (canGoBackInApp) router.back();
      return;
    }
  }, [
    showDueDateModal,
    currentTask,
    currentDay,
    tasks,
    shiftFocusHorizontally,
    shiftFocusVertically,
    moveTaskHorizontally,
    moveTaskVertically,
    toggleDueDateModal,
    toggleManageTasksModal,
    handleTaskClick,
    goToProjectShortcut,
    createTaskModal,
    projects,
    checkedProjects,
    handleProjectToggle,
    showFilterModal,
  ]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}

