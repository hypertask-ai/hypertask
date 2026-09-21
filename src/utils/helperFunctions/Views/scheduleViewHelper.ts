import { ITask } from "@/models/model";

// Due date grouping utility functions
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
  
    // Parse dueDate - handle both Date objects and strings
    const dueDate =
      task.dueDate instanceof Date
        ? new Date(task.dueDate)
        : new Date(task.dueDate);
  
    // Create date-only version in local timezone
    const dueDateOnly = new Date(
      dueDate.getFullYear(),
      dueDate.getMonth(),
      dueDate.getDate()
    );
    dueDateOnly.setHours(0, 0, 0, 0);
  
    // Helper to check if two dates are the same day
    const isSameDay = (date1: Date, date2: Date) => {
      return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
      );
    };
  
    // Overdue: due date-time is before the present moment (now)
    if (dueDate.getTime() < now.getTime()) {
      return "Overdue";
    }
  
    // Today: due date is today
    if (isSameDay(dueDate, today)) {
      return "Today";
    }
  
    // Tomorrow: due date is tomorrow
    if (isSameDay(dueDate, tomorrow)) {
      return "Tomorrow";
    }
  
    // Calculate start of current week (Monday)
    const currentWeekStart = new Date(today);
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days to Monday
    currentWeekStart.setDate(today.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);
  
    // Calculate end of current week (Sunday)
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    currentWeekEnd.setHours(23, 59, 59, 999);
  
    // This Week: due date is within the current week (but not today or tomorrow)
    // Use dueDateOnly for comparison to avoid time component issues
    if (
      dueDateOnly.getTime() >= currentWeekStart.getTime() &&
      dueDateOnly.getTime() <= currentWeekEnd.getTime()
    ) {
      return "This Week";
    }
  
    // Later: due date is after this week
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
  
    // Group tasks by due date
    tasks.forEach((task) => {
      const group = getDueDateGroup(task);
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(task);
    });
  
    // Debug: log group counts
    console.log("Group counts:", {
      Overdue: groups.Overdue.length,
      Today: groups.Today.length,
      Tomorrow: groups.Tomorrow.length,
      "This Week": groups["This Week"].length,
      Later: groups.Later.length,
    });
  
    // Sort tasks within each category by due date
    // Overdue: descending (most recent overdue first)
    // Others: ascending (earliest due date first)
    const sortByDueDate = (a: ITask, b: ITask, isOverdue: boolean = false) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      const timeDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      return isOverdue ? -timeDiff : timeDiff; // Reverse for overdue (descending)
    };
  
    // Sort each category
    Object.keys(groups).forEach((key) => {
      const isOverdue = key === "Overdue";
      groups[key].sort((a, b) => sortByDueDate(a, b, isOverdue));
    });
  
    // Create grouped structure with startIndex
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
  
  // Helper to get flat array of all tasks for navigation
  export const getAllTasksFlat = (groupedTasks: GroupedTasks): ITask[] => {
    const allTasks: ITask[] = [];
    Object.values(groupedTasks).forEach((group) => {
      allTasks.push(...group.tasks);
    });
    return allTasks;
  };
  