/**
 * Pure helpers for My Tasks bulk selection (HTPR-6444).
 * Board-scoped actions (assign, label, move) require one projectId.
 */

export type TaskProjectRef = {
  id: number;
  projectId?: number | null;
  project?: { id?: number | null } | null;
};

export function taskBoardId(task: TaskProjectRef): number | null {
  const projectId = task.projectId ?? task.project?.id;
  return projectId == null ? null : projectId;
}

export function sharedProjectId(
  tasks: readonly TaskProjectRef[],
): number | null {
  if (tasks.length === 0) return null;
  const first = taskBoardId(tasks[0]);
  if (first == null) return null;
  for (const task of tasks) {
    if (taskBoardId(task) !== first) return null;
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
