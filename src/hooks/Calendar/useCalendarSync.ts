import { ITask } from "@/models/model";
import axios from "axios";
import toast from "react-hot-toast";
import { isToday, startOfDay } from "date-fns";
import { calendarConfig } from "@/lib/configs/ calendar.config";

type CommandContext = Record<string, any>;

export async function updateCalendarDueDate(task: ITask, dueDate: Date | undefined, getContext: () => CommandContext) {
 const { currentDay, currentTask, getDefaultOptions, getTasksForDate, onTaskUpdate, setCurrentDay, setCurrentTaskWithFocus } = getContext();
        try {
            // If dueDate is undefined, we're removing the due date
            const isRemovingDueDate = dueDate === undefined;
            let finalDueDate: Date | undefined = dueDate;
            if (!isRemovingDueDate && dueDate) {
                if (isToday(dueDate)) {
                    const nextBestOption = getDefaultOptions()[0];
                    finalDueDate = new Date(nextBestOption.date);
                }
                else {
                    finalDueDate = new Date(dueDate);
                    finalDueDate.setHours(21, 0, 0, 0);
                }
            }
            // Helper function to normalize dates for comparison (date only, no time)
            const normalizeDateForComparison = (date: Date | string | null | undefined): Date | null => {
                if (!date)
                    return null;
                const d = new Date(date);
                return new Date(d.getFullYear(), d.getMonth(), d.getDate());
            };
            // Check if the due date is the same as the current task's due date
            const currentTaskDueDate = normalizeDateForComparison(task.dueDate);
            const newDueDateNormalized = normalizeDateForComparison(finalDueDate);
            // Compare dates (handling both null/undefined cases)
            const isSameDueDate = (currentTaskDueDate === null && newDueDateNormalized === null) ||
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
                        const remainingTasks = tasksForCurrentDay.filter((t: ITask) => t.id !== task.id);
                        setCurrentTaskWithFocus(remainingTasks.length > 0 ? remainingTasks[0].id : -1, currentDay);
                    }
                }
                else if (finalDueDate) {
                    // Update current day to the new due date
                    // Normalize the date to remove time component to match dates in weeks array
                    const normalizedDate = new Date(finalDueDate.getFullYear(), finalDueDate.getMonth(), finalDueDate.getDate());
                    setCurrentDay(normalizedDate);
                    setCurrentTaskWithFocus(task.id);
                    document
                        .getElementById(`day-${normalizedDate.toISOString()}`)
                        ?.focus();
                }
            }
        }
        catch (error) {
            console.error("updateDueDateHandler error:", error);
            toast.error(calendarConfig.toast_messages.error.update);
        }
    
}
