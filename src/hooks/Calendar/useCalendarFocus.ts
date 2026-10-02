import { calendarConfig } from "@/lib/configs/ calendar.config";
import { useCallback, useEffect } from "react";
import {
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getWeekStartIndex,
  startOfWeek,
  addMonths,
  subtractMonths,
  addDays,
  subtractDays,
  isSameDate,
} from "@/utils/helperFunctions/calendar.functions";
import type { CalendarState } from "./useCalendarView";
import type { CalendarTasksState } from "./useCalendarTasks";

export function useCalendarFocus({
  currentView,
  calendarSettings,
  currentDay,
  setCurrentDay,
  setCurrentTask,
  updateActiveItemAndItemInView,
  tasks,
  getTasksForDate,
}: Pick<
  CalendarState,
  "currentView"
  | "calendarSettings"
  | "currentDay"
  | "setCurrentDay"
  | "setCurrentTask"
  | "updateActiveItemAndItemInView"
> & Pick<
  CalendarTasksState,
  "tasks"
  | "getTasksForDate"
>) {
  const FOCUS_MORE_INDICATOR = calendarConfig.constants.focus_more_indicator;

  // Helper function to set currentTask, focus on it, and update active item
  const setCurrentTaskWithFocus = useCallback((taskId: number, day?: Date) => {
    setCurrentTask(taskId);

    if (taskId === FOCUS_MORE_INDICATOR && day) {
      const moreElement = document.getElementById(
        calendarConfig.element_ids.more_tasks_indicator(day)
      );
      if (moreElement) {
        moreElement.focus();
        moreElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      return;
    }

    if (taskId !== -1) {
      // Find the task object
      const task = tasks.find((t) => t.id === taskId);

      if (task) {
        // Focus on the task element
        const taskElement = document.getElementById(`task-${taskId}`);
        if (taskElement) {
          taskElement.focus();
          taskElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Update active item and item in view
        updateActiveItemAndItemInView(task);
      }
    } else {
      // When there are no tasks, scroll to the day section
      const dayToScroll = day || currentDay;
      const dayElement = document.getElementById(
        `day-${dayToScroll.toISOString()}`
      );
      if (dayElement) {
        // Use setTimeout to ensure the element is fully rendered
        setTimeout(() => {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 0);
      }
    }
  }, [tasks, currentDay, updateActiveItemAndItemInView]);

  // Helper function to update focus after date range navigation
  const updateFocusAfterNavigation = (newDate: Date) => {
    // Calculate what days will be in the new range
    const daysInNewRange: Date[] = [];

    if (currentView === "month") {
      const monthStart = getFirstDayOfMonth(newDate);
      const monthEnd = getLastDayOfMonth(newDate);
      const startDay = getWeekStartIndex(
        monthStart,
        calendarSettings.weekStartsOn
      );
      const endDay = getWeekStartIndex(
        monthEnd,
        calendarSettings.weekStartsOn
      );

      // Add days from previous month
      for (let i = startDay - 1; i >= 0; i--) {
        const date = new Date(monthStart);
        date.setDate(date.getDate() - (i + 1));
        daysInNewRange.push(date);
      }
      // Add days of current month
      for (let i = 1; i <= monthEnd.getDate(); i++) {
        daysInNewRange.push(
          new Date(newDate.getFullYear(), newDate.getMonth(), i)
        );
      }
      // Add days from next month
      for (let i = 1; i < 7 - endDay; i++) {
        daysInNewRange.push(
          new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i)
        );
      }
    } else if (currentView === "week") {
      const weekStart = startOfWeek(newDate, calendarSettings.weekStartsOn);
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        if (
          calendarSettings.showWeekends ||
          (date.getDay() !== 0 && date.getDay() !== 6)
        ) {
          daysInNewRange.push(date);
        }
      }
    } else {
      // Day view - just the single day
      daysInNewRange.push(newDate);
    }

    // Find the first day with tasks, or use the first day if no tasks
    let dayToFocus: Date | null = null;
    let taskToFocus: number = -1;

    for (const day of daysInNewRange) {
      const tasksForDay = getTasksForDate(day);
      if (tasksForDay.length > 0) {
        dayToFocus = day;
        taskToFocus = tasksForDay[0].id;
        break;
      }
    }

    // If no tasks found, use the first day
    if (!dayToFocus && daysInNewRange.length > 0) {
      dayToFocus = daysInNewRange[0];
    }

    // Update currentDay and currentTask
    if (dayToFocus) {
      setCurrentDay(dayToFocus);

      // Focus on the day element
      const dayElement = document.getElementById(
        `day-${dayToFocus!.toISOString()}`
      );
      if (dayElement) {
        dayElement.focus();
        dayElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }

      // Set current task
      setCurrentTaskWithFocus(taskToFocus, dayToFocus);
    }
  };

  return {
    FOCUS_MORE_INDICATOR,
    setCurrentTaskWithFocus,
    updateFocusAfterNavigation,
  };
}

export type CalendarFocusState = ReturnType<typeof useCalendarFocus>;

export function useCalendarNavigation({
  currentDate,
  setCurrentDate,
  currentView,
  calendarSettings,
  currentDay,
  setCurrentDay,
  currentTask,
  pendingDateSelectRef,
  setCheckedProjects,
  taskFilters,
  setTaskFilters,
  hasInteractedWithCalendarState,
  weeks,
  getTasksForDate,
  FOCUS_MORE_INDICATOR,
  setCurrentTaskWithFocus,
  updateFocusAfterNavigation,
}: Pick<
  CalendarState,
  "currentDate"
  | "setCurrentDate"
  | "currentView"
  | "calendarSettings"
  | "currentDay"
  | "setCurrentDay"
  | "currentTask"
  | "pendingDateSelectRef"
  | "setCheckedProjects"
  | "taskFilters"
  | "setTaskFilters"
  | "hasInteractedWithCalendarState"
> & Pick<
  CalendarTasksState,
  "weeks"
  | "getTasksForDate"
> & Pick<
  CalendarFocusState,
  "FOCUS_MORE_INDICATOR"
  | "setCurrentTaskWithFocus"
  | "updateFocusAfterNavigation"
>) {
  function handleDateSelect(date: Date | undefined) {
    try {
      if (!date) return;

      // Normalize the date to remove time component (set to midnight)
      let normalizedDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      if (
        currentView === "week" &&
        !calendarSettings.showWeekends &&
        (normalizedDate.getDay() === 0 || normalizedDate.getDay() === 6)
      ) {
        normalizedDate = startOfWeek(
          normalizedDate,
          calendarSettings.weekStartsOn
        );
        while (normalizedDate.getDay() === 0 || normalizedDate.getDay() === 6) {
          normalizedDate.setDate(normalizedDate.getDate() + 1);
        }
      }

      // Flatten all days from weeks array to check if date exists in current view
      const allDaysInView = weeks.flat();
      const dateExistsInView = allDaysInView.some((day) =>
        isSameDate(day, normalizedDate)
      );

      if (dateExistsInView) {
        // Date is in current view, focus on it immediately
        setCurrentDay(normalizedDate);

        // Focus on the day element
        const dayElement = document.getElementById(
          `day-${normalizedDate.toISOString()}`
        );
        if (dayElement) {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Set current task to first task if any, or -1 if no tasks
        const tasksForDate = getTasksForDate(normalizedDate);
        setCurrentTaskWithFocus(
          tasksForDate.length > 0 ? tasksForDate[0].id : -1,
          normalizedDate
        );
      } else {
        // Date is not in current view, navigate to the correct date range
        // Store the target date in ref to handle after weeks recalculate
        pendingDateSelectRef.current = normalizedDate;

        if (currentView === "month") {
          // For month view, set currentDate to the selected date's month
          setCurrentDate(new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), 1));
        } else if (currentView === "week") {
          // For week view, set currentDate to the selected date (it will calculate the week)
          setCurrentDate(new Date(normalizedDate));
        } else {
          // For day view, set currentDate to the selected date
          setCurrentDate(new Date(normalizedDate));
        }
      }
    } catch (error) {
      console.log("🚀 ~ handleDateSelect ~ error:", error);
    }
  }

  const handleProjectToggle = (projectId: number, checked: boolean) => {
    hasInteractedWithCalendarState.current = true;
    setCheckedProjects((prev) => ({
      ...prev,
      [projectId]: checked,
    }));
  };

  const handleTaskFilterToggle = (filterName: keyof typeof taskFilters, checked: boolean) => {
    hasInteractedWithCalendarState.current = true;
    setTaskFilters((prev) => ({ ...prev, [filterName]: checked }));
  };

  const handleClearFilters = () => {
    hasInteractedWithCalendarState.current = true;
    setCheckedProjects({});
    setTaskFilters((prev) => ({
      ...prev,
      updatedBy: [],
      createdBy: [],
      priority: [],
      assignees: [],
      assigneeAgents: [],
      updatedByAgents: [],
      labels: [],
      size: [],
      assignedToMe: false,
    }));
  };

  const handlePrevious = () => {
    let newDate: Date;
    if (currentView === "month") {
      newDate = subtractMonths(currentDate, 1);
    } else if (currentView === "week") {
      newDate = subtractDays(currentDate, 7);
    } else {
      newDate = subtractDays(currentDate, 1);
    }
    setCurrentDate(newDate);
    // Update focus after navigation
    updateFocusAfterNavigation(newDate);
  };

  const handleNext = () => {
    let newDate: Date;
    if (currentView === "month") {
      newDate = addMonths(currentDate, 1);
    } else if (currentView === "week") {
      newDate = addDays(currentDate, 7);
    } else {
      newDate = addDays(currentDate, 1);
    }
    setCurrentDate(newDate);
    // Update focus after navigation
    updateFocusAfterNavigation(newDate);
  };

  const shiftFocusHorizontally = useCallback((direction: "left" | "right") => {
    try {
      // Day view holds a single day: moving sideways means navigating days.
      if (currentView === "day") {
        if (direction === "left") handlePrevious();
        else handleNext();
        return;
      }
      const daysInView = weeks.flat();
      const currentDayIndex = daysInView.findIndex(
        (day) => isSameDate(day, currentDay)
      );
      if (currentDayIndex === -1) return;
      const nextDayIndex = currentDayIndex + (direction === "left" ? -1 : 1);
      const newDate = daysInView[nextDayIndex];
      if (!newDate) return;

      document.getElementById(`day-${newDate.toISOString()}`)?.focus();
      setCurrentDay(newDate);

      // Update current task based on tasks for the new date
      const tasks = getTasksForDate(newDate);
      setCurrentTaskWithFocus(tasks.length > 0 ? tasks[0].id : -1, newDate);
    } catch (error) {
      console.log("🚀 ~ shiftFocusHorizontally ~ error:", error);
    }
  }, [currentDay, weeks, getTasksForDate, setCurrentTaskWithFocus, currentView, handlePrevious, handleNext]);

  const shiftFocusVertically = useCallback((direction: "up" | "down") => {
    try {
      const currentDayElement = document.getElementById(
        `day-${currentDay.toISOString()}`
      );
      const currentWeekElement = currentDayElement?.parentElement;
      const currentWeekIndex = Number(currentWeekElement?.id?.split("-")[1]);

      const currentTasks = getTasksForDate(currentDay);
      const currentTaskIndex = currentTasks.findIndex(
        (task) => task.id === currentTask
      );

      const hasMoreIndicator =
        currentView === "month" && currentTasks.length > 2;
      const visibleTasksCount =
        currentView === "month"
          ? hasMoreIndicator
            ? 3
            : Math.min(2, currentTasks.length)
          : currentTasks.length;

      const moveToWeek = (weekOffset: number) => {
        const newDate = new Date(
          currentDay.getFullYear(),
          currentDay.getMonth(),
          currentDay.getDate() + weekOffset
        );
        document.getElementById(`day-${newDate.toISOString()}`)?.focus();
        setCurrentDay(newDate);

        const tasks = getTasksForDate(newDate);

        if (direction === "up" && currentView === "month" && tasks.length > 2) {
          setCurrentTaskWithFocus(FOCUS_MORE_INDICATOR, newDate);
          return;
        }

        let taskToSelect;
        if (direction === "up") {
          taskToSelect = tasks[tasks.length - 1];
        } else {
          taskToSelect = tasks[0];
        }

        setCurrentTaskWithFocus(taskToSelect?.id ?? -1, newDate);
      };

      const isFirstWeek =
        direction === "up" && currentWeekIndex === 0 && currentView === "month";
      const isLastWeek =
        direction === "down" &&
        currentWeekIndex === weeks.length - 1 &&
        currentView === "month";

      // Focus is on the "more" indicator (month view, day has >2 tasks)
      if (currentTask === FOCUS_MORE_INDICATOR && currentView === "month") {
        if (direction === "up") {
          setCurrentTaskWithFocus(currentTasks[1].id);
        } else {
          if (isLastWeek) return;
          moveToWeek(7);
        }
        return;
      }

      // If no current task, move to adjacent week
      if (currentTaskIndex === -1 && currentView === "month") {
        if (isFirstWeek || isLastWeek) return;
        moveToWeek(direction === "up" ? -7 : 7);
        return;
      }

      const isAtFirstTask = currentTaskIndex === 0;
      const isAtLastVisibleTask = hasMoreIndicator
        ? currentTaskIndex === 1 // down from task 1 goes to more indicator
        : currentView === "month"
          ? currentTaskIndex === visibleTasksCount - 1
          : currentTaskIndex === currentTasks.length - 1;

      if (direction === "up") {
        if (isAtFirstTask) {
          if (isFirstWeek) return;
          currentView === "month" && moveToWeek(-7);
        } else {
          setCurrentTaskWithFocus(currentTasks[currentTaskIndex - 1].id);
        }
      } else {
        if (isAtLastVisibleTask) {
          if (hasMoreIndicator) {
            setCurrentTaskWithFocus(FOCUS_MORE_INDICATOR, currentDay);
          } else {
            if (isLastWeek) return;
            currentView === "month" && moveToWeek(7);
          }
        } else {
          setCurrentTaskWithFocus(currentTasks[currentTaskIndex + 1].id);
        }
      }
    } catch (error) {
      console.log("🚀 ~ shiftFocusVertically ~ error:", error);
    }
  }, [currentDay, currentTask, currentView, weeks, getTasksForDate, setCurrentTaskWithFocus]);

  return {
    handleDateSelect,
    handleProjectToggle,
    handleTaskFilterToggle,
    handleClearFilters,
    handlePrevious,
    handleNext,
    shiftFocusHorizontally,
    shiftFocusVertically,
  };
}

