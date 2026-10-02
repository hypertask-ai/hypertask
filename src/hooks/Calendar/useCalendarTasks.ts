import { CalendarLabelSummary, CalendarUserSummary } from "@/lib/calendarSync/contract";
import { useCallback, useMemo } from "react";
import { ITask } from "@/models/model";
import { buildSortComparator } from "@/utils/helperFunctions/helperFunctions";
import {
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getWeekStartIndex,
  startOfWeek,
} from "@/utils/helperFunctions/calendar.functions";
import type { CalendarState, CalendarFiltersState } from "./useCalendarView";
import { buildCalendarTaskFilterSets } from "./calendarTaskFilters";

export function useCalendarTasks({
  currentDate,
  currentView,
  calendarSettings,
  allData,
  projects,
  checkedProjects,
  taskFilters,
  calendarSort,
  calendarViews,
  taskMatchesFilters,
  taskFilterSets,
}: Pick<
  CalendarState,
  "currentDate"
  | "currentView"
  | "calendarSettings"
  | "allData"
  | "projects"
  | "checkedProjects"
  | "taskFilters"
  | "calendarSort"
  | "calendarViews"
> & Pick<
  CalendarFiltersState,
  "taskMatchesFilters"
  | "taskFilterSets"
>) {
  const filteredMembers: CalendarUserSummary[] = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const projectsToUse = hasSelectedProjects
      ? projects.filter((p) => checkedProjects[p.id] === true)
      : projects;
    const byId = new Map<number, CalendarUserSummary>();
    for (const project of projectsToUse) {
      for (const member of project.members ?? []) {
        const user = member?.user;
        if (user?.id != null && !byId.has(user.id)) {
          byId.set(user.id, user);
        }
      }
    }
    return Array.from(byId.values());
  }, [checkedProjects, projects]);

  const allTags: CalendarLabelSummary[] = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const projectsToUse = hasSelectedProjects
      ? projects.filter((p) => checkedProjects[p.id] === true)
      : projects;
    return projectsToUse.flatMap((project) => project.labels);
  }, [checkedProjects, projects]);

  const tasks = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);

    const projectFilteredTasks: ITask[] = hasSelectedProjects
      ? allData.filter(
        (task) =>
          task.projectId != null && checkedProjects[task.projectId] === true
      )
      : [...allData];

    const hasActiveTaskFilters = Object.values(taskFilters).some(Boolean);
    if (hasActiveTaskFilters) {
      return projectFilteredTasks.filter((task) =>
        taskMatchesFilters(task, taskFilters, taskFilterSets)
      );
    }

    return projectFilteredTasks;
  }, [allData, checkedProjects, taskFilters, taskFilterSets, taskMatchesFilters]);

  const calendarSortComparator = useMemo(
    () =>
      calendarSort
        ? buildSortComparator([calendarSort])
        : null,
    [calendarSort],
  );

  const tasksByDate = useMemo(() => {
    const map = new Map<string, ITask[]>();
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const hasActiveTaskFilters = Object.values(taskFilters).some(Boolean);

    const addTaskToMap = (task: ITask) => {
      if (!task.dueDate) return;

      if (hasActiveTaskFilters) {
        if (!taskMatchesFilters(task, taskFilters, taskFilterSets)) {
          return;
        }
      }

      const taskDate = new Date(task.dueDate);
      const dateKey = `${taskDate.getFullYear()}-${taskDate.getMonth()}-${taskDate.getDate()}`;
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(task);
    };

    const tasksToProcess = hasSelectedProjects
      ? allData.filter(
        (task) =>
          task.projectId != null && checkedProjects[task.projectId] === true
      )
      : allData;

    tasksToProcess.forEach(addTaskToMap);
    if (calendarSortComparator) {
      map.forEach((dayTasks) => dayTasks.sort(calendarSortComparator));
    }
    return map;
  }, [allData, calendarSortComparator, checkedProjects, taskFilters, taskFilterSets, taskMatchesFilters]);

  const { weeks } = useMemo(() => {
    const monthStart = getFirstDayOfMonth(currentDate);
    const monthEnd = getLastDayOfMonth(currentDate);
    const startDay = getWeekStartIndex(
      monthStart,
      calendarSettings.weekStartsOn
    );
    const endDay = getWeekStartIndex(monthEnd, calendarSettings.weekStartsOn);

    const daysArray: Date[] = [];
    const weeksArray = [];

    if (currentView === "month") {
      // Add days from previous month
      for (let i = startDay - 1; i >= 0; i--) {
        const date = new Date(monthStart);
        date.setDate(date.getDate() - (i + 1));
        daysArray.push(date);
      }
      // Add days of current month
      for (let i = 1; i <= monthEnd.getDate(); i++) {
        daysArray.push(
          new Date(currentDate.getFullYear(), currentDate.getMonth(), i)
        );
      }
      // Add days from next month
      for (let i = 1; i < 7 - endDay; i++) {
        daysArray.push(
          new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i)
        );
      }

      // Group days into weeks

      for (let i = 0; i < daysArray.length; i += 7) {
        weeksArray.push(daysArray.slice(i, i + 7));
      }
    } else if (currentView === "day") {
      weeksArray.push([
        new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          currentDate.getDate()
        ),
      ]);
    } else {
      const weekStart = startOfWeek(
        currentDate,
        calendarSettings.weekStartsOn
      );
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        if (
          currentView !== "week" ||
          calendarSettings.showWeekends ||
          (date.getDay() !== 0 && date.getDay() !== 6)
        ) {
          daysArray.push(date);
        }
      }
      weeksArray.push(daysArray);
    }

    return { weeks: weeksArray };
  }, [currentDate, currentView, calendarSettings]);

  const { calendarViewCounts, visibleTaskCount } = useMemo(() => {
    const visibleDateKeys = new Set(
      weeks.flat().map(
        (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      ),
    );
    const visibleTasks = allData.filter((task) => {
      if (!task.dueDate) return false;
      const date = new Date(task.dueDate);
      return visibleDateKeys.has(
        `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      );
    });
    const counts = new Map<string, number>();

    for (const view of calendarViews) {
      const selectedProjects = new Set(view.checkedProjects);
      const filterSets = buildCalendarTaskFilterSets(view.taskFilters);
      const hasSelectedProjects = selectedProjects.size > 0;
      counts.set(
        view.id,
        visibleTasks.filter(
          (task) =>
            (!hasSelectedProjects ||
              (task.projectId != null &&
                selectedProjects.has(task.projectId))) &&
            taskMatchesFilters(task, view.taskFilters, filterSets),
        ).length,
      );
    }

    return {
      calendarViewCounts: counts,
      visibleTaskCount: visibleTasks.length,
    };
  }, [
    allData,
    calendarViews,
    taskMatchesFilters,
    weeks,
  ]);

  const getTasksForDate = useCallback((date: Date) => {
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return tasksByDate.get(dateKey) || [];
  }, [tasksByDate]);

  return {
    filteredMembers,
    allTags,
    tasks,
    tasksByDate,
    weeks,
    calendarViewCounts,
    visibleTaskCount,
    getTasksForDate,
  };
}

export type CalendarTasksState = ReturnType<typeof useCalendarTasks>;

