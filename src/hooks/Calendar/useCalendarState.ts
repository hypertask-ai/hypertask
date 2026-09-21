import type { ITask } from "@/models/model";
type CommandContext = Record<string, any>;

export function shiftCalendarFocus(direction: "up" | "down", getContext: () => CommandContext) {
 const { FOCUS_MORE_INDICATOR, currentDay, currentTask, currentView, getTasksForDate, setCurrentDay, setCurrentTaskWithFocus, tasks, weeks } = getContext();
        try {
            const currentDayElement = document.getElementById(`day-${currentDay.toISOString()}`);
            const currentWeekElement = currentDayElement?.parentElement;
            const currentWeekIndex = Number(currentWeekElement?.id?.split("-")[1]);
            const currentTasks = getTasksForDate(currentDay);
            const currentTaskIndex = currentTasks.findIndex((task: ITask) => task.id === currentTask);
            const hasMoreIndicator = currentView === "month" && currentTasks.length > 2;
            const visibleTasksCount = currentView === "month"
                ? hasMoreIndicator
                    ? 3
                    : Math.min(2, currentTasks.length)
                : currentTasks.length;
            const moveToWeek = (weekOffset: number) => {
                const newDate = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate() + weekOffset);
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
                }
                else {
                    taskToSelect = tasks[0];
                }
                setCurrentTaskWithFocus(taskToSelect?.id ?? -1, newDate);
            };
            const isFirstWeek = direction === "up" && currentWeekIndex === 0 && currentView === "month";
            const isLastWeek = direction === "down" &&
                currentWeekIndex === weeks.length - 1 &&
                currentView === "month";
            // Focus is on the "more" indicator (month view, day has >2 tasks)
            if (currentTask === FOCUS_MORE_INDICATOR && currentView === "month") {
                if (direction === "up") {
                    setCurrentTaskWithFocus(currentTasks[1].id);
                }
                else {
                    if (isLastWeek)
                        return;
                    moveToWeek(7);
                }
                return;
            }
            // If no current task, move to adjacent week
            if (currentTaskIndex === -1 && currentView === "month") {
                if (isFirstWeek || isLastWeek)
                    return;
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
                    if (isFirstWeek)
                        return;
                    currentView === "month" && moveToWeek(-7);
                }
                else {
                    setCurrentTaskWithFocus(currentTasks[currentTaskIndex - 1].id);
                }
            }
            else {
                if (isAtLastVisibleTask) {
                    if (hasMoreIndicator) {
                        setCurrentTaskWithFocus(FOCUS_MORE_INDICATOR, currentDay);
                    }
                    else {
                        if (isLastWeek)
                            return;
                        currentView === "month" && moveToWeek(7);
                    }
                }
                else {
                    setCurrentTaskWithFocus(currentTasks[currentTaskIndex + 1].id);
                }
            }
        }
        catch (error) {
            console.log("🚀 ~ shiftFocusVertically ~ error:", error);
        }
    
}
