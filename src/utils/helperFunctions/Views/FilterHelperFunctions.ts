import { ITask, ISection, ILabel, IUser, IProject } from "@/models/model";
import { IFilterSettings, TFilter, TCondition, IFilter, TMatchFilters, IValuePropUpdatedAt, IGetBoardAppliedViewReturnBody, IFilterRuntimeContext } from "@/models/Filters/model";
import { getFromLocalStorage, setInLocalStorage } from "@/utils/helperFunctions/helperFunctions";
import { IPrioritiesConstants, IEstimateConstants } from "@/lib/constants/constants";
import { buildViewId, getActiveFiltersFromProject } from "./ViewsHelperFunctions";
import { daysSince, stalenessLevel } from "@/lib/staleness";
import { addDays, endOfDay, endOfMonth, endOfWeek, isSameDay, startOfDay, startOfMonth, startOfWeek, subDays } from "date-fns";
import {
  BuiltinViewContext,
  BuiltinViewId,
  getBuiltinView,
} from "@/lib/constants/builtinViews";


export const defaultFilterSettings: IFilterSettings = { addedFilters: [], matchFilters: "ANY" }
export const defaultManageColumnsSettings = {}


export const sizeFilterCondition = (task: ITask, value?: IEstimateConstants[]) => {
  // Check if item's priority index is 0
  let item: ITask | any = { ...task };
  const itemHasNoEstimate = task.estimate ? true : false;
  if (!itemHasNoEstimate) {
    item = { ...item, estimate: { estimate_index: 0 } }
  }

  // Check if there's a priority inside value with an index of 0
  const valueContainsZeroIndex = value?.some(estimate => estimate.estimate_index === item.estimate?.estimate_index);

  // Return true if both conditions are met, false otherwise
  return (valueContainsZeroIndex) ?? false;
}

export const unreadFilterCondition = (item: ITask, value?: any) =>
  (item.notifications && item.notifications?.length > 0 && item.notifications[0]?.seen === false) ? true : false

// All staleness filters reuse the thresholds behind the card age line, so a
// filtered board always agrees with the ages the cards show. A task nobody has
// ever commented on ages from creation, otherwise it could never read as stale.
const projectStalenessThresholds = (project?: IProject) => ({
  warnDays: project?.staleWarnDays,
  hotDays: project?.staleHotDays,
});

export const noRecentCommentFilterCondition = (
  item: ITask,
  _value?: any,
  project?: IProject,
) =>
  stalenessLevel(
    daysSince(item.lastCommentAt ?? item.createdAt),
    projectStalenessThresholds(project),
  ) !== "none";

export const stuckInColumnFilterCondition = (
  item: ITask,
  _value?: any,
  project?: IProject,
) =>
  stalenessLevel(
    daysSince(item.sectionChangedAt ?? item.createdAt),
    projectStalenessThresholds(project),
  ) !== "none";

export const runningTimerFilterCondition: TCondition = (
  item,
  _value,
  project,
  _match,
  runtimeContext,
) =>
  project?.timeTrackingEnabled === true &&
  (runtimeContext?.runningTaskIds?.has(item.id) ?? false);

export const staleOnBoardFilterCondition = (
  item: ITask,
  _value?: any,
  project?: IProject,
) =>
  stalenessLevel(
    daysSince(item.createdAt),
    projectStalenessThresholds(project),
  ) !== "none";

export const notStaleFilterCondition = (
  item: ITask,
  _value?: any,
  project?: IProject,
) =>
  stalenessLevel(
    daysSince(item.lastCommentAt ?? item.createdAt),
    projectStalenessThresholds(project),
  ) === "none" &&
  stalenessLevel(
    daysSince(item.sectionChangedAt ?? item.createdAt),
    projectStalenessThresholds(project),
  ) === "none";

