import type { ISection, ITask } from "@/models/model";
import { endOfDay, endOfWeek, startOfDay } from "date-fns";

export type MyTasksBoardTask = {
  id: number;
  projectId: number;
  dueDate?: Date | string | null;
  project?: { id: number; title?: string | null };
};

export type MyTasksTimeBucket =
  | "Overdue"
  | "Today"
  | "This week"
  | "Later"
  | "No due date";

const TIME_BUCKET_ORDER: MyTasksTimeBucket[] = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "No due date",
];

const dueTime = (task: MyTasksBoardTask): number | null => {
  if (!task.dueDate) return null;
  const time = new Date(task.dueDate).getTime();
  return Number.isFinite(time) ? time : null;
};

export const compareMyTasksByDueDate = (nowTime: number) =>
  (a: MyTasksBoardTask, b: MyTasksBoardTask): number => {
    const aDue = dueTime(a);
    const bDue = dueTime(b);
    const aOverdue = aDue !== null && aDue < nowTime;
    const bOverdue = bDue !== null && bDue < nowTime;

    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aDue === null && bDue === null) return a.id - b.id;
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue || a.id - b.id;
  };

export function getMyTasksSplitIndex(
  sections: Pick<ISection, "projectId">[],
  boardId: string | null,
): number {
  if (!boardId) return 0;
  const sectionIndex = sections.findIndex(
    (section) => String(section.projectId) === boardId
  );
  return sectionIndex === -1 ? 0 : sectionIndex + 1;
}

/**
 * Same calendar rules as My Tasks due-date filters: Overdue is before the
 * start of today, not "due earlier this afternoon".
 */
export function isMyTasksOverdue(
  dueDate: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return classifyMyTasksTimeBucket(dueDate, now) === "Overdue";
}

export function countMyTasksOverdue(
  tasks: Array<{ dueDate?: Date | string | null }>,
  now: Date = new Date(),
): number {
  let count = 0;
  for (const task of tasks) {
    if (isMyTasksOverdue(task.dueDate, now)) count += 1;
  }
  return count;
}

export function countMyTasksOverdueByBoard(
  tasks: MyTasksBoardTask[],
  now: Date = new Date(),
): { total: number; byBoardId: Map<number, number> } {
  const byBoardId = new Map<number, number>();
  let total = 0;
  for (const task of tasks) {
    if (!isMyTasksOverdue(task.dueDate, now)) continue;
    total += 1;
    const boardId = task.project?.id ?? task.projectId;
    byBoardId.set(boardId, (byBoardId.get(boardId) ?? 0) + 1);
  }
  return { total, byBoardId };
}

export function classifyMyTasksTimeBucket(
  dueDate: Date | string | null | undefined,
  now: Date = new Date(),
): MyTasksTimeBucket {
  if (!dueDate) return "No due date";
  const time = new Date(dueDate).getTime();
  if (!Number.isFinite(time)) return "No due date";

  const todayStart = startOfDay(now).getTime();
  if (time < todayStart) return "Overdue";

  const todayEnd = endOfDay(now).getTime();
  if (time <= todayEnd) return "Today";

  const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).getTime();
  if (time <= weekEnd) return "This week";
  return "Later";
}

/** Pure time grouping for My Tasks when a saved view asks for groupBy time. */
export function groupMyTasksByTime(
  tasks: MyTasksBoardTask[],
  now: Date = new Date(),
): { sections: ISection[]; tabs: string[] } {
  const buckets = new Map<MyTasksTimeBucket, MyTasksBoardTask[]>(
    TIME_BUCKET_ORDER.map((bucket) => [bucket, []]),
  );

  for (const task of tasks) {
    buckets.get(classifyMyTasksTimeBucket(task.dueDate, now))!.push(task);
  }

  const sections: ISection[] = TIME_BUCKET_ORDER.flatMap((bucket) => {
    const items = buckets.get(bucket) ?? [];
    if (items.length === 0) return [];
    return [
      {
        sectionId: TIME_BUCKET_ORDER.indexOf(bucket) + 1,
        section_title: bucket,
        items: items as unknown as ITask[],
      },
    ];
  });

  return {
    sections,
    tabs: ["All", ...sections.map((section) => section.section_title)],
  };
}

/** Pure cross-board grouping used by the My Tasks controller and its tests. */
export function groupMyTasksByBoard(
  tasks: MyTasksBoardTask[],
  now: Date = new Date()
): { sections: ISection[]; tabs: string[] } {
  const nowTime = now.getTime();
  const boards = new Map<
    number,
    { projectId: number; title: string; items: MyTasksBoardTask[] }
  >();

  for (const task of tasks) {
    const projectId = task.project?.id ?? task.projectId;
    const board = boards.get(projectId) ?? {
      projectId,
      title: task.project?.title ?? "Untitled board",
      items: [],
    };
    board.items.push(task);
    boards.set(projectId, board);
  }

  const groupedBoards = [...boards.values()].map((board) => {
    const items = [...board.items].sort(compareMyTasksByDueDate(nowTime));
    return {
      ...board,
      items,
      hasOverdue: items.some((task) => {
        const due = dueTime(task);
        return due !== null && due < nowTime;
      }),
      firstDue: items.map(dueTime).find((due) => due !== null) ?? Infinity,
    };
  });

  groupedBoards.sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
    if (a.firstDue !== b.firstDue) return a.firstDue - b.firstDue;
    return a.title.localeCompare(b.title);
  });

  const sections: ISection[] = groupedBoards.map((board) => ({
    sectionId: board.projectId,
    projectId: board.projectId,
    section_title: board.title,
    items: board.items as unknown as ITask[],
  }));

  return {
    sections,
    tabs: ["All", ...sections.map((section) => section.section_title)],
  };
}
