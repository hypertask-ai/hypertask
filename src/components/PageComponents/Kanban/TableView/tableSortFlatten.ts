// On a real board, an active sort has always flattened rows into one list
// (there's only one project, so "flat" and "grouped by board" mean the same
// thing). On /my-tasks there is no current project, and HTPR-4887 deliberately
// kept the board grouping even while sorted, because most sort columns (the
// per-board manual rank, due date, etc.) don't mean anything compared across
// boards. Priority is the exception: it's a fixed level (No
// Priority/Urgent/High/Medium/Low) that's already comparable across every
// board, so HTPR-6215 flattens rows for that one sort column, behind a flag.
export function shouldFlattenSortedRows(
  hasCurrentProject: boolean,
  hasActiveSort: boolean,
  isPrioritySort: boolean,
  crossBoardPrioritySortEnabled: boolean
): boolean {
  if (!hasActiveSort) return false;
  if (hasCurrentProject) return true;
  return crossBoardPrioritySortEnabled && isPrioritySort;
}

export function sortedTaskRowSectionKey(
  hasCurrentProject: boolean,
  task: { projectId: number; sectionId?: number | null }
): string | number {
  return hasCurrentProject ? task.sectionId ?? "flat" : task.projectId;
}
