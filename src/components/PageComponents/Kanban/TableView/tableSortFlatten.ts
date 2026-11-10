export function shouldFlattenSortedRows(
  hasCurrentProject: boolean,
  hasActiveSort: boolean,
  isPrioritySort: boolean,
): boolean {
  if (!hasActiveSort) return false;
  if (hasCurrentProject) return false;
  return isPrioritySort;
}

export function sortedTaskRowSectionKey(
  hasCurrentProject: boolean,
  task: { projectId: number; sectionId?: number | null }
): string | number {
  return hasCurrentProject ? task.sectionId ?? "flat" : task.projectId;
}
