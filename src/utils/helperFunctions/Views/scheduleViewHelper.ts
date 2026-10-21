import { ITask } from "@/models/model";

const getDueDateGroup = (task: ITask): string => {
    if (!task.dueDate) {
      return "Later";
    }
  
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);
  
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
  
    const dueDate =
      task.dueDate instanceof Date
        ? new Date(task.dueDate)
        : new Date(task.dueDate);
  
    const dueDateOnly = new Date(
      dueDate.getFullYear(),
      dueDate.getMonth(),
      dueDate.getDate()
    );
    dueDateOnly.setHours(0, 0, 0, 0);
  
    const isSameDay = (date1: Date, date2: Date) => {
      return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
      );
    };
  
    if (dueDate.getTime() < now.getTime()) {
      return "Overdue";
    }
  
    if (isSameDay(dueDate, today)) {
      return "Today";
    }
  
    if (isSameDay(dueDate, tomorrow)) {
      return "Tomorrow";
    }
  
    const currentWeekStart = new Date(today);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    currentWeekStart.setDate(today.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);
  
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    currentWeekEnd.setHours(23, 59, 59, 999);
  
    if (
      dueDateOnly.getTime() >= currentWeekStart.getTime() &&
      dueDateOnly.getTime() <= currentWeekEnd.getTime()
    ) {
      return "This Week";
    }
  
    return "Later";
  };
  
  const getDueDateGroupLabel = (group: string): string => {
    const labels: Record<string, string> = {
      Overdue: "Overdue",
      Today: "Today",
      Tomorrow: "Tomorrow",
      "This Week": "This Week",
      Later: "Later",
    };
  
    return labels[group] || group;
  };
  
  export interface GroupedTasks {
    [key: string]: {
      label: string;
      tasks: ITask[];
      startIndex: number;
    };
  }
  
  export const groupTasksByDueDate = (tasks: ITask[]): GroupedTasks => {
    const groups: Record<string, ITask[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      "This Week": [],
      Later: [],
    };
  
    tasks.forEach((task) => {
      const group = getDueDateGroup(task);
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(task);
    });
  
    console.log("Group counts:", {
      Overdue: groups.Overdue.length,
      Today: groups.Today.length,
      Tomorrow: groups.Tomorrow.length,
      "This Week": groups["This Week"].length,
      Later: groups.Later.length,
    });
  
    const sortByDueDate = (a: ITask, b: ITask, isOverdue: boolean = false) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      const timeDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      return isOverdue ? -timeDiff : timeDiff;
    };
  
    Object.keys(groups).forEach((key) => {
      const isOverdue = key === "Overdue";
      groups[key].sort((a, b) => sortByDueDate(a, b, isOverdue));
    });
  
    const groupedTasks: GroupedTasks = {};
    const categoryOrder = ["Overdue", "Today", "Tomorrow", "This Week", "Later"];
    let currentIndex = 0;
  
    categoryOrder.forEach((category) => {
      if (groups[category] && groups[category].length > 0) {
        groupedTasks[category] = {
          label: getDueDateGroupLabel(category),
          tasks: groups[category],
          startIndex: currentIndex,
        };
        currentIndex += groups[category].length;
      }
    });
  
    return groupedTasks;
  };
  
  export const getAllTasksFlat = (groupedTasks: GroupedTasks): ITask[] => {
    const allTasks: ITask[] = [];
    Object.values(groupedTasks).forEach((group) => {
      allTasks.push(...group.tasks);
    });
    return allTasks;
  };
  