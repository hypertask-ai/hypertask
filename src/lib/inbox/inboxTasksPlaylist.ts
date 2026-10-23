import type { INotification, ITasksPlaylist } from "@/models/model";

type PlaylistTask = { projectId: number; uniqueIndex: number };

type InboxSplitTab = { project: string };

type InboxStructuredData = {
  data: INotification[][];
  tabs: readonly InboxSplitTab[];
};

export const buildInboxTasksPlaylist = (
  notifications: INotification[],
  decisionCommentLinks: boolean,
): ITasksPlaylist[] => {
  const uniqueMap = new Map<string, ITasksPlaylist>();
  for (const notification of notifications) {
    if (notification.type === "Invited") continue;
    const key = `${notification.projectId}-${notification.task?.uniqueIndex}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        projectId: notification.projectId,
        uniqueIndex: notification.task?.uniqueIndex,
        notification,
        ...(decisionCommentLinks && notification.decisionCommentId
          ? { decisionCommentId: notification.decisionCommentId }
          : {}),
      });
    }
  }
  return Array.from(uniqueMap.values());
};

const listHoldsTask = (list: INotification[] | undefined, task: PlaylistTask) =>
  Boolean(
    list?.some(
      (notification) =>
        notification.type !== "Invited" &&
        notification.projectId === task.projectId &&
        notification.task?.uniqueIndex === task.uniqueIndex,
    ),
  );

export const pickInboxPlaylistSplit = (
  structuredData: InboxStructuredData | undefined,
  task: PlaylistTask,
  splitName: string | null | undefined,
): { notifications: INotification[]; splitName: string } | null => {
  const lists = structuredData?.data ?? [];
  const tabs = structuredData?.tabs ?? [];
  const requested = splitName
    ? tabs.findIndex((tab) => tab.project === splitName)
    : -1;
  const candidates = [
    requested,
    0,
    ...lists.map((_, index) => index),
  ].filter((index) => index >= 0);
  const index = candidates.find((candidate) =>
    listHoldsTask(lists[candidate], task),
  );
  if (index === undefined) return null;
  return {
    notifications: lists[index],
    splitName: tabs[index]?.project ?? "",
  };
};

export const inboxPlaylistHoldsTask = (
  playlist: readonly PlaylistTask[] | null | undefined,
  task: PlaylistTask,
): boolean =>
  Boolean(
    playlist?.some(
      (item) =>
        item.projectId === task.projectId &&
        item.uniqueIndex === task.uniqueIndex,
    ),
  );
