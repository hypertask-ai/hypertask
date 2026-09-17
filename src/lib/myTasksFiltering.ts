import type { ISection } from "@/models/model";
import { addDays, endOfDay, endOfWeek, startOfDay, startOfWeek } from "date-fns";
import {
  addDaysInTimeZone,
  endOfDayInTimeZone,
  myTasksDayBounds,
} from "@/lib/myTasksTimeZone";
import type { IPrioritiesConstants } from "@/lib/constants/constants";
import { compareMyTasksByDueDate } from "@/lib/myTasksGrouping";
import { countMyTasksOverdue } from "@/lib/myTasksGrouping";
import type { IProject, ITask } from "@/models/model";
import {
  hasMigratableFlatFilters,
  migrateFlatFiltersToFilterSettings,
} from "@/lib/filterSettingsMutations";
import {
  parseMyTasksViewConfig,
  type MyTasksDateRange,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";
import { isMyTasksSnoozed } from "@/lib/myTasksSnooze";
import {
  defaultConditions,
  priorityFilterCondition,
} from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import type {
  IFilterRuntimeContext,
  TMatchFilters,
} from "@/models/Filters/model";

export type MyTasksTask = ITask & {
  myTasksSection?: {
    id: number;
    isDone: boolean | null;
  } | null;
};

export type ApplyMyTasksViewOptions = {
  /** When false, ignore filterSettings (flag off). Default true. */
  applyFilterSettings?: boolean;
  runtimeContext?: IFilterRuntimeContext;
  /** IANA zone for calendar-day filters. Omit to use the process local day. */
  timeZone?: string;
};

const taskTime = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const rangeBoundary = (value: string, end: boolean): number | null => {
  const isDateOnly = dateOnly.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00` : value);
  const time = (end && isDateOnly ? endOfDay(date) : date).getTime();
  return Number.isFinite(time) ? time : null;
};

const matchesRange = (
  value: Date | string | null | undefined,
  range: MyTasksDateRange | null,
): boolean => {
  if (!range) return true;
  const time = taskTime(value);
  const from = rangeBoundary(range.from, false);
  const to = rangeBoundary(range.to, true);
  return time !== null && from !== null && to !== null && time >= from && time <= to;
};

const matchesDueDate = (
  task: MyTasksTask,
  dueDate: MyTasksViewConfig["filters"]["dueDate"],
  now: Date,
  timeZone?: string,
): boolean => {
  if (!dueDate) return true;
  if (typeof dueDate === "object") return matchesRange(task.dueDate, dueDate);
  if (dueDate === "no_due_date") return !task.dueDate;

  const dueTime = taskTime(task.dueDate);
  if (dueTime === null) return false;
  if (timeZone) {
    const { todayStart, todayEnd, weekStart, weekEnd } = myTasksDayBounds(
      now,
      timeZone,
    );
    if (dueDate === "overdue") return dueTime < todayStart.getTime();
    if (dueDate === "today") {
      return dueTime >= todayStart.getTime() && dueTime <= todayEnd.getTime();
    }
    if (dueDate === "this_week") {
      return dueTime >= weekStart.getTime() && dueTime <= weekEnd.getTime();
    }
    return (
      dueTime >= todayStart.getTime() &&
      dueTime <=
        endOfDayInTimeZone(
          addDaysInTimeZone(todayStart, 6, timeZone),
          timeZone,
        ).getTime()
    );
  }
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (dueDate === "overdue") return dueTime < todayStart.getTime();
  if (dueDate === "today") {
    return dueTime >= todayStart.getTime() && dueTime <= todayEnd.getTime();
  }
  if (dueDate === "this_week") {
    return (
      dueTime >= startOfWeek(now, { weekStartsOn: 1 }).getTime() &&
      dueTime <= endOfWeek(now, { weekStartsOn: 1 }).getTime()
    );
  }
  return (
    dueTime >= todayStart.getTime() &&
    dueTime <= endOfDay(addDays(todayStart, 6)).getTime()
  );
};

const compareOptional = (
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
};

export const myTasksSortComparator = (
  config: MyTasksViewConfig,
  now: Date = new Date(),
): ((a: MyTasksTask, b: MyTasksTask) => number) => {
  const { direction, field } = config.sort;
  const dueDateAscending = compareMyTasksByDueDate(now.getTime());

  return (a, b) => {
    let result = 0;
    if (field === "dueDate") {
      if (direction === "asc") return dueDateAscending(a, b);
      result = compareOptional(taskTime(a.dueDate), taskTime(b.dueDate), direction);
    } else if (field === "priority") {
      result = compareOptional(
        a.priority?.priority_index ?? null,
        b.priority?.priority_index ?? null,
        direction === "asc" ? "desc" : "asc",
      );
    } else if (field === "createdAt") {
      result = compareOptional(taskTime(a.createdAt), taskTime(b.createdAt), direction);
    } else if (field === "updatedAt") {
      result = compareOptional(
        taskTime(a.updatedAt ?? a.createdAt),
        taskTime(b.updatedAt ?? b.createdAt),
        direction,
      );
    } else if (field === "title") {
      result = a.title.localeCompare(b.title) * (direction === "asc" ? 1 : -1);
    } else {
      const boardA = a.project?.title ?? "";
      const boardB = b.project?.title ?? "";
      result = boardA.localeCompare(boardB) * (direction === "asc" ? 1 : -1);
      if (result === 0) result = dueDateAscending(a, b);
    }
    return result || a.id - b.id;
  };
};

const projectForTask = (task: MyTasksTask): IProject | undefined => {
  const project = task.project as IProject | undefined;
  return project?.id ? project : undefined;
};

const matchesFilterSettings = (
  task: MyTasksTask,
  config: MyTasksViewConfig,
  runtimeContext?: IFilterRuntimeContext,
): boolean => {
  const settings = config.filterSettings;
  if (!settings?.addedFilters?.length) return true;
  const overall: TMatchFilters =
    settings.matchFilters === "ALL" ? "ALL" : "ANY";
  const project = projectForTask(task);
  const run = (
    type: (typeof settings.addedFilters)[number]["type"],
    searchPayload: unknown[],
    match?: TMatchFilters,
  ) => {
    const condition = defaultConditions[type];
    return (
      condition?.(task, searchPayload, project, match, runtimeContext) ?? false
    );
  };
  if (overall === "ALL") {
    return settings.addedFilters.every((filter) =>
      run(filter.type, filter.searchPayload, filter.match),
    );
  }
  return settings.addedFilters.some((filter) =>
    run(filter.type, filter.searchPayload, filter.match),
  );
};

const matchesFlatTaskFilters = (
  task: MyTasksTask,
  filters: MyTasksViewConfig["filters"],
  now: Date,
  timeZone?: string,
): boolean => {
  const priorityIds = new Set(filters.priorityIds);
  const labelIds = new Set(filters.labelIds.map(String));
  const sizeIds = new Set(filters.sizeIds);

  const priorityId = task.priority?.priority_index ?? 0;
  if (priorityIds.size > 0 && !priorityIds.has(priorityId)) return false;
  const sizeId = task.estimate?.estimate_index ?? 0;
  if (sizeIds.size > 0 && !sizeIds.has(sizeId)) return false;
  if (
    labelIds.size > 0 &&
    !task.taskLabels?.some((taskLabel) =>
      taskLabel.label?.id ? labelIds.has(String(taskLabel.label.id)) : false,
    )
  ) {
    return false;
  }
  const starred = Boolean(task.savedContent?.length);
  if (filters.starred !== null && starred !== filters.starred) return false;
  if (timeZone) {
    if (!matchesDueDate(task, filters.dueDate, now, timeZone)) return false;
  } else
  if (!matchesDueDate(task, filters.dueDate, now)) return false;
  if (!matchesRange(task.createdAt, filters.createdRange)) return false;
  if (!matchesRange(task.updatedAt ?? task.createdAt, filters.updatedRange)) {
    return false;
  }
  return true;
};

/** Pure, board-agnostic filtering and sorting for saved My Tasks views. */
export function applyMyTasksView(
  tasks: MyTasksTask[],
  rawConfig: MyTasksViewConfig,
  now: Date = new Date(),
  options: ApplyMyTasksViewOptions = {},
): MyTasksTask[] {
  const parsed = parseMyTasksViewConfig(rawConfig);
  // Explicit `true` (My Tasks filter-parity flag) migrates flat → filterSettings for
  // evaluation. Default/undefined keeps legacy flat filtering when settings are empty.
  const config =
    options.applyFilterSettings === true &&
    hasMigratableFlatFilters(parsed.filters)
      ? migrateFlatFiltersToFilterSettings(parsed)
      : parsed;
  const { filters } = config;
  const boardIds = config.boardIds ? new Set(config.boardIds) : null;
  const sectionIds = new Set(filters.sectionIds);
  const useFilterSettings =
    options.applyFilterSettings !== false &&
    Boolean(config.filterSettings?.addedFilters?.length);

  return tasks
    .filter((task) => {
      if (boardIds && !boardIds.has(task.projectId)) return false;
      const nestedSection = task.section as unknown as
        | { id?: number; isDone?: boolean | null }
        | undefined;
      const hasNestedSection =
        typeof nestedSection === "object" && nestedSection !== null;
      const isDone =
        task.myTasksSection?.isDone ??
        (hasNestedSection ? nestedSection.isDone : null);
      const sectionId =
        task.sectionId ??
        task.myTasksSection?.id ??
        (hasNestedSection ? nestedSection.id : undefined);
      if (!filters.showDone && isDone === true) return false;
      if (
        !filters.showSnoozed &&
        isMyTasksSnoozed(task.currentUserSnoozeUntil, now)
      ) {
        return false;
      }
      if (sectionIds.size > 0 && (!sectionId || !sectionIds.has(sectionId))) {
        return false;
      }

      // Boards/columns/showDone always apply. Kanban-parity filterSettings replace
      // the overlapping flat fields when present so both UIs do not double-AND.
      // starred:false stays flat (Kanban Starred cannot express it).
      if (useFilterSettings) {
        if (filters.starred === false && Boolean(task.savedContent?.length)) {
          return false;
        }
        return matchesFilterSettings(task, config, options.runtimeContext);
      }
      if (options.timeZone) {
        return matchesFlatTaskFilters(task, filters, now, options.timeZone);
      }
      return matchesFlatTaskFilters(task, filters, now);
    })
    .sort(myTasksSortComparator(config, now));
}

/** Overdue rows that remain after a saved (or dirty) My Tasks view's filters. */
export function overdueCountForMyTasksTasks(
  tasks: MyTasksTask[],
  rawConfig: MyTasksViewConfig,
  now: Date = new Date(),
  options: ApplyMyTasksViewOptions = {},
): number {
  return countMyTasksOverdue(
    applyMyTasksView(tasks, rawConfig, now, options),
    now,
    options.timeZone,
  );
}

export function overdueCountForMyTasksView(
  sections: ISection[],
  rawConfig: MyTasksViewConfig,
  now: Date = new Date(),
  options: ApplyMyTasksViewOptions = {},
): number {
  return overdueCountForMyTasksTasks(
    sections.flatMap((section) => section.items as MyTasksTask[]),
    rawConfig,
    now,
    options,
  );
}

export function sortMyTasksViewSections(
  sections: ISection[],
  config: MyTasksViewConfig,
  now: Date = new Date(),
): ISection[] {
  if (config.sort.field !== "board" && config.sort.field !== "dueDate") {
    return sections;
  }
  const direction = config.sort.direction === "asc" ? 1 : -1;
  const taskComparator = myTasksSortComparator(config, now);

  return [...sections].sort((a, b) => {
    if (config.sort.field === "board") {
      return direction * a.section_title.localeCompare(b.section_title);
    }
    const firstA = a.items[0] as MyTasksTask | undefined;
    const firstB = b.items[0] as MyTasksTask | undefined;
    if (!firstA && !firstB) return a.section_title.localeCompare(b.section_title);
    if (!firstA) return 1;
    if (!firstB) return -1;
    return (
      taskComparator(firstA, firstB) ||
      a.section_title.localeCompare(b.section_title)
    );
  });
}

/**
 * Pure, board-agnostic filtering for the My Tasks page (HTPR-6312).
 *
 * My Tasks spans every board, so it cannot reuse the project-scoped filter
 * system (FilterHTC/useFilters bail out without a current project and persist
 * to one board's saved view). This keeps its own selection in component state
 * only and reuses the shared per-type condition functions here. An empty
 * selection means "no filter".
 */
export function filterMyTasksByPriority(
  sections: ISection[],
  selected: IPrioritiesConstants[],
): ISection[] {
  if (selected.length === 0) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => priorityFilterCondition(item, selected)),
  }));
}
