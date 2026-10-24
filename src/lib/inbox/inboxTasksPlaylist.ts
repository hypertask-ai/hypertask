import type { INotification, ITasksPlaylist } from "@/models/model";
import type { FirstScreenSnapshot } from "@/lib/firstScreen/SurfaceContext";
import { groupInboxItemsByDate } from "./inboxDateGroups";

type PlaylistTask = { projectId: number; uniqueIndex: number };

type InboxSplitTab = { project: string };

type InboxStructuredData = {
  data: INotification[][];
  tabs: readonly InboxSplitTab[];
};

export const buildInboxTasksPlaylist = (
  notifications: INotification[],
  decisionCommentLinks: boolean,
  visibleOrder?: { oldestFirst: boolean; snapshot?: FirstScreenSnapshot | null },
): ITasksPlaylist[] => {
  const uniqueMap = new Map<string, ITasksPlaylist>();
  const orderedNotifications = visibleOrder
    ? Object.values(groupInboxItemsByDate(
        notifications.map((notification) => ({ notification, date: new Date(notification.createdAt || 0) })),
        visibleOrder.oldestFirst,
        visibleOrder.snapshot,
      )).flatMap(({ items }) => items.map(({ notification }) => notification))
    : notifications;
  for (const notification of orderedNotifications) {
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
