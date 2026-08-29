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

/**
 * Where the task-detail playlist sends the user after an archive/snooze.
 *
 * "stay" is the case the archived indicator has to cover: the playlist holds
 * other tasks but not this one (opened from search, a stale playlist, a task
 * filtered out of the current view), so nothing navigates and the detail page
 * keeps rendering the task it just archived.
 */
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

  // Inbox cache updates can remove the archived task before this navigation
  // runs. The remaining playlist is already ordered, so its first different
  // task is the next valid target. Other entry points keep the stale-playlist
  // guard, and the final inbox item goes back instead of reopening itself.
  if (isMissing && inboxFlow) return hasNextInboxTask ? "next" : "back";
  if (!isLast && !isMissing) return "next";
  if (isLast || playlistLength === 1) return "back";
  if (remindMe) return "back";
  return "stay";
}

/**
 * Archiving normally leaves the task detail, so the icon must not flash the
 * restore state on the way out. When the page stays put there is no navigation
 * to hide behind: apply the archived status locally instead of waiting for a
 * realtime echo or a manual reload (HTPR-5480).
 */
export function shouldApplyLocalArchivedStatus({
  isUnarchiving,
  navigationOutcome,
}: {
  isUnarchiving: boolean;
  navigationOutcome: TaskArchiveNavigationOutcome;
}): boolean {
  return !isUnarchiving && navigationOutcome === "stayed";
}
