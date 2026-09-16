/**
 * Pure helpers for My Tasks bulk selection (HTPR-6444).
 * Board-scoped actions (assign, label, move) require one projectId.
 */

export type TaskProjectRef = {
  id: number;
  projectId: number | null | undefined;
};

export function sharedProjectId(
  tasks: readonly TaskProjectRef[],
): number | null {
  if (tasks.length === 0) return null;
  const first = tasks[0]?.projectId;
  if (first === null || first === undefined) return null;
  for (const task of tasks) {
    if (task.projectId !== first) return null;
  }
  return first;
}

export const MIXED_BOARD_MESSAGE =
  "Select tasks from one board for assign, label, or move";

export function visibleTasksFromRows<T extends { id: number }>(
  rows: readonly { type: string; task?: T }[],
): T[] {
  const tasks: T[] = [];
  for (const row of rows) {
    if (row.type === "task" && row.task && typeof row.task.id === "number") {
      tasks.push(row.task);
    }
  }
  return tasks;
}
