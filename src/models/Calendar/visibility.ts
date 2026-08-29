type CalendarViewVisibilityInput = {
  userId: number;
  visibility: "Public" | "Private";
  projectIds: readonly number[];
};

export const materializeCalendarViewProjectIds = (
  visibility: CalendarViewVisibilityInput["visibility"],
  selectedProjectIds: readonly number[],
  visibleProjectIds: readonly number[],
) =>
  visibility === "Public" && selectedProjectIds.length === 0
    ? [...visibleProjectIds]
    : [...selectedProjectIds];

export const isCalendarViewVisibleToViewer = (
  view: CalendarViewVisibilityInput,
  viewerId: number,
  accessibleProjectIds: ReadonlySet<number>,
) => {
  if (view.userId === viewerId) return true;
  if (view.visibility !== "Public" || view.projectIds.length === 0) {
    return false;
  }
  return view.projectIds.every((projectId) =>
    accessibleProjectIds.has(projectId),
  );
};
