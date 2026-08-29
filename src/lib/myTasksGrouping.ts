import type { ISection, ITask } from "@/models/model";

export type MyTasksBoardTask = {
  id: number;
  projectId: number;
  dueDate?: Date | string | null;
  project?: { id: number; title: string };
  [key: string]: unknown;
};

const dueTime = (task: MyTasksBoardTask): number | null => {
  if (!task.dueDate) return null;
  const time = new Date(task.dueDate).getTime();
  return Number.isFinite(time) ? time : null;
};

const compareTasks = (nowTime: number) =>
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
    const items = [...board.items].sort(compareTasks(nowTime));
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
