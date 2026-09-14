import { addDays, endOfDay, endOfWeek, startOfDay, startOfWeek } from "date-fns";
import type { IPrioritiesConstants } from "@/lib/constants/constants";
import { compareMyTasksByDueDate } from "@/lib/myTasksGrouping";
import type { ISection, ITask } from "@/models/model";
import {
  parseMyTasksViewConfig,
  type MyTasksDateRange,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";
import { priorityFilterCondition } from "@/utils/helperFunctions/Views/FilterHelperFunctions";

export type MyTasksTask = ITask & {
  myTasksSection?: {
    id: number;
    isDone: boolean | null;
  } | null;
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
): boolean => {
  if (!dueDate) return true;
  if (typeof dueDate === "object") return matchesRange(task.dueDate, dueDate);
  if (dueDate === "no_due_date") return !task.dueDate;

  const dueTime = taskTime(task.dueDate);
  if (dueTime === null) return false;
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
        direction,
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

/** Pure, board-agnostic filtering and sorting for saved My Tasks views. */
export function applyMyTasksView(
  tasks: MyTasksTask[],
  rawConfig: MyTasksViewConfig,
  now: Date = new Date(),
): MyTasksTask[] {
  const config = parseMyTasksViewConfig(rawConfig);
  const { filters } = config;
  const boardIds = config.boardIds ? new Set(config.boardIds) : null;
  const priorityIds = new Set(filters.priorityIds);
  const labelIds = new Set(filters.labelIds.map(String));
  const sizeIds = new Set(filters.sizeIds);
  const sectionIds = new Set(filters.sectionIds);

  return tasks
    .filter((task) => {
      if (boardIds && !boardIds.has(task.projectId)) return false;
      const nestedSection = task.section as unknown as
        | { id?: number; isDone?: boolean | null }
        | undefined;
      const hasNestedSection = typeof nestedSection === "object" && nestedSection !== null;
      const isDone =
        task.myTasksSection?.isDone ??
        (hasNestedSection ? nestedSection.isDone : null);
      const sectionId = task.sectionId ?? (hasNestedSection ? nestedSection.id : undefined);
      if (!filters.showDone && isDone === true) return false;
      if (sectionIds.size > 0 && (!sectionId || !sectionIds.has(sectionId))) return false;
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
      if (!matchesDueDate(task, filters.dueDate, now)) return false;
      if (!matchesRange(task.createdAt, filters.createdRange)) return false;
      if (!matchesRange(task.updatedAt ?? task.createdAt, filters.updatedRange)) return false;
      return true;
    })
    .sort(myTasksSortComparator(config, now));
}

export function sortMyTasksViewSections(
  sections: ISection[],
  config: MyTasksViewConfig,
  now: Date = new Date(),
): ISection[] {
  if (config.sort.field !== "board" && config.sort.field !== "dueDate") return sections;
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
    return taskComparator(firstA, firstB) || a.section_title.localeCompare(b.section_title);
  });
}

/** Legacy priority-only filter retained exactly when HTPR-6422 is off. */
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
