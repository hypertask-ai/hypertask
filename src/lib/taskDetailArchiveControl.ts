export type TaskArchiveAction = "archive" | "unarchive";

export function getTaskArchiveAction(status?: string) {
  const isArchived = status === "Archive";

  return {
    action: isArchived ? ("unarchive" as const) : ("archive" as const),
    isArchived,
    label: isArchived ? "Unarchive this task" : "Archive this task",
  };
}

export function getTaskArchiveVisualState(
  status: string | undefined,
  pendingAction: TaskArchiveAction | null,
) {
  if (pendingAction === "archive") {
    return { isArchived: false, label: "Archiving task" };
  }

  if (pendingAction === "unarchive") {
    return { isArchived: true, label: "Unarchiving task" };
  }

  const { isArchived, label } = getTaskArchiveAction(status);
  return { isArchived, label };
}
