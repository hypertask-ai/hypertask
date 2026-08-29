export type TableRowDragData = {
  taskId: number;
  sourceSectionId: number;
};

export const getTableRowDragData = (
  taskId: number,
  taskSectionId: number | null | undefined,
  currentProjectSectionIds: ReadonlySet<number>,
  hasActiveSort: boolean
): TableRowDragData | null => {
  if (
    hasActiveSort ||
    typeof taskSectionId !== "number" ||
    !currentProjectSectionIds.has(taskSectionId)
  ) {
    return null;
  }

  return { taskId, sourceSectionId: taskSectionId };
};

export const canDropTableRow = (
  draggedTask: TableRowDragData | null,
  destinationSectionId: number,
  currentProjectSectionIds: ReadonlySet<number>
) =>
  Boolean(
    draggedTask &&
      draggedTask.sourceSectionId !== destinationSectionId &&
      currentProjectSectionIds.has(draggedTask.sourceSectionId) &&
      currentProjectSectionIds.has(destinationSectionId)
  );

export const parseTableRowDragData = (value: string): TableRowDragData | null => {
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed?.taskId !== "number" ||
      typeof parsed?.sourceSectionId !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