export type CalendarNavigationState = ReturnType<typeof useCalendarNavigation>;

export function useCalendarFocusSync({
  currentView,
  currentDay,
  setCurrentDay,
  currentTask,
  viewRef,
  pendingDateSelectRef,
  hasInitializedTaskRef,
  tasks,
  tasksByDate,
  weeks,
  getTasksForDate,
  setCurrentTaskWithFocus,
}: Pick<
  CalendarState,
  "currentView"
  | "currentDay"
  | "setCurrentDay"
  | "currentTask"
  | "viewRef"
  | "pendingDateSelectRef"
  | "hasInitializedTaskRef"
> & Pick<
  CalendarTasksState,
  "tasks"
  | "tasksByDate"
  | "weeks"
  | "getTasksForDate"
> & Pick<
  CalendarFocusState,
  "setCurrentTaskWithFocus"
>) {
  useEffect(() => {
    // When view changes, recalculate currentDay and currentTask
    const allDaysInView = weeks.flat();
    const currentDayExists = allDaysInView.some((day) =>
      isSameDate(day, currentDay)
    );

    if (viewRef.current !== currentView || !currentDayExists) {
      // Helper function to get tasks for a date
      const getTasksForDateHelper = (date: Date) => {
        const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        return tasksByDate.get(dateKey) || [];
      };

      if (currentDayExists) {
        // Current day is in view, check if it has tasks
        const tasksForCurrentDay = getTasksForDateHelper(currentDay);
        if (tasksForCurrentDay.length > 0) {
          setCurrentTaskWithFocus(tasksForCurrentDay[0].id);
        } else {
          setCurrentTaskWithFocus(-1, currentDay);
        }
      } else {
        // Current day is not in view, find first task in weeks array
        let foundTask = false;
        let firstDayWithTask: Date | null = null;
        let firstTaskId: number | null = null;

        for (const day of allDaysInView) {
          const tasksForDay = getTasksForDateHelper(day);
          if (tasksForDay.length > 0) {
            firstDayWithTask = day;
            firstTaskId = tasksForDay[0].id;
            foundTask = true;
            break;
          }
        }

        if (foundTask && firstDayWithTask && firstTaskId !== null) {
          // Found a task, set currentDay and currentTask
          setCurrentDay(firstDayWithTask);
          setCurrentTaskWithFocus(firstTaskId);
        } else {
          // No tasks found, focus on the first day
          const firstDay = allDaysInView[0];
          if (firstDay) {
            setCurrentDay(firstDay);
            setCurrentTaskWithFocus(-1, firstDay);
          }
        }
      }

      viewRef.current = currentView;
    }
  }, [tasks, currentDay, tasksByDate, currentView, weeks]);

  useEffect(() => {
    if (
      !hasInitializedTaskRef.current &&
      tasksByDate.size > 0 &&
      currentTask === -1
    ) {
      const dateKey = `${currentDay.getFullYear()}-${currentDay.getMonth()}-${currentDay.getDate()}`;
      const tasksForCurrentDay = tasksByDate.get(dateKey) || [];
      if (tasksForCurrentDay.length > 0) {
        setCurrentTaskWithFocus(tasksForCurrentDay[0].id);
      }
      // Mark as initialized regardless of whether we found a task for current day
      // This prevents re-running when user intentionally sets currentTask to -1
      hasInitializedTaskRef.current = true;
    }
  }, [tasksByDate, currentDay, currentTask]);

  // Handle pending date selection after weeks recalculate
  useEffect(() => {
    if (pendingDateSelectRef.current) {
      const targetDate = pendingDateSelectRef.current;
      // Check if target date is now in the weeks array
      const allDaysInView = weeks.flat();
      const dateExistsInView = allDaysInView.some((day) =>
        isSameDate(day, targetDate)
      );

      if (dateExistsInView) {
        // Date is now in view, focus on it
        setCurrentDay(targetDate);

        // Focus on the day element
        const dayElement = document.getElementById(
          `day-${targetDate.toISOString()}`
        );
        if (dayElement) {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Set current task to first task if any, or -1 if no tasks
        const tasksForDate = getTasksForDate(targetDate);
        setCurrentTaskWithFocus(
          tasksForDate.length > 0 ? tasksForDate[0].id : -1,
          targetDate
        );

        // Clear the pending date selection
        pendingDateSelectRef.current = null;
      }
    }
  }, [weeks, getTasksForDate]);
}

