export type TaskPlaylistNavigation = "next" | "back" | "stay";
export type TaskArchiveNavigationOutcome = "navigated" | "stayed";

type TaskPlaylistIdentity = {
  projectId: number | string;
  uniqueIndex: number | string;
};

export function shouldAdvanceAfterNotificationArchive(
  inboxFlow: string | null | undefined,
): boolean {
  return inboxFlow === "true";
}

export function nextRemainingInboxTask<T extends TaskPlaylistIdentity>(
  playlist: T[],
  currentTask: TaskPlaylistIdentity,
): T | undefined {
  const currentIndex = playlist.findIndex(
    (task) =>
      String(task.projectId) === String(currentTask.projectId) &&
      String(task.uniqueIndex) === String(currentTask.uniqueIndex),
  );
  return currentIndex === -1 ? playlist[0] : playlist[currentIndex + 1];
}

export function resolveTaskPlaylistNavigation({
  indexOf,
  playlistLength,
  remindMe,
  inboxFlow,
  hasNextInboxTask,
}: {
  indexOf: number;
  playlistLength: number;
  remindMe?: boolean;
  inboxFlow?: boolean;
  hasNextInboxTask?: boolean;
}): TaskPlaylistNavigation {
  if (playlistLength <= 0) return "back";

  const isLast = indexOf === playlistLength - 1;
  const isMissing = indexOf === -1;

  if (isMissing && inboxFlow) return hasNextInboxTask ? "next" : "back";
  if (!isLast && !isMissing) return "next";
  if (isLast || playlistLength === 1) return "back";
  if (remindMe) return "back";
  return "stay";
}

export function shouldApplyLocalArchivedStatus({
  isUnarchiving,
  navigationOutcome,
}: {
  isUnarchiving: boolean;
  navigationOutcome: TaskArchiveNavigationOutcome;
}): boolean {
  return !isUnarchiving && navigationOutcome === "stayed";
}
