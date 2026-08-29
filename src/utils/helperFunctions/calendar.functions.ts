import { ITask } from "@/models/model";

export const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const subtractMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
};

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const subtractDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

type WeekStartsOn = "monday" | "sunday";

export const getWeekStartIndex = (
  date: Date,
  weekStartsOn: WeekStartsOn = "monday"
) => (weekStartsOn === "monday" ? (date.getDay() + 6) % 7 : date.getDay());

// Kept for callers that explicitly need a Monday-first index.
export const getMondayIndex = (date: Date) => getWeekStartIndex(date);

export const startOfWeek = (
  date: Date,
  weekStartsOn: WeekStartsOn = "monday"
) => {
  const result = new Date(date);
  const diff = result.getDate() - getWeekStartIndex(result, weekStartsOn);
  result.setDate(diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

export const getFirstDayOfMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

export const getLastDayOfMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
};

export const isTaskCreatedByMe = (task: ITask, userId: number): boolean => {
  return String(task.userId) === String(userId);
}

export const isTaskAssignedToMe = (task: ITask, userId: number): boolean => {
  if (!task.assignees) return false;
  return task.assignees.some((assignee) => assignee.userId === userId);
}

export const isTaskFollowing = (task: ITask, userId: number): boolean => {
  if (!task.followers) return false;
  return task.followers.some((follower) => follower.userId === userId);
}

export const isTaskArchived = (task: ITask): boolean => {
  return task.archivedAt !== null && task.archivedAt !== undefined || task.status === "Archive";
}

export const isTaskOverdue = (task: ITask): boolean => {
  if (!task.dueDate) return false;
  const dueDate = new Date(task.dueDate);
  const now = new Date();
  return dueDate.getTime() < now.getTime();
}

export const isTaskPending = (task: ITask): boolean => {
  if (!task.dueDate) return false;
  const dueDate = new Date(task.dueDate);
  const now = new Date();
  return dueDate.getTime() >= now.getTime();
}

export const isSameDate = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};
