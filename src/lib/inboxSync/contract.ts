import type { InboxSplitKey } from "@/lib/inboxSplitSettings";
import { isInboxSplitKey } from "../inboxSplitSettings";
import type { INotification } from "@/models/model";
import {
  isInboxReadModelRevision,
  type InboxReadModelRevision,
} from "./revision";

export const INBOX_SYNC_CONTRACT_VERSION = 1 as const;
export const INBOX_READ_MODEL_SCHEMA_VERSION = 2 as const;
export const INBOX_READ_MODEL_TTL_MS = 24 * 60 * 60 * 1000;

export type InboxReadModelPayloadV1 = {
  revision: InboxReadModelRevision;
  notifications: INotification[];
  splitsNoImportant: InboxSplitKey[];
  showImportantSplit: boolean;
};

export type InboxReadModelSnapshotV1 = {
  key: string;
  contractVersion: typeof INBOX_SYNC_CONTRACT_VERSION;
  schemaVersion: typeof INBOX_READ_MODEL_SCHEMA_VERSION;
  accountId: number;
  revision: InboxReadModelRevision;
  savedAt: string;
  expiresAt: string;
  notificationOrder: string[];
  notificationsById: Record<string, INotification>;
  splitsNoImportant: InboxSplitKey[];
  showImportantSplit: boolean;
};

export const inboxReadModelKey = (accountId: number) =>
  `${INBOX_READ_MODEL_SCHEMA_VERSION}:${accountId}`;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const persistentInboxNotificationId = (
  notification: unknown,
): string | null => {
  if (
    !notification ||
    Array.isArray(notification) ||
    typeof notification !== "object"
  ) {
    return null;
  }
  const candidate = notification as Partial<INotification>;
  if (candidate.waitingOnSynthetic === true) return null;
  const id = String(candidate.id ?? "");
  return /^[1-9]\d*$/.test(id) ? id : null;
};

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const NOTIFICATION_TYPES = new Set([
  "Assigned",
  "Comment",
  "Invited",
  "Reacted",
  "TaskArchived",
  "TaskMoved",
  "TaskDueDate",
  "AddedToFollowerInTask",
  "TaskReminder",
  "TaskMovedToInbox",
  "TaskUpdateDescription",
  "TaskOverdue",
  "Mentioned",
]);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && !Array.isArray(value) && typeof value === "object";

const isPersistedInboxNotification = (
  value: unknown,
  notificationId: string,
  accountId: number,
): value is INotification => {
  if (!isObjectRecord(value)) return false;
  if (
    persistentInboxNotificationId(value) !== notificationId ||
    value.userId !== accountId ||
    typeof value.type !== "string" ||
    !NOTIFICATION_TYPES.has(value.type) ||
    typeof value.status !== "string" ||
    typeof value.seen !== "boolean" ||
    !isValidTimestamp(value.createdAt)
  ) {
    return false;
  }

  if (value.type === "Invited") {
    // Projectless invitations cannot be validated by the project-access proof
    // used before hydration, so they remain network-only.
    return false;
  }

  if (
    !isPositiveInteger(value.projectId) ||
    !isObjectRecord(value.project) ||
    value.project.id !== value.projectId ||
    (typeof value.project.title !== "string" &&
      typeof value.project.name !== "string") ||
    !isPositiveInteger(value.taskId) ||
    !isObjectRecord(value.task) ||
    value.task.id !== value.taskId ||
    value.task.projectId !== value.projectId ||
    typeof value.task.title !== "string" ||
    typeof value.task.status !== "string" ||
    typeof value.task.ticketNumber !== "string"
  ) {
    return false;
  }

  return true;
};

