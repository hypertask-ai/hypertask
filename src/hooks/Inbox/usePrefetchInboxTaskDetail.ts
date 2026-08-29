import { useCallback } from "react";
import { INotification } from "@/models/model";
import { usePrefetchTaskDetailTargets } from "@/hooks/Task Detail/usePrefetchTaskDetail";
import type { PrefetchTaskDetailTarget } from "@/hooks/Task Detail/usePrefetchTaskDetail";

const getNotificationTarget = (
  notification: INotification | undefined,
): PrefetchTaskDetailTarget | null => {
  if (!notification || notification.type === "Invited") return null;

  const taskId = notification.task?.id ?? notification.taskId;
  const projectId = notification.task?.projectId ?? notification.projectId;

  if (!taskId || !projectId) return null;

  return { id: taskId, projectId };
};

const getInboxTargets = (
  notifications: INotification[],
  index: number,
): PrefetchTaskDetailTarget[] => {
  const seenTaskIds = new Set<number>();

  return [index - 1, index, index + 1].reduce<PrefetchTaskDetailTarget[]>(
    (targets, notificationIndex) => {
      const target = getNotificationTarget(notifications[notificationIndex]);

      if (!target || seenTaskIds.has(target.id)) return targets;

      seenTaskIds.add(target.id);
      targets.push(target);
      return targets;
    },
    [],
  );
};

export const usePrefetchInboxTaskDetail = ({
  notifications,
  userId,
}: {
  notifications: INotification[];
  userId?: number;
}) => {
  const prefetchTaskDetailTargets = usePrefetchTaskDetailTargets({ userId });

  return useCallback(
    (index: number) => {
      prefetchTaskDetailTargets(getInboxTargets(notifications, index));
    },
    [notifications, prefetchTaskDetailTargets],
  );
};
