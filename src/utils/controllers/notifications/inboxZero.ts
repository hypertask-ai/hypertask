import { createHash } from "node:crypto";

import { NotificationType, Prisma } from "@prisma/client";

import type {
  InboxZeroCategories,
  InboxZeroCounts,
  InboxZeroKeep,
  InboxZeroPreview,
  InboxZeroRules,
  InboxZeroThresholdDays,
} from "@/lib/inboxZero";
import prisma from "@/lib/prisma";
import {
  doneColumnTitles,
  isDoneColumn,
  type NameFallback,
} from "@/lib/doneColumns";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";

export const inboxZeroDoneNameFallback = (title: string): boolean =>
  title.trim().toLowerCase() === "done";

const ALLOWED_THRESHOLDS = new Set<InboxZeroThresholdDays>([0, 1, 3, 7, 14]);
const CATEGORY_KEYS: Array<keyof InboxZeroCategories> = [
  "read",
  "reactions",
  "ownActions",
  "superseded",
  "pastReminders",
];
const KEEP_KEYS: Array<keyof InboxZeroKeep> = [
  "unread",
  "mentions",
  "assignments",
];

const inboxZeroNotificationSelect = {
  id: true,
  notification_inviteId: true,
  type: true,
  seen: true,
  createdAt: true,
  fromUserId: true,
  taskId: true,
  task: {
    select: {
      status: true,
      section: true,
      projectId: true,
      dueDate: true,
    },
  },
} satisfies Prisma.NotificationSelect;

export type InboxZeroNotification = Prisma.NotificationGetPayload<{
  select: typeof inboxZeroNotificationSelect;
}>;

type InboxZeroDb = Pick<Prisma.TransactionClient, "notification" | "section">;

const isBooleanRecord = <T extends string>(
  value: unknown,
  keys: T[]
): value is Record<T, boolean> => {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => typeof (value as Record<T, unknown>)[key] === "boolean");
};

export const parseInboxZeroRules = (value: unknown): InboxZeroRules | null => {
  if (!value || typeof value !== "object") return null;

  const input = value as Partial<InboxZeroRules>;
  const categories = input.categories;
  const keep = input.keep;
  if (
    !ALLOWED_THRESHOLDS.has(input.threshold as InboxZeroThresholdDays) ||
    !isBooleanRecord(categories, CATEGORY_KEYS) ||
    !isBooleanRecord(keep, KEEP_KEYS)
  ) {
    return null;
  }

  return {
    threshold: input.threshold as InboxZeroThresholdDays,
    categories: Object.fromEntries(
      CATEGORY_KEYS.map((key) => [key, categories[key]])
    ) as InboxZeroCategories,
    keep: Object.fromEntries(
      KEEP_KEYS.map((key) => [key, keep[key]])
    ) as InboxZeroKeep,
  };
};

/** All raw rows behind the visible, de-duplicated All-tab Inbox items. */
export const loadActiveInboxZeroNotifications = (
  userId: number,
  db: InboxZeroDb = prisma
) =>
  db.notification.findMany({
    where: visibleUserInboxWhere(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: inboxZeroNotificationSelect,
  });

export const loadDoneTitlesByProject = async (
  projectIdsInput: Iterable<number>,
  nameFallback: NameFallback,
  db: InboxZeroDb = prisma
): Promise<Map<number, Set<string>>> => {
  const projectIds = Array.from(new Set(projectIdsInput));
  if (projectIds.length === 0) return new Map();

  const sections = await db.section.findMany({
    where: { projectId: { in: projectIds }, deleted: false },
    select: { projectId: true, section_title: true, isDone: true },
  });
  const sectionsByProject = new Map<
    number,
    Array<{ section_title: string; isDone: boolean | null }>
  >();

  for (const section of sections) {
    const projectSections = sectionsByProject.get(section.projectId) ?? [];
    projectSections.push(section);
    sectionsByProject.set(section.projectId, projectSections);
  }

  return new Map(
    projectIds.map((projectId) => [
      projectId,
      doneColumnTitles(
        sectionsByProject.get(projectId) ?? [],
        nameFallback
      ),
    ])
  );
};

export const loadInboxZeroDoneTitlesByProject = async (
  notifications: InboxZeroNotification[],
  db: InboxZeroDb = prisma
): Promise<Map<number, Set<string>>> => {
  const projectIds = Array.from(
    new Set(
      notifications.flatMap((notification) =>
        notification.task ? [notification.task.projectId] : []
      )
    )
  );
  return loadDoneTitlesByProject(projectIds, inboxZeroDoneNameFallback, db);
};

type VisibleInboxItem = {
  key: string;
  representative: InboxZeroNotification;
  notifications: InboxZeroNotification[];
};

const visibleInboxItemKey = (notification: InboxZeroNotification): string => {
  if (notification.taskId !== null) return `task:${notification.taskId}`;
  if (notification.notification_inviteId !== null) {
    return `invite:${notification.notification_inviteId}`;
  }
  // The All-tab query de-duplicates on (taskId, notification_inviteId), so all
  // task-less, invite-less rows share one visible representative.
  return "standalone";
};

const groupVisibleInboxItems = (
  notifications: InboxZeroNotification[]
): VisibleInboxItem[] => {
  const items = new Map<string, VisibleInboxItem>();
  const newestFirst = [...notifications].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
  );

  for (const notification of newestFirst) {
    const key = visibleInboxItemKey(notification);
    const item = items.get(key);
    if (item) {
      item.notifications.push(notification);
    } else {
      items.set(key, {
        key,
        representative: notification,
        notifications: [notification],
      });
    }
  }

  return Array.from(items.values());
};