export function matchDynamicDateRange(taskDate: Date, dynamicRange: string): boolean {
  const today = new Date();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  console.log("[matchDynamicDateRange] dynamicRange:", dynamicRange, "taskDate:", taskDate);

  switch (dynamicRange) {
    case "TODAY":
      const isToday = isSameDay(taskDate, today);
      console.log("[matchDynamicDateRange] TODAY:", isToday);
      return isToday;

    case "YESTERDAY":
      const yesterday = subDays(today, 1);
      const isYesterday = isSameDay(taskDate, yesterday);
      console.log("[matchDynamicDateRange] YESTERDAY:", isYesterday);
      return isYesterday;

    case "LAST_7_DAYS":
      // Rolling 7-day window (past 7 days including today)
      const sevenDaysAgo = startOfDay(subDays(today, 6));
      const inLast7Days = taskDate >= sevenDaysAgo && taskDate <= todayEnd;
      console.log("[matchDynamicDateRange] LAST_7_DAYS:", inLast7Days, "sevenDaysAgo:", sevenDaysAgo, "todayEnd:", todayEnd);
      return inLast7Days;

    case "LAST_30_DAYS":
      // Rolling 30-day window (past 30 days including today)
      const thirtyDaysAgo = startOfDay(subDays(today, 29));
      const inLast30Days = taskDate >= thirtyDaysAgo && taskDate <= todayEnd;
      console.log("[matchDynamicDateRange] LAST_30_DAYS:", inLast30Days, "thirtyDaysAgo:", thirtyDaysAgo, "todayEnd:", todayEnd);
      return inLast30Days;

    case "OVERDUE":
      return taskDate < todayStart;

    case "NEXT_7_DAYS":
      return taskDate >= todayStart && taskDate <= endOfDay(addDays(today, 6));

    case "THIS_WEEK":
      // Full current week (Monday to Sunday)
      const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(today, { weekStartsOn: 1 }); // Sunday
      const inThisWeek = taskDate >= weekStart && taskDate <= weekEnd;
      console.log("[matchDynamicDateRange] THIS_WEEK:", inThisWeek, "weekStart:", weekStart, "weekEnd:", weekEnd);
      return inThisWeek;

    case "THIS_MONTH":
      // Full current month (1st to last day of month)
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      const inThisMonth = taskDate >= monthStart && taskDate <= monthEnd;
      console.log("[matchDynamicDateRange] THIS_MONTH:", inThisMonth, "monthStart:", monthStart, "monthEnd:", monthEnd);
      return inThisMonth;

    case "ANY":
      console.log("[matchDynamicDateRange] ANY: true");
      return true; // For "ANY" condition

    default:
      console.log("[matchDynamicDateRange] DEFAULT: false");
      return false;
  }
}


