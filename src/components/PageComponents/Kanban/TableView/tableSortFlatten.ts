export function shouldFlattenSortedRows(
  hasCurrentProject: boolean,
  hasActiveSort: boolean,
  isPrioritySort: boolean,
  crossBoardPrioritySortEnabled: boolean
): boolean;
export function shouldFlattenSortedRows(
  hasCurrentProject: boolean,
  hasActiveSort: boolean,
  isPrioritySort: boolean,
  crossBoardPrioritySortEnabled: boolean,
  savedViewPrioritySort: boolean,
): boolean;
export function shouldFlattenSortedRows(
  hasCurrentProject: boolean,
  hasActiveSort: boolean,
  isPrioritySort: boolean,
  crossBoardPrioritySortEnabled: boolean,
  savedViewPrioritySort = false,
): boolean {
  if (!hasActiveSort) return false;
  if (hasCurrentProject) return true;
  if (savedViewPrioritySort) return isPrioritySort;
  return crossBoardPrioritySortEnabled && isPrioritySort;
}

export function sortedTaskRowSectionKey(
  hasCurrentProject: boolean,
  task: { projectId: number; sectionId?: number | null }
): string | number {
  return hasCurrentProject ? task.sectionId ?? "flat" : task.projectId;
}
