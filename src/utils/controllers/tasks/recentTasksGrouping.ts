import type { ITask } from "@/models/model";

/**
 * Grouping helpers for the All Tasks view (`/all-tasks`).
 *
 * The view used to run ONE global `take: 50` ordered by `updatedAt desc` and then
 * derive every project split from that same 50 rows. On a workspace where one
 * busy board produces most of the recent activity, that board consumed the whole
 * budget: quieter boards lost their split entirely, so the view looked like it
 * only contained tasks from a single board (HTPR-5539).
 *
 * Each project now brings its own recent slice. The "All" tab still shows the
 * globally most recent tasks; every project with recent activity always gets a
 * split, no matter how noisy its neighbours are.
 */

export const RECENT_TASKS_PER_PROJECT_LIMIT = 50;
export const RECENT_TASKS_ALL_LIMIT = 50;

export const RESERVED_TAB_TITLES = ["All", "All Due Dates", "My Due Dates"];

const normalizeProjectTitle = (title: string | null | undefined): string =>
  title || "Uncategorized";

/** Create stable labels without consuming a real board title or synthetic tab. */
const createProjectTitleResolver = (buckets: IProjectTaskBucket[]) => {
  const originalTitles = new Set(
    buckets.map((bucket) => normalizeProjectTitle(bucket.title))
  );
  const resolvedTitles = new Map<string, string>();
  const usedTitles = new Set(RESERVED_TAB_TITLES);

  return (title: string | null | undefined): string => {
    const name = normalizeProjectTitle(title);
    const existing = resolvedTitles.get(name);
    if (existing) return existing;

    let candidate = name;
    if (usedTitles.has(candidate)) {
      let suffix = 1;
      do {
        candidate =
          suffix === 1 ? `${name} (board)` : `${name} (board ${suffix})`;
        suffix += 1;
      } while (usedTitles.has(candidate) || originalTitles.has(candidate));
    }

    resolvedTitles.set(name, candidate);
    usedTitles.add(candidate);
    return candidate;
  };
};

export interface IProjectTaskBucket {
  title: string | null | undefined;
  tasks: ITask[];
}

/** The field each view orders by; it must match the per-project DB `orderBy`. */
export type RecentTasksSortKey = "updatedAt" | "dueDate";

const timestampMs = (task: ITask, key: RecentTasksSortKey): number => {
  const value = (task as unknown as Record<string, unknown>)[key] as
    | string
    | Date
    | null
    | undefined;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const byKeyDesc =
  (key: RecentTasksSortKey) => (a: ITask, b: ITask) =>
    timestampMs(b, key) - timestampMs(a, key);

export function groupRecentTasksByProject(
  buckets: IProjectTaskBucket[],
  allLimit: number = RECENT_TASKS_ALL_LIMIT,
  sortKey: RecentTasksSortKey = "updatedAt"
) {
  const populated = buckets.filter((bucket) => bucket.tasks.length > 0);
  const desc = byKeyDesc(sortKey);
  const resolveProjectTitle = createProjectTitleResolver(populated);

  const allTasks = populated
    .flatMap((bucket) => bucket.tasks)
    .sort(desc)
    .slice(0, allLimit);

  // A project can legitimately be titled "All" (or one of the due-date tab
  // names), which would otherwise silently overwrite the synthetic tab. Keep
  // the accumulation in a Map so user-controlled titles like `__proto__` are
  // plain data, and rename any board that collides with a reserved tab.
  const byTitle = new Map<string, ITask[]>();
  const tabs = ["All"];

  // Most recently touched project first, so the split order matches what the
  // user just worked on rather than an arbitrary project id order.
  const ordered = [...populated].sort(
    (a, b) => timestampMs(b.tasks[0], sortKey) - timestampMs(a.tasks[0], sortKey)
  );

  for (const bucket of ordered) {
    const title = resolveProjectTitle(bucket.title);
    const existing = byTitle.get(title);
    if (existing) {
      // Two boards can share a title; merge them into one split.
      byTitle.set(title, [...existing, ...bucket.tasks].sort(desc));
      continue;
    }
    byTitle.set(title, [...bucket.tasks]);
    tabs.push(title);
  }

  const tasksByProject: Record<string, ITask[]> = Object.fromEntries([
    ["All", allTasks],
    ...byTitle,
  ]);

  return { tasksByProject, tabs, allTasks };
}

export function groupRecentTasksByDueDate(
  buckets: IProjectTaskBucket[],
  myDueDatesTasks: ITask[],
  allLimit: number = RECENT_TASKS_ALL_LIMIT
) {
  const { tasksByProject, tabs: projectTabs, allTasks } =
    groupRecentTasksByProject(buckets, allLimit, "dueDate");

  const tasksByDueDate: Record<string, ITask[]> = {
    "All Due Dates": allTasks,
    ...tasksByProject,
  };
  delete tasksByDueDate.All;

  // Skip "All" from the project tabs; "All Due Dates" replaces it.
  const tabs = ["All Due Dates", ...projectTabs.slice(1)];

  if (myDueDatesTasks.length > 0) {
    tabs.splice(1, 0, "My Due Dates");
    tasksByDueDate["My Due Dates"] = myDueDatesTasks.slice(0, allLimit);
  }

  return { tasksByDueDate, tabs };
}