const isProtected = (item: VisibleInboxItem, keep: InboxZeroKeep) => {
  const activeTypes = new Set(
    item.notifications.map((notification) => notification.type)
  );
  return (
    (keep.unread && item.notifications.some((notification) => !notification.seen)) ||
    (keep.mentions && activeTypes.has(NotificationType.Mentioned)) ||
    (keep.assignments && activeTypes.has(NotificationType.Assigned))
  );
};

const previewVersionFor = (
  items: VisibleInboxItem[],
  rules: InboxZeroRules,
  matchesByCategory: Record<keyof InboxZeroCategories, Set<string>>,
  selectedItemKeys: ReadonlySet<string>,
  doneTitlesByProject?: ReadonlyMap<number, ReadonlySet<string>> | null
): string => {
  const doneTitles = Array.from(doneTitlesByProject?.entries() ?? [])
    .map(([projectId, titles]) => [projectId, Array.from(titles).sort()] as const)
    .sort(([left], [right]) => left - right);
  const payload = {
    rules,
    doneTitles,
    categoryMatches: Object.fromEntries(
      CATEGORY_KEYS.map((key) => [key, Array.from(matchesByCategory[key]).sort()])
    ),
    selectedItemKeys: Array.from(selectedItemKeys).sort(),
    items: items.map((item) => ({
      key: item.key,
      rows: item.notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        seen: notification.seen,
        createdAt: notification.createdAt.toISOString(),
        fromUserId: notification.fromUserId,
        taskId: notification.taskId,
        notificationInviteId: notification.notification_inviteId,
        task: notification.task
          ? {
              status: notification.task.status,
              section: notification.task.section,
              projectId: notification.task.projectId,
              dueDate: notification.task.dueDate?.toISOString() ?? null,
            }
          : null,
      })),
    })),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

export const evaluateInboxZero = (
  notifications: InboxZeroNotification[],
  userId: number,
  rules: InboxZeroRules,
  now = new Date(),
  doneTitlesByProject?: ReadonlyMap<number, ReadonlySet<string>> | null
): InboxZeroPreview & { notificationIds: number[] } => {
  const cutoff = new Date(now.getTime() - rules.threshold * 24 * 60 * 60 * 1000);
  const items = groupVisibleInboxItems(notifications);
  const matchesByCategory: Record<keyof InboxZeroCategories, Set<string>> = {
    read: new Set(),
    reactions: new Set(),
    ownActions: new Set(),
    superseded: new Set(),
    pastReminders: new Set(),
  };

  for (const item of items) {
    if (isProtected(item, rules.keep)) continue;

    const { representative } = item;
    const activeTypes = new Set(
      item.notifications.map((notification) => notification.type)
    );

    if (representative.seen && representative.createdAt < cutoff) {
      matchesByCategory.read.add(item.key);
    }

    if (activeTypes.has(NotificationType.Reacted)) {
      matchesByCategory.reactions.add(item.key);
    }

    if (
      item.notifications.some((notification) => notification.fromUserId === userId)
    ) {
      matchesByCategory.ownActions.add(item.key);
    }

    const moveOrEditCount = item.notifications.filter(
      (notification) =>
        notification.type === NotificationType.TaskMoved ||
        notification.type === NotificationType.TaskUpdateDescription
    ).length;
    if (moveOrEditCount > 1) {
      matchesByCategory.superseded.add(item.key);
    }

    const task = representative.task;
    const taskDoneTitles = task
      ? doneTitlesByProject?.get(task.projectId)
      : undefined;
    const taskIsDone = isDoneColumn(
      task?.section,
      taskDoneTitles,
      inboxZeroDoneNameFallback
    );
    const hasReminder = item.notifications.some(
      (notification) =>
        notification.type === NotificationType.TaskReminder ||
        notification.type === NotificationType.TaskDueDate ||
        notification.type === NotificationType.TaskOverdue
    );
    if (hasReminder && taskIsDone) {
      matchesByCategory.pastReminders.add(item.key);
    }
  }

  const categoryCounts = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, matchesByCategory[key].size])
  ) as InboxZeroCounts;
  const selectedItemKeys = new Set(
    CATEGORY_KEYS.flatMap((key) =>
      rules.categories[key] ? Array.from(matchesByCategory[key]) : []
    )
  );
  const notificationIds = items.flatMap((item) =>
    selectedItemKeys.has(item.key)
      ? item.notifications.map((notification) => notification.id)
      : []
  );

  return {
    categoryCounts,
    notificationIds,
    totalActive: items.length,
    totalToArchive: selectedItemKeys.size,
    totalLeft: items.length - selectedItemKeys.size,
    previewVersion: previewVersionFor(
      items,
      rules,
      matchesByCategory,
      selectedItemKeys,
      doneTitlesByProject
    ),
  };
};