export const isInboxReadModelSnapshotV1 = (
  value: unknown,
  expectedAccountId?: number,
  now = Date.now(),
): value is InboxReadModelSnapshotV1 => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const snapshot = value as Partial<InboxReadModelSnapshotV1>;
  const savedAtMs = Date.parse(snapshot.savedAt ?? "");
  const expiresAtMs = Date.parse(snapshot.expiresAt ?? "");
  if (
    !Number.isFinite(now) ||
    snapshot.contractVersion !== INBOX_SYNC_CONTRACT_VERSION ||
    snapshot.schemaVersion !== INBOX_READ_MODEL_SCHEMA_VERSION ||
    !isPositiveInteger(snapshot.accountId) ||
    !isInboxReadModelRevision(snapshot.revision) ||
    snapshot.key !== inboxReadModelKey(snapshot.accountId) ||
    !isValidTimestamp(snapshot.savedAt) ||
    !isValidTimestamp(snapshot.expiresAt) ||
    savedAtMs > now ||
    expiresAtMs <= now ||
    expiresAtMs <= savedAtMs ||
    expiresAtMs - savedAtMs > INBOX_READ_MODEL_TTL_MS ||
    !Array.isArray(snapshot.notificationOrder) ||
    !snapshot.notificationsById ||
    Array.isArray(snapshot.notificationsById) ||
    typeof snapshot.notificationsById !== "object" ||
    !Array.isArray(snapshot.splitsNoImportant) ||
    !snapshot.splitsNoImportant.every(isInboxSplitKey) ||
    typeof snapshot.showImportantSplit !== "boolean"
  ) {
    return false;
  }
  if (expectedAccountId != null && snapshot.accountId !== expectedAccountId) {
    return false;
  }

  const snapshotAccountId = snapshot.accountId;
  const seen = new Set<string>();
  return snapshot.notificationOrder.every((notificationId) => {
    if (seen.has(notificationId)) return false;
    seen.add(notificationId);
    const notification = snapshot.notificationsById?.[notificationId];
    return isPersistedInboxNotification(
      notification,
      notificationId,
      snapshotAccountId,
    );
  });
};

export const createInboxReadModelSnapshot = ({
  accountId,
  payload,
  savedAt = new Date().toISOString(),
  ttlMs = INBOX_READ_MODEL_TTL_MS,
}: {
  accountId: number;
  payload: InboxReadModelPayloadV1;
  savedAt?: string;
  ttlMs?: number;
}): InboxReadModelSnapshotV1 | null => {
  const savedAtMs = Date.parse(savedAt);
  if (
    !isPositiveInteger(accountId) ||
    !isInboxReadModelRevision(payload.revision) ||
    !Number.isFinite(savedAtMs) ||
    !Number.isFinite(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > INBOX_READ_MODEL_TTL_MS
  ) {
    return null;
  }

  const notificationsById: Record<string, INotification> = {};
  const notificationOrder: string[] = [];
  for (const notification of payload.notifications) {
    const notificationId = persistentInboxNotificationId(notification);
    if (
      !notificationId ||
      !isPersistedInboxNotification(notification, notificationId, accountId)
    ) {
      continue;
    }
    if (!(notificationId in notificationsById)) {
      notificationOrder.push(notificationId);
    }
    notificationsById[notificationId] = notification;
  }

  return {
    key: inboxReadModelKey(accountId),
    contractVersion: INBOX_SYNC_CONTRACT_VERSION,
    schemaVersion: INBOX_READ_MODEL_SCHEMA_VERSION,
    accountId,
    revision: payload.revision,
    savedAt,
    expiresAt: new Date(savedAtMs + ttlMs).toISOString(),
    notificationOrder,
    notificationsById,
    splitsNoImportant: Array.from(
      new Set(payload.splitsNoImportant.filter(isInboxSplitKey)),
    ),
    showImportantSplit: payload.showImportantSplit,
  };
};

export const materializeInboxReadModelSnapshot = (
  snapshot: InboxReadModelSnapshotV1,
): InboxReadModelPayloadV1 => ({
  revision: snapshot.revision,
  notifications: snapshot.notificationOrder.map(
    (notificationId) => snapshot.notificationsById[notificationId],
  ),
  splitsNoImportant: snapshot.splitsNoImportant,
  showImportantSplit: snapshot.showImportantSplit,
});

export const filterInboxReadModelByProjectAccess = (
  payload: InboxReadModelPayloadV1,
  accessibleProjectIds: readonly number[],
): InboxReadModelPayloadV1 => {
  const accessible = new Set(accessibleProjectIds);
  return {
    ...payload,
    notifications: payload.notifications.filter((notification) => {
      const notificationProjectId = notification.projectId;
      if (
        !Number.isInteger(notificationProjectId) ||
        !accessible.has(notificationProjectId)
      ) {
        return false;
      }

      const taskProjectId = notification.task?.projectId;
      return (
        taskProjectId == null ||
        (Number.isInteger(taskProjectId) && accessible.has(taskProjectId))
      );
    }),
  };
};