export const dateFilterCondition = (
  item: ITask,
  value: [IValuePropUpdatedAt]
) => {
  const { fromDate, toDate, condition, selectedDate, dynamicRange } = value[0];

  // Check if dynamic range is specified
  if (dynamicRange) {
    const taskDate = new Date(item.updatedAt ?? item.createdAt!);
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

  // Static date logic (only runs if no dynamic range)
  const today = new Date();
  const taskDate = new Date(item.updatedAt ?? item.createdAt!);

  if (fromDate && toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    return taskDate >= from && taskDate <= to;
  } else if (selectedDate) {
    const selected = new Date(selectedDate);
    if (condition === 'BEFORE' || (condition === null && selected > today)) {
      return taskDate < selected;
    } else if (condition === 'AFTER' || (condition === null && selected <= today)) {
      return taskDate > selected;
    }
  }

  return true;
};

export const createdAtFilterCondition = (
  item: ITask,
  value: [IValuePropUpdatedAt]
) => {
  const { fromDate, toDate, condition, selectedDate, dynamicRange } = value[0];

  // Check if dynamic range is specified
  if (dynamicRange) {
    const taskDate = new Date(item.createdAt!);
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

  // Static date logic (only runs if no dynamic range)
  const today = new Date();
  const taskDate = new Date(item.createdAt!);

  if (fromDate && toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    return taskDate >= from && taskDate <= to;
  } else if (selectedDate) {
    const selected = new Date(selectedDate);
    if (condition === 'BEFORE' || (condition === null && selected > today)) {
      return taskDate < selected;
    } else if (condition === 'AFTER' || (condition === null && selected <= today)) {
      return taskDate > selected;
    }
  }

  return true;
};

export const dueDateFilterCondition = (
  item: ITask,
  value: [IValuePropUpdatedAt]
) => {
  const { fromDate, toDate, condition, selectedDate, dynamicRange } = value[0];

  if (dynamicRange === "NO_DUE_DATE") return !item.dueDate;

  // Special handling for "ANY" condition
  if (condition === "ANY") {
    return item.dueDate ? true : false;
  }

  // No due date and not checking for "ANY"
  if (!item.dueDate) return false;

  const taskDate = new Date(item.dueDate);
  // Check if dynamic range is specified
  if (dynamicRange) {
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

  // Static date logic (only runs if no dynamic range)
  const today = new Date();

  if (fromDate && toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    return taskDate >= from && taskDate <= to;
  } else if (selectedDate) {
    const selected = new Date(selectedDate);
    if (condition === 'BEFORE' || (condition === null && selected > today)) {
      return taskDate < selected;
    } else if (condition === 'AFTER' || (condition === null && selected <= today)) {
      return taskDate > selected;
    }
  }

  return true;
};

export const priorityFilterCondition = (task: ITask, value: IPrioritiesConstants[]) => {
  // Check if item's priority index is 0
  let item: ITask | any = { ...task };
  const itemHasNoPriority = task.priority ? true : false;
  if (!itemHasNoPriority) {
    item = { ...item, priority: { priority_index: 0 } }
  }

  // Check if there's a priority inside value with an index of 0
  const valueContainsZeroIndex = value?.some(priority => priority.priority_index === item.priority?.priority_index);

  // Return true if both conditions are met, false otherwise
  return (valueContainsZeroIndex) ?? false;
};

export const statusFilterCondition = (task: ITask, value: Array<{ value?: string }>) =>
  value.length === 0 || value.some((candidate) => candidate.value === task.status);

export const updatedByFilterCondition = (item: ITask, value: any[]) =>
  (value.length === 0 || value.some(v => {
    if (!("uid" in v)) {
      return item.agentId === v.id;
    }
    return item.updatedByUserIds?.includes(v.id) ?? false;
  })) ?? false;

export const createdByFilterCondition = (item: ITask, value: any[]) =>
  (value.length === 0 || value.some(v => Number(item.userId) === Number(v.id))) ?? false;

const assigneeRowMatches = (row: any, v: any) =>
  "uid" in v ? row.userId === v.id : row.agentId === v.id;

export const assigneeFilterCondition = (item: ITask, value: any[], _project?: IProject, match?: TMatchFilters) => {
  if (value.length === 0) return true;
  const assignees = item.assignees ?? [];
  if (match !== "ALL") {
    return assignees.some(row => value.some(v => assigneeRowMatches(row, v)));
  }
  // An agent assignment stores the agent's OWNER in userId as well as the agentId. Under ALL that
  // one row must not satisfy both "assigned to Valentin" and "assigned to Valentin's agent", so a
  // row with an agentId counts as the agent only — which is also what the card renders. Deciding
  // per row instead of claiming rows keeps the answer independent of assignee order.
  return value.every(v =>
    "uid" in v
      ? assignees.some(row => row.agentId == null && row.userId === v.id)
      : assignees.some(row => row.agentId === v.id)
  );
};

export const blockedByPersonFilterCondition = (
  item: ITask,
  value: Pick<IUser, "id" | "displayName" | "photoURL">[],
) =>
  item.waitingOnUserId != null &&
  value.some((v) => v.id === 0 || v.id === item.waitingOnUserId);

export const starredFilterCondition = (item: ITask, value: any[]) =>
  (value.length === 0 || (item.savedContent && item?.savedContent?.length > 0)) ?? false;


export const labelFilterCondition = (item: ITask, value: ILabel[], _project?: IProject, match?: TMatchFilters) =>
  (value.length === 0 || (match === "ALL"
    ? value.every(v => item.taskLabels?.some(tl => tl.label?.id === v.id))
    : item.taskLabels?.some(tl => value.flatMap(x => x.id).includes(tl.label?.id!)))) ?? false;

export const inInboxFilterCondition = (item: ITask, value: any[]) =>
  (item.notifications && item.notifications.length > 0) ? true : false

export const getBoardAndUserAppliedFilters = (_currentProject: IProject): IGetBoardAppliedViewReturnBody => {
  type TPossibleFilterShape = IFilterSettings | undefined
  const defaultView = _currentProject.project_view?.default_view?.board_filters as TPossibleFilterShape
  const userAppliedView = _currentProject.project_view?.user_project_views[0]?.appliedView?.board_filters as TPossibleFilterShape
  return { userAppliedView, defaultView }


}

// export const setFilterIfNoneElseReturn = (projectId:number):IFilterSettings=>{
//   let filterForThisProject = getFiltersForProject(projectId)
//   if (!filterForThisProject) setFiltersInLocalStorage(projectId,defaultFilterSettings)
//   return filterForThisProject??defaultFilterSettings
// }

// export const upserFilterBoardViewAndReturn = (project:IProject)=>{
//   let filterForThisProject = getFiltersForProject(project.id)
//   const { userAppliedView, defaultView } = getBoardAndUserAppliedFilters(project)
//   const fallbackSorting = userAppliedView??defaultView??defaultFilterSettings
//   if (!filterForThisProject) setFiltersInLocalStorage(project.id,fallbackSorting)
//   return filterForThisProject??fallbackSorting
// }

// will always get some filters and apply them to return filtered sections
export const getFilteredSections = (
  sections: ISection[],
  project: IProject,
  builtinViewId?: BuiltinViewId,
  builtinContext: BuiltinViewContext = {},
  runtimeContext?: IFilterRuntimeContext,
) => {
  const builtinView = getBuiltinView(builtinViewId);
  if (builtinView && (!builtinView.available || builtinView.available(builtinContext))) {
    return sections.map((section) => ({
      ...section,
      items: (section.items ?? []).filter((task) =>
        builtinView.predicate(task, builtinContext),
      ),
    }));
  }

  const localStorageFilters = getActiveFiltersFromProject(project)

  return applyFilters(
    sections,
    localStorageFilters.addedFilters ?? [],
    localStorageFilters.matchFilters,
    project,
    runtimeContext,
  )

}


export const defaultConditions: { [key in TFilter]?: TCondition } = {
  Labels: labelFilterCondition,
  Size: sizeFilterCondition,
  Priority: priorityFilterCondition,
  Status: statusFilterCondition,
  Inbox: inInboxFilterCondition,
  Unread: unreadFilterCondition,
  Assignees: assigneeFilterCondition,
  BlockedByPerson: blockedByPersonFilterCondition,
  UpdatedRange: dateFilterCondition,
  CreatedAt: createdAtFilterCondition,
  DueDate: dueDateFilterCondition,
  Starred: starredFilterCondition,
  UpdatedBy: updatedByFilterCondition,
  CreatedBy: createdByFilterCondition,
  NoRecentComment: noRecentCommentFilterCondition,
  StuckInColumn: stuckInColumnFilterCondition,
  RunningTimer: runningTimerFilterCondition,
  StaleOnBoard: staleOnBoardFilterCondition,
  NotStale: notStaleFilterCondition,
  // Add more default conditions here as needed
};


// export const setFilterIfNoneElseReturn = (projectId:number):IFilterSettings=>{
//   let filterForThisProject = getFiltersForProject(projectId)

//   if (!filterForThisProject) setFiltersInLocalStorage(projectId,defaultFilterSettings)
//   return filterForThisProject??defaultFilterSettings
// }

// export function getFiltersForProject(projectId:number){
//     const localStorageId=buildViewId(projectId, "Filters")
//     return getFromLocalStorage(localStorageId)

//   }


// export async function setFiltersInLocalStorage(projectId:number, value:IFilterSettings){
//     const localStorageId=buildViewId(projectId, "Filters")
//     await setInLocalStorage(localStorageId, value)
//     return getFromLocalStorage(localStorageId)

//   }


// export function resetAllFiltersInLocalStorage(projectId:number){
//     setFiltersInLocalStorage(projectId, defaultFilterSettings)
//   }


export function applyFilters(
  sections: ISection[],
  filters: IFilter[],
  overallType: TMatchFilters,
  project?: IProject,
  runtimeContext?: IFilterRuntimeContext,
): ISection[] {

 
  if (filters.length === 0) {
    // console.log("[applyFilters] No filters provided, returning original sections.");
    return sections;
  }

  // Iterate over each section
  return sections.map((section, sectionIdx) => {
    // // console.log(`[applyFilters] Processing section ${sectionIdx}:`, section);

    // Apply the filters to the items within the section
    const filteredItems = (section.items ?? []).filter((item, itemIdx) => {
      // // console.log(`[applyFilters]   Checking item ${itemIdx}:`, item);

      // Apply the overall type to all filters
      if (overallType === "ALL") {
        const result = filters.every((filter, filterIdx) => {
          // console.log(`[applyFilters]     [ALL] Filter ${filterIdx}:`, filter);

          // Check if condition is missing and apply default based on type
          if (!filter.condition) {
            const defaultCondition = defaultConditions[filter.type];
            const res = defaultCondition?.(item, filter.searchPayload, project, filter.match, runtimeContext) ?? false;
            // console.log(`[applyFilters]       Using default condition for type '${filter.type}':`, res);
            return res;
          }
          // If condition is not missing, use the provided condition
          const res = filter.condition(item, filter.searchPayload, project, filter.match, runtimeContext);
          // console.log(`[applyFilters]       Using custom condition:`, res);
          return res;
        });
        // console.log(`[applyFilters]   [ALL] Final result for item:`, result);
        return result;
      } else {
        // overallType === 'OR'
        const result = filters.some((filter, filterIdx) => {
          // console.log(`[applyFilters]     [OR] Filter ${filterIdx}:`, filter);

          // Check if condition is missing and apply default based on type
          if (!filter.condition) {
            const defaultCondition = defaultConditions[filter.type];
            // console.log("[applyFilters]  defaultCondition:", defaultCondition)
            const res = defaultCondition?.(item, filter.searchPayload, project, filter.match, runtimeContext);
            // console.log("[applyFilters]  ~ item:", item)
            // console.log(`[applyFilters]       Using default condition for type '${filter.type}':`, res);
            return res;
          }
          // If condition is not missing, use the provided condition
          const res = filter.condition(item, filter.searchPayload, project, filter.match, runtimeContext);
          // console.log(`[applyFilters]       Using custom condition:`, res);
          return res;
        });
        // console.log(`[applyFilters]   [OR] Final result for item:`, result);
        return result;
      }
    });

    // console.log(`[applyFilters] Filtered items for section ${sectionIdx}:`, filteredItems);

    // Return the modified section
    return { ...section, items: filteredItems };
  });
}


import { format } from 'date-fns'; // or your date formatting library

/**
 * Renders a formatted date range span for dynamic date options
 * @param {Object} option - The option object containing dynamic date properties
 * @param {boolean} option.isDynamic - Whether the option is dynamic
 * @param {string} option.dynamicRange - The dynamic range identifier
 * @param {Function} calculateDynamicDateRange - Function to calculate date range from identifier
 * @param {string} [className] - Optional CSS class for styling
 * @returns {JSX.Element|null} Formatted date range span or null
 */
export const renderDynamicDateRange = (option: { isDynamic: any; dynamicRange: string; }, calculateDynamicDateRange: (arg0: any) => any, className = "text-text-light-gray text-meta") => {
  if (!option?.isDynamic || !option?.dynamicRange || option.dynamicRange === "ANY") {
    return null;
  }

  // Absence is the value for this filter, so there is no calendar range to
  // render beneath its human-readable label.
  if (option.dynamicRange === "NO_DUE_DATE") {
    return null;
  }

  const range = calculateDynamicDateRange(option.dynamicRange);
  if (!range) {
    return null;
  }

  const fromStr = format(range.from, "d MMM, yyyy");
  const toStr = format(range.to, "d MMM, yyyy");

  if (option.dynamicRange === "OVERDUE") {
    return `Through ${toStr}`;
  }

  return `${fromStr}${fromStr !== toStr ? ` - ${toStr}` : ""}`
};

export const formatDateDisplay = (datePayload: any): string => {
  // Helper to format a single date
  const formatSingleDate = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return String(date);

    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // Helper to get dynamic range display text (simplified)
  const getDynamicRangeDisplay = (dynamicRange: string): string => {
    const dynamicRangeLabels: Record<string, string> = {
      TODAY: "Today",
      YESTERDAY: "Yesterday",
      LAST_7_DAYS: "Last 7 days",
      LAST_30_DAYS: "Last 30 days",
      OVERDUE: "Overdue",
      NEXT_7_DAYS: "Next 7 days",
      NO_DUE_DATE: "No due date",
      THIS_WEEK: "This week",
      THIS_MONTH: "This month",
      ANY: "Any date",
    };

    return dynamicRangeLabels[dynamicRange] || dynamicRange;
  };

  // Handle different date payload structures
  if (Array.isArray(datePayload) && datePayload.length > 0) {
    const formattedDates = datePayload.map((item) => {
      // Check for dynamic range first
      if (item.dynamicRange) {
        return getDynamicRangeDisplay(item.dynamicRange);
      }

      // Handle "ANY" condition
      if (item.condition === "ANY") {
        return "Any date";
      }

      // Date range object
      if (item.fromDate && item.toDate) {
        return `${formatSingleDate(item.fromDate)} - ${formatSingleDate(
          item.toDate
        )}`;
      }

      // Single selected date with condition
      if (item.selectedDate) {
        const dateStr = formatSingleDate(item.selectedDate);
        if (item.condition === "BEFORE") {
          return `Before ${dateStr}`;
        } else if (item.condition === "AFTER") {
          return `After ${dateStr}`;
        }
        return dateStr;
      }

      // Direct date value
      return formatSingleDate(item);
    });

    // Handle multiple dates display
    if (formattedDates.length > 3) {
      return `${formattedDates.slice(0, 3).join(", ")} +${
        formattedDates.length - 3
      } more`;
    }
    return formattedDates.join(", ");
  }

  return "Active";
};

const isIFilter = (filter: any): filter is IFilter => {
  return filter && typeof filter === "object" && "searchPayload" in filter;
};

export const sortLabels = (
  labelsFromTQ: ILabel[],
  currentlyActiveFilters: IFilter | ILabel[],
  sort: boolean
) => {
  const flatmapped = () => {
    if (isIFilter(currentlyActiveFilters)) {
      return (
        currentlyActiveFilters.searchPayload?.flatMap((x: any) => x.id) || []
      );
    }
    return currentlyActiveFilters?.flatMap((x) => x.id) || []; // Return an empty array if it's not an IFilter
  };

  const updatedLabels = labelsFromTQ?.map((item: ILabel) => {
    const hasMatchingTask = flatmapped().includes(item.id);
    item.check = hasMatchingTask;
    return item;
  });

  // Sort labels if sort is true
  if (sort) {
    updatedLabels?.sort((a, b) => {
      // Move checked items to the top
      return (b.check ? 1 : 0) - (a.check ? 1 : 0);
    });
  }

  return updatedLabels;
};

// Helper function to calculate dynamic date ranges
export const calculateDynamicDateRange = (
  dynamicRange: string
): { from: Date; to: Date } | null => {
  const now = new Date();

  switch (dynamicRange) {
    case "TODAY":
      return { from: now, to: now };
    case "YESTERDAY":
      const yesterday = subDays(now, 1);
      return { from: yesterday, to: yesterday };
    case "LAST_7_DAYS":
      return { from: subDays(now, 6), to: now };
    case "LAST_30_DAYS":
      return { from: subDays(now, 29), to: now };
    case "OVERDUE":
      const yesterdayEnd = endOfDay(subDays(now, 1));
      return { from: yesterdayEnd, to: yesterdayEnd };
    case "NEXT_7_DAYS":
      return { from: startOfDay(now), to: endOfDay(addDays(now, 6)) };
    case "NO_DUE_DATE":
      return null;
    case "THIS_WEEK":
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      return { from: weekStart, to: now };
    case "THIS_MONTH":
      const monthStart = startOfMonth(now);
      return { from: monthStart, to: now };
    default:
      return null;
  }
};

// Format date range helper
export const formatDateRange = (fromDate: Date, toDate: Date): string => {
  // const formatDate = (date: Date) => format(date, "do MMM, yyyy");

  // if (fromDate.toDateString() === toDate.toDateString()) {
  //   return formatDate(fromDate);
  // }

  // return `${formatDate(fromDate)} - ${formatDate(toDate)}`;
  return "";
};
