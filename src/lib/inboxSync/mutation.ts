import type { InboxSplitKey } from "@/lib/inboxSplitSettings";
import type { INotification, ISavedContent } from "@/models/model";
import {
  persistentInboxNotificationId,
  type InboxReadModelPayloadV1,
} from "./contract";

export type InboxReadModelMutation =
  | {
      type: "remove";
      notificationIds: readonly string[];
      taskIds: readonly number[];
    }
  | {
      type: "restore";
      notification: INotification;
      beforeNotificationId: string | null;
      afterNotificationId: string | null;
    }
  | {
      type: "set_seen";
      notificationId: string;
      seen: boolean;
    }
  | {
      type: "set_saved_content";
      notificationId: string;
      savedContent: ISavedContent[];
    }
  | {
      type: "set_splits";
      splitsNoImportant: readonly InboxSplitKey[];
    };

type InboxMutationPayload = Pick<
  InboxReadModelPayloadV1,
  "notifications" | "splitsNoImportant" | "showImportantSplit"
>;

export const findInboxRestoreAnchors = (
  previousNotifications: readonly INotification[],
  remainingNotifications: readonly INotification[],
  notificationId: string,
): { beforeNotificationId: string | null; afterNotificationId: string | null } => {
  const previousIndex = previousNotifications.findIndex(
    ({ id }) => String(id) === notificationId,
  );
  if (previousIndex < 0) {
    return { beforeNotificationId: null, afterNotificationId: null };
  }

  const remainingIds = new Set(
    remainingNotifications.map(({ id }) => String(id)),
  );
  const beforeNotification = previousNotifications
    .slice(previousIndex + 1)
    .find(({ id }) => remainingIds.has(String(id)));
  const afterNotification = previousNotifications
    .slice(0, previousIndex)
    .reverse()
    .find(({ id }) => remainingIds.has(String(id)));
  return {
    beforeNotificationId: beforeNotification
      ? String(beforeNotification.id)
      : null,
    afterNotificationId: afterNotification ? String(afterNotification.id) : null,
  };
};

export const createInboxRemovalMutation = (
  notifications: readonly INotification[],
): Extract<InboxReadModelMutation, { type: "remove" }> => {
  const notificationIds: string[] = [];
  const taskIds: number[] = [];

  for (const notification of notifications) {
    const notificationId = persistentInboxNotificationId(notification);
    if (notificationId) {
      notificationIds.push(notificationId);
    }
    if (typeof notification.taskId === "number") {
      taskIds.push(notification.taskId);
    }
  }

  return {
    type: "remove",
    notificationIds: Array.from(new Set(notificationIds)),
    taskIds: Array.from(new Set(taskIds)),
  };
};

const notificationMatchesRemoval = (
  notification: INotification,
  notificationIds: ReadonlySet<string>,
  taskIds: ReadonlySet<number>,
): boolean => {
  if (!notification) return false;
  if (notificationIds.has(String(notification.id ?? ""))) return true;
  if (notification.waitingOnSynthetic || String(notification.id ?? "").startsWith("-")) {
    return false;
  }
  return typeof notification.taskId === "number" && taskIds.has(notification.taskId);
};

export const applyInboxReadModelMutation = <
  Payload extends InboxMutationPayload,
>(
  payload: Payload,
  mutation: InboxReadModelMutation,
): Payload => {
  switch (mutation.type) {
    case "remove": {
      const notificationIds = new Set(mutation.notificationIds);
      const taskIds = new Set(mutation.taskIds);
      return {
        ...payload,
        notifications: payload.notifications.filter(
          (notification) =>
            !notificationMatchesRemoval(notification, notificationIds, taskIds),
        ),
      } as Payload;
    }
    case "restore": {
      if (!mutation.notification) {
        return payload;
      }
      const notificationId = persistentInboxNotificationId(
        mutation.notification,
      );
      if (
        notificationId &&
        payload.notifications.some(
          (notification) =>
            persistentInboxNotificationId(notification) === notificationId,
        )
      ) {
        return payload;
      }
      const notifications = [...payload.notifications];
      const beforeIndex = mutation.beforeNotificationId
        ? notifications.findIndex(
            ({ id }) => String(id) === mutation.beforeNotificationId,
          )
        : -1;
      const afterIndex = mutation.afterNotificationId
        ? notifications.findIndex(
            ({ id }) => String(id) === mutation.afterNotificationId,
          )
        : -1;
      let insertionIndex = notifications.length;
      if (beforeIndex >= 0) {
        insertionIndex = beforeIndex;
      } else if (afterIndex >= 0) {
        insertionIndex = afterIndex + 1;
      }
      notifications.splice(insertionIndex, 0, mutation.notification);
      return { ...payload, notifications } as Payload;
    }
    case "set_seen":
      return {
        ...payload,
        notifications: payload.notifications.map((notification) =>
          String(notification.id ?? "") === mutation.notificationId
            ? { ...notification, seen: mutation.seen }
            : notification,
        ),
      } as Payload;
    case "set_saved_content":
      return {
        ...payload,
        notifications: payload.notifications.map((notification) =>
          String(notification.id ?? "") === mutation.notificationId
            ? {
                ...notification,
                task: {
                  ...notification.task,
                  savedContent: mutation.savedContent,
                },
              }
            : notification,
        ),
      } as Payload;
    case "set_splits":
      return {
        ...payload,
        splitsNoImportant: [...mutation.splitsNoImportant],
      } as Payload;
  }
};
