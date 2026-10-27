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
  let item: ITask | any = { ...task };
  const itemHasNoEstimate = task.estimate ? true : false;
  if (!itemHasNoEstimate) {
    item = { ...item, estimate: { estimate_index: 0 } }
  }

  const valueContainsZeroIndex = value?.some(estimate => estimate.estimate_index === item.estimate?.estimate_index);

  return (valueContainsZeroIndex) ?? false;
}

export const unreadFilterCondition = (item: ITask, value?: any) =>
  (item.notifications && item.notifications?.length > 0 && item.notifications[0]?.seen === false) ? true : false

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
      const sevenDaysAgo = startOfDay(subDays(today, 6));
      const inLast7Days = taskDate >= sevenDaysAgo && taskDate <= todayEnd;
      console.log("[matchDynamicDateRange] LAST_7_DAYS:", inLast7Days, "sevenDaysAgo:", sevenDaysAgo, "todayEnd:", todayEnd);
      return inLast7Days;

    case "LAST_30_DAYS":
      const thirtyDaysAgo = startOfDay(subDays(today, 29));
      const inLast30Days = taskDate >= thirtyDaysAgo && taskDate <= todayEnd;
      console.log("[matchDynamicDateRange] LAST_30_DAYS:", inLast30Days, "thirtyDaysAgo:", thirtyDaysAgo, "todayEnd:", todayEnd);
      return inLast30Days;

    case "OVERDUE":
      return taskDate < todayStart;

    case "NEXT_7_DAYS":
      return taskDate >= todayStart && taskDate <= endOfDay(addDays(today, 6));

    case "THIS_WEEK":
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
      const inThisWeek = taskDate >= weekStart && taskDate <= weekEnd;
      console.log("[matchDynamicDateRange] THIS_WEEK:", inThisWeek, "weekStart:", weekStart, "weekEnd:", weekEnd);
      return inThisWeek;

    case "THIS_MONTH":
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      const inThisMonth = taskDate >= monthStart && taskDate <= monthEnd;
      console.log("[matchDynamicDateRange] THIS_MONTH:", inThisMonth, "monthStart:", monthStart, "monthEnd:", monthEnd);
      return inThisMonth;

    case "ANY":
      console.log("[matchDynamicDateRange] ANY: true");
      return true;

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

  if (dynamicRange) {
    const taskDate = new Date(item.updatedAt ?? item.createdAt!);
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

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

  if (dynamicRange) {
    const taskDate = new Date(item.createdAt!);
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

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

  if (condition === "ANY") {
    return item.dueDate ? true : false;
  }

  if (!item.dueDate) return false;

  const taskDate = new Date(item.dueDate);
  if (dynamicRange) {
    return matchDynamicDateRange(taskDate, dynamicRange);
  }

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
  let item: ITask | any = { ...task };
  const itemHasNoPriority = task.priority ? true : false;
  if (!itemHasNoPriority) {
    item = { ...item, priority: { priority_index: 0 } }
  }

  const valueContainsZeroIndex = value?.some(priority => priority.priority_index === item.priority?.priority_index);

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

const assigneeRowMatches = (row: any, v: any, legacyAgentAssigneeMatch?: boolean) =>
  "uid" in v
    ? (legacyAgentAssigneeMatch === true || row.agentId == null) && row.userId === v.id
    : row.agentId === v.id;

export const assigneeFilterCondition: TCondition = (item, value: any[], _project, match, runtimeContext) => {
  if (value.length === 0) return true;
  const assignees = item.assignees ?? [];
  if (match !== "ALL") {
    return assignees.some(row => value.some(v => assigneeRowMatches(row, v, runtimeContext?.legacyAgentAssigneeMatch)));
  }
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

export const getFilteredSections = (
  sections: ISection[],
  project: IProject,
  builtinViewId?: BuiltinViewId,
  builtinContext: BuiltinViewContext = {},
  runtimeContext?: IFilterRuntimeContext,
) => {
  const builtinView = getBuiltinView(builtinViewId);
  if (builtinView && (!builtinView.available || builtinView.available(builtinContext))) {
    const builtinSections = (builtinView.sectionPredicate
      ? sections.filter((section) =>
          builtinView.sectionPredicate!(section.section_title, builtinContext),
        )
      : sections
    ).map((section) => ({
      ...section,
      items: (section.items ?? []).filter((task) =>
        builtinView.predicate(task, builtinContext),
      ),
    }));
    return builtinView.hideEmptySections
      ? builtinSections.filter((section) => section.items.length > 0)
      : builtinSections;
  }

  const localStorageFilters = getActiveFiltersFromProject(project, runtimeContext)

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
};

export function applyFilters(
  sections: ISection[],
  filters: IFilter[],
  overallType: TMatchFilters,
  project?: IProject,
  runtimeContext?: IFilterRuntimeContext,
): ISection[] {

 
  if (filters.length === 0) {
    return sections;
  }

  return sections.map((section, sectionIdx) => {
    const filteredItems = (section.items ?? []).filter((item, itemIdx) => {
      if (overallType === "ALL") {
        const result = filters.every((filter, filterIdx) => {
          if (!filter.condition) {
            const defaultCondition = defaultConditions[filter.type];
            const res = defaultCondition?.(item, filter.searchPayload, project, filter.match, runtimeContext) ?? false;
            return res;
          }
          const res = filter.condition(item, filter.searchPayload, project, filter.match, runtimeContext);
          return res;
        });
        return result;
      } else {
        const result = filters.some((filter, filterIdx) => {
          if (!filter.condition) {
            const defaultCondition = defaultConditions[filter.type];
            const res = defaultCondition?.(item, filter.searchPayload, project, filter.match, runtimeContext);
            return res;
          }
          const res = filter.condition(item, filter.searchPayload, project, filter.match, runtimeContext);
          return res;
        });
        return result;
      }
    });


    return { ...section, items: filteredItems };
  });
}


import { format } from 'date-fns';

export const renderDynamicDateRange = (option: { isDynamic: any; dynamicRange: string; }, calculateDynamicDateRange: (arg0: any) => any, className = "text-text-light-gray text-meta") => {
  if (!option?.isDynamic || !option?.dynamicRange || option.dynamicRange === "ANY") {
    return null;
  }

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
  const formatSingleDate = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return String(date);

    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

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

  if (Array.isArray(datePayload) && datePayload.length > 0) {
    const formattedDates = datePayload.map((item) => {
      if (item.dynamicRange) {
        return getDynamicRangeDisplay(item.dynamicRange);
      }

      if (item.condition === "ANY") {
        return "Any date";
      }

      if (item.fromDate && item.toDate) {
        return `${formatSingleDate(item.fromDate)} - ${formatSingleDate(
          item.toDate
        )}`;
      }

      if (item.selectedDate) {
        const dateStr = formatSingleDate(item.selectedDate);
        if (item.condition === "BEFORE") {
          return `Before ${dateStr}`;
        } else if (item.condition === "AFTER") {
          return `After ${dateStr}`;
        }
        return dateStr;
      }

      return formatSingleDate(item);
    });

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
    return currentlyActiveFilters?.flatMap((x) => x.id) || [];
  };

  const updatedLabels = labelsFromTQ?.map((item: ILabel) => {
    const hasMatchingTask = flatmapped().includes(item.id);
    item.check = hasMatchingTask;
    return item;
  });

  if (sort) {
    updatedLabels?.sort((a, b) => {
      return (b.check ? 1 : 0) - (a.check ? 1 : 0);
    });
  }

  return updatedLabels;
};

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
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      return { from: weekStart, to: now };
    case "THIS_MONTH":
      const monthStart = startOfMonth(now);
      return { from: monthStart, to: now };
    default:
      return null;
  }
};

export const formatDateRange = (fromDate: Date, toDate: Date): string => {
  return "";
};
