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
    // markAsDone and (un)archiveBulk both archive every OTHER notification that
    // shares this taskId server-side (HTPR-5640 sibling cleanup) -- e.g. every
    // reactor's Reacted row for the same task, not just the one that was
    // clicked. Task-less types (Invited) never carry a taskId, so they fall
    // through untouched, matching the server's own guard. Without this, a task
    // with several rows in the inbox (most commonly the Reactions split) left
    // the sibling rows painted until the next refetch (HTPR-5745).
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
  if (notificationIds.has(String(notification.id ?? ""))) return true;
  // Synthetic "waiting on you" rows (id "-<taskId>") aren't real DB
  // notifications -- getAll.ts recomputes them fresh from the task's current
  // waitingOnSetAt on every fetch. The server sibling-cleanup a taskId match
  // is mirroring here never touches them, so removing a real row on the same
  // task must not strip the synthetic one optimistically: it would just pop
  // back on the next refetch (HTPR-5745).
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
