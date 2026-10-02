import { useCallback } from "react";
import { addDays, subtractDays, isSameDate } from "@/utils/helperFunctions/calendar.functions";
import { DropResult } from "@hello-pangea/dnd";
import toast from "react-hot-toast";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import type { CalendarState } from "./useCalendarView";
import type { CalendarTasksState } from "./useCalendarTasks";
import type { CalendarTaskActionsState } from "./useCalendarTaskActions";

export function useCalendarDragDrop({
  setCurrentDate,
  currentView,
  currentDay,
  currentTask,
  tasks,
  weeks,
  getTasksForDate,
  updateDueDateHandler,
}: Pick<
  CalendarState,
  "setCurrentDate"
  | "currentView"
  | "currentDay"
  | "currentTask"
> & Pick<
  CalendarTasksState,
  "tasks"
  | "weeks"
  | "getTasksForDate"
> & Pick<
  CalendarTaskActionsState,
  "updateDueDateHandler"
>) {
  const moveTaskHorizontally = useCallback(async (direction: "left" | "right") => {
    try {
      // Check if there's a current task selected (excludes more-indicator focus)
      if (currentTask < 0) return;

      let newDueDate: Date | undefined;
      if (currentView === "day") {
        // Day view shows one day: reschedule relative to it.
        newDueDate =
          direction === "left"
            ? subtractDays(currentDay, 1)
            : addDays(currentDay, 1);
      } else {
        const daysInView = weeks.flat();
        const currentDayIndex = daysInView.findIndex(
          (day) => isSameDate(day, currentDay)
        );
        if (currentDayIndex === -1) return;
        const nextDayIndex = currentDayIndex + (direction === "left" ? -1 : 1);
        newDueDate = daysInView[nextDayIndex];
      }
      if (!newDueDate) return;

      // Get the current task
      const currentTasks = getTasksForDate(currentDay);
      const task = currentTasks.find((t) => t.id === currentTask);
      if (!task) return;

      await updateDueDateHandler(task, newDueDate);
      // Follow the task, as week view's focus does after a move.
      if (currentView === "day") setCurrentDate(newDueDate);
    } catch (error) {
      console.log("🚀 ~ moveTaskHorizontally ~ error:", error);
    }
  }, [currentTask, currentDay, currentView, weeks, getTasksForDate, updateDueDateHandler]);

  const moveTaskVertically = useCallback(async (direction: "up" | "down") => {
    try {
      // Check if there's a current task selected (excludes more-indicator focus)
      if (currentTask < 0) return;
      if (currentView === "week") return;

      const currentDayElement = document.getElementById(
        `day-${currentDay.toISOString()}`
      );
      const currentWeekElement = currentDayElement?.parentElement;
      const currentWeekIndex = Number(currentWeekElement?.id?.split("-")[1]);

      // Check boundary conditions
      if (direction === "up" && currentWeekIndex === 0) return;
      if (direction === "down" && currentWeekIndex === weeks.length - 1) return;

      // Get the current task
      const currentTasks = getTasksForDate(currentDay);
      const task = currentTasks.find((t) => t.id === currentTask);
      if (!task) return;

      // Calculate new date (move by 7 days for one week)
      const weekOffset = direction === "up" ? -7 : 7;
      const newDueDate = new Date(
        currentDay.getFullYear(),
        currentDay.getMonth(),
        currentDay.getDate() + weekOffset
      );

      await updateDueDateHandler(task, newDueDate);
    } catch (error) {
      console.log("🚀 ~ moveTaskVertically ~ error:", error);
    }
  }, [currentTask, currentView, currentDay, weeks, getTasksForDate, updateDueDateHandler]);

  async function onDragEnd(result: DropResult) {
    try {
      if (
        !result ||
        !result.destination ||
        !result.source ||
        !result.draggableId
      )
        return;

      const sourceElement = document.getElementById(result.source.droppableId);
      const destinationElement = document.getElementById(
        result.destination.droppableId
      );
      const taskId = parseInt(result.draggableId.split("-")[1]);
      if (!sourceElement || !destinationElement) return;

      const task = tasks.find((task) => task.id === taskId);
      if (!task) return;
      const newDueDate = new Date(destinationElement.id.replace("day-", ""));
      if (!newDueDate) return;
      await updateDueDateHandler(task, newDueDate);
    } catch (error) {
      console.log("🚀 ~ onDragEnd ~ error:", error);
      toast.error(calendarConfig.toast_messages.error.update);
    }
  }

  return {
    moveTaskHorizontally,
    moveTaskVertically,
    onDragEnd,
  };
}

export type CalendarDragDropState = ReturnType<typeof useCalendarDragDrop>;

