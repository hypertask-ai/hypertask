import { useCallback } from "react";
import { ITask } from "@/models/model";
import { isToday, startOfDay } from "date-fns";
import toast from "react-hot-toast";
import axios from "axios";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { markTaskDetailNavigationStart } from "@/lib/analytics/taskDetailReadiness";
import type { CalendarState, CalendarTaskUpdatesState } from "./useCalendarView";
import type { CalendarTasksState } from "./useCalendarTasks";
import type { CalendarFocusState } from "./useCalendarFocus";

export function useCalendarTaskActions({
  reconcileCalendar,
  updateTaskProjection,
  currentDay,
  setCurrentDay,
  currentTask,
  updateTaskInCache,
  updateActiveItemAndItemInView,
  setTaskPlayList,
  getDefaultOptions,
  showDueDateModal,
  setShowDueDateModal,
  setShowManageTasksModal,
  setShowFilterModal,
  router,
  tasks,
  getTasksForDate,
  setCurrentTaskWithFocus,
  onTaskUpdate,
}: Pick<
  CalendarState,
  "reconcileCalendar"
  | "updateTaskProjection"
  | "currentDay"
  | "setCurrentDay"
  | "currentTask"
  | "updateTaskInCache"
  | "updateActiveItemAndItemInView"
  | "setTaskPlayList"
  | "getDefaultOptions"
  | "showDueDateModal"
  | "setShowDueDateModal"
  | "setShowManageTasksModal"
  | "setShowFilterModal"
  | "router"
> & Pick<
  CalendarTasksState,
  "tasks"
  | "getTasksForDate"
> & Pick<
  CalendarFocusState,
  "setCurrentTaskWithFocus"
> & Pick<
  CalendarTaskUpdatesState,
  "onTaskUpdate"
>) {
  const updateDueDateHandler = useCallback(async (task: ITask, dueDate: Date | undefined) => {
    try {
      // If dueDate is undefined, we're removing the due date
      const isRemovingDueDate = dueDate === undefined;

      let finalDueDate: Date | undefined = dueDate;

      if (!isRemovingDueDate && dueDate) {
        if (isToday(dueDate)) {
          const nextBestOption = getDefaultOptions()[0];
          finalDueDate = new Date(nextBestOption.date);
        } else {
          finalDueDate = new Date(dueDate);
          finalDueDate.setHours(21, 0, 0, 0);
        }
      }

      // Helper function to normalize dates for comparison (date only, no time)
      const normalizeDateForComparison = (date: Date | string | null | undefined): Date | null => {
        if (!date) return null;
        const d = new Date(date);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      };

      // Check if the due date is the same as the current task's due date
      const currentTaskDueDate = normalizeDateForComparison(task.dueDate);
      const newDueDateNormalized = normalizeDateForComparison(finalDueDate);

      // Compare dates (handling both null/undefined cases)
      const isSameDueDate =
        (currentTaskDueDate === null && newDueDateNormalized === null) ||
        (currentTaskDueDate !== null &&
          newDueDateNormalized !== null &&
          currentTaskDueDate.getTime() === newDueDateNormalized.getTime());

      //Added this here so it wouldnt call the API and give a 500 error every time.
      if (isSameDueDate) {
        // Due date hasn't changed, no need to send API request
        return;
      }

      // Check if the new due date is in the past (only for non-null dates)
      // Compare normalized dates (date only, no time) to check if it's before today
      if (newDueDateNormalized) {
        const todayNormalized = startOfDay(new Date());
        if (newDueDateNormalized.getTime() < todayNormalized.getTime()) {
          // Date is in the past, show user-friendly message and return
          toast.error("Cannot set due date in the past");
          return;
        }
      }

      const response = await axios.post(calendarConfig.api_endpoints.addTaskToDueDate, {
        taskId: task.id,
        dueDate: finalDueDate || null, // Send null to API when removing due date
      });

      if (response.status === 200) {
        onTaskUpdate(task, { dueDate: finalDueDate });

        if (isRemovingDueDate) {
          // Task will be removed from calendar view, reset current task if it was the removed task
          if (currentTask === task.id) {
            const tasksForCurrentDay = getTasksForDate(currentDay);
            const remainingTasks = tasksForCurrentDay.filter(
              (t) => t.id !== task.id
            );
            setCurrentTaskWithFocus(
              remainingTasks.length > 0 ? remainingTasks[0].id : -1,
              currentDay
            );
          }
        } else if (finalDueDate) {
          // Update current day to the new due date
          // Normalize the date to remove time component to match dates in weeks array
          const normalizedDate = new Date(
            finalDueDate.getFullYear(),
            finalDueDate.getMonth(),
            finalDueDate.getDate()
          );
          setCurrentDay(normalizedDate);
          setCurrentTaskWithFocus(task.id);
          document
            .getElementById(`day-${normalizedDate.toISOString()}`)
            ?.focus();
        }
      }
    } catch (error) {
      console.error("updateDueDateHandler error:", error);
      toast.error(calendarConfig.toast_messages.error.update);
    }
  }, [getDefaultOptions, currentTask, currentDay, getTasksForDate, setCurrentTaskWithFocus, onTaskUpdate]);


  const addTaskToState = useCallback(async (task: ITask, date: Date) => {
    try {
      // Persist the due date to the backend
      const response = await axios.post(calendarConfig.api_endpoints.addTaskToDueDate, {
        taskId: task.id,
        dueDate: date,
      });

      if (response.status === 200) {
        // Create a new task object with the updated dueDate
        const updatedTask: ITask = {
          ...task,
          dueDate: date,
        };

        updateTaskProjection(updatedTask);

        updateTaskInCache(
          updatedTask,
          updatedTask.id,
          updatedTask.projectId,
          updatedTask.sectionId
        );
        reconcileCalendar("manual");
        toast.success(calendarConfig.toast_messages.success.add);
      } else {
        throw new Error("Failed to update due date");
      }
    } catch (error) {
      console.log("🚀 ~ addTaskToState ~ error:", error);
      toast.error(calendarConfig.toast_messages.error.add);
    }
  }, [reconcileCalendar, updateTaskInCache, updateTaskProjection]);

  const dueDateModalCallback = useCallback((date: Date | undefined, taskSelected?: ITask) => {
    try {
      if (currentTask < 0 && !taskSelected) return;
      let taskToUpdate = taskSelected ?? currentTask;
      const task = tasks.find((t) => t.id === taskToUpdate);
      if (!task) return;
      updateDueDateHandler(task, date);
    } catch (error) {
      console.log("🚀 ~ dueDateModalCallback ~ error:", error);
    }
  }, [currentTask, tasks, updateDueDateHandler]);

  const toggleFilterModal = () => setShowFilterModal((prev) => !prev);

  const toggleDueDateModal = useCallback((
    mode?: "Create" | "Update",
    payload?: {
      task?: ITask;
      date: Date | undefined;
    }
  ) => {
    if (!mode) {
      setShowDueDateModal(undefined);
      if (!payload) return;
      const { task, date } = payload;
      const currentMode = showDueDateModal?.mode;

      if (currentMode === "Update") dueDateModalCallback(date || undefined, task);
      else if (currentMode === "Create" && task && date)
        addTaskToState(task, date || undefined);
    } else setShowDueDateModal({ show: true, mode });
  }, [showDueDateModal, dueDateModalCallback, addTaskToState]);

  const handleTaskClick = useCallback((taskDay: Date, task: ITask) => {
    const tasks = getTasksForDate(taskDay);
    setTaskPlayList(
      tasks.map((task) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      }))
    );
    const targetUrl = `/detail/project-${task.projectId}/${task.uniqueIndex}`;
    markTaskDetailNavigationStart("calendar", targetUrl);
    router.push(targetUrl);
  }, [getTasksForDate, setTaskPlayList, router]);

  const toggleManageTasksModal = useCallback((
    date: Date,
    close?: boolean,
    mode?: "Add" | "Update" | "Visit",
    task?: ITask
  ) => {
    // Close modal if explicitly requested
    if (close === true) {
      setShowManageTasksModal(undefined);
      return;
    }

    // Handle Add mode - open due date modal in Create mode
    if (mode === "Add") {
      setShowManageTasksModal(undefined);
      setShowDueDateModal({ show: true, mode: "Create" });
      return;
    }

    // Handle Update mode - open due date modal in Update mode with task
    if (mode === "Update" && task) {
      setShowManageTasksModal(undefined);
      updateActiveItemAndItemInView(task);
      setShowDueDateModal({ show: true, mode: "Update", selectedTask: task });
      return;
    }

    // Handle Visit mode - navigate to the task's detail page
    if (mode === "Visit" && task) {
      setShowManageTasksModal(undefined);
      handleTaskClick(date, task);
      return;
    }

    // Default: open manage tasks modal with the provided date
    setShowManageTasksModal({ show: true, date });
  }, [updateActiveItemAndItemInView]);

  return {
    updateDueDateHandler,
    dueDateModalCallback,
    toggleFilterModal,
    toggleDueDateModal,
    handleTaskClick,
    toggleManageTasksModal,
  };
}

export type CalendarTaskActionsState = ReturnType<typeof useCalendarTaskActions>;

