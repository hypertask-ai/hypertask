export const ACTIVATION_METRIC_VERSION = "board_3_tasks_7d_v1";

export type ActivationFacts = {
  userId: number;
  signupAt: Date;
  boards: { id: number; ownerId: number; seeded: boolean; createdAt: Date; teamId: string | null }[];
  tasks: { id: number; projectId: number; createdAt: Date }[];
};

export type ActivationMetric = {
  version: typeof ACTIVATION_METRIC_VERSION;
  userId: number;
  boardId: number;
  teamId: string | null;
  signupAt: Date;
  activatedAt: Date;
  taskIds: [number, number, number];
};

export function computeBoard3Tasks7dV1(facts: ActivationFacts): ActivationMetric | null {
  const start = facts.signupAt.getTime();
  const end = start + 7 * 24 * 60 * 60 * 1000;
  const inWindow = (date: Date) => date.getTime() >= start && date.getTime() < end;
  const boards = new Map(facts.boards
    .filter((board) => board.ownerId === facts.userId && !board.seeded && inWindow(board.createdAt))
    .map((board) => [board.id, board]));
  const tasks = facts.tasks.filter((task) => boards.has(task.projectId) && inWindow(task.createdAt))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.projectId - b.projectId || a.id - b.id);
  const seen = new Set<number>();
  const boardTasks = new Map<number, number[]>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const ids = boardTasks.get(task.projectId) ?? [];
    ids.push(task.id);
    boardTasks.set(task.projectId, ids);
    if (ids.length === 3) {
      const board = boards.get(task.projectId)!;
      return {
        version: ACTIVATION_METRIC_VERSION,
        userId: facts.userId,
        boardId: board.id,
        teamId: board.teamId,
        signupAt: facts.signupAt,
        activatedAt: task.createdAt,
        taskIds: [ids[0], ids[1], ids[2]],
      };
    }
  }
  return null;
}
