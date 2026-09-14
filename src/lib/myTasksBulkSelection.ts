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

export function visibleTaskIdsFromRows(
  rows: readonly { type: string; task?: { id: number } }[],
): number[] {
  const ids: number[] = [];
  for (const row of rows) {
    if (row.type === "task" && row.task && typeof row.task.id === "number") {
      ids.push(row.task.id);
    }
  }
  return ids;
}
