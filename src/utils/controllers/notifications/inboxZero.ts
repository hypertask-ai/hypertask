import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import { notificationBoardAccessWhere } from "./boardAccess";
import { createHash } from "node:crypto";
import { z } from "zod";

import { NotificationType, Prisma } from "@prisma/client";

import type { JevTriageItem } from "@/lib/ai/jevInboxTriage";
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

const safeUpdatesSchema = z.object({
  taskIds: z.array(z.number().int().positive()).max(10000),
  agentOnly: z.boolean(),
});

const jevNotificationIdsSchema = z.array(z.number().int().positive()).max(500);

const inboxZeroNotificationSelect = (
  userId: number,
  safeUpdates = false,
  jevNoise = false
) => {
  const safety = safeUpdates || jevNoise;
  return {
    id: true,
    notification_inviteId: true,
    type: true,
    seen: true,
    createdAt: true,
    fromUserId: true,
    fromAgentId: true,
    directReply: true,
    taskId: true,
    ...(safety ? { comment: { select: { activity: true, text: true, commentText: true, kind: true } } } : {}),
    task: {
      select: {
        status: true,
        section: true,
        projectId: true,
        dueDate: true,
        ...(safety ? { title: true } : {}),
        ...(safety ? {
          blockerCommentId: true,
          waitingOnUserId: true,
          description: true,
          _count: {
            select: {
              assignees: { where: { userId, agentId: null } },
              decisionRequests: { where: { status: "Pending" } },
              comments: {
                where: {
                  OR: [
                    { kind: "question" },
                    { text: { contains: "question:", mode: "insensitive" } },
                    { commentText: { contains: "question:", mode: "insensitive" } },
                    { text: { contains: `name-${userId}` } },
                  ],
                },
              },
            },
          },
        } : {}),
      },
    },
  } satisfies Prisma.NotificationSelect;
};

export type InboxZeroNotification = Prisma.NotificationGetPayload<{
  select: ReturnType<typeof inboxZeroNotificationSelect>;
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

  const safeUpdates = input.safeUpdates === undefined
    ? undefined
    : safeUpdatesSchema.safeParse(input.safeUpdates);
  if (safeUpdates && !safeUpdates.success) return null;

  const jevNotificationIds = input.jevNotificationIds === undefined
    ? undefined
    : jevNotificationIdsSchema.safeParse(input.jevNotificationIds);
  if (jevNotificationIds && !jevNotificationIds.success) return null;

  return {
    ...(safeUpdates?.success ? { safeUpdates: safeUpdates.data } : {}),
    ...(jevNotificationIds?.success
      ? { jevNotificationIds: jevNotificationIds.data }
      : {}),
    threshold: input.threshold as InboxZeroThresholdDays,
    categories: {
      ...(Object.fromEntries(
        CATEGORY_KEYS.map((key) => [key, categories[key]])
      ) as InboxZeroCategories),
      ...(categories.jevNoise === true ? { jevNoise: true } : {}),
    },
    keep: Object.fromEntries(
      KEEP_KEYS.map((key) => [key, keep[key]])
    ) as InboxZeroKeep,
  };
};

export const withoutJevTriage = (rules: InboxZeroRules): InboxZeroRules => {
  const { jevNotificationIds: _jevNotificationIds, ...rest } = rules;
  const { jevNoise: _jevNoise, ...categories } = rest.categories;
  return {
    ...rest,
    categories: categories as InboxZeroCategories,
  };
};

export const loadActiveInboxZeroNotifications = ( // trufflehog:ignore
  userId: number,
  db: InboxZeroDb = prisma,
  principal?: { userId: number; agentId?: string | null; teamScope?: AgentTokenTeamScope | null },
  safeUpdates = false,
  jevNoise = false,
) =>
  db.notification.findMany({
    where: { AND: [visibleUserInboxWhere(userId), notificationBoardAccessWhere(principal?.userId ?? userId, principal?.agentId, principal?.teamScope)] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: inboxZeroNotificationSelect(userId, safeUpdates, jevNoise),
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

type JevTriageTaskFields = {
  title?: string | null;
  description?: string | null;
  blockerCommentId?: number | null;
  waitingOnUserId?: number | null;
  _count?: { assignees: number; decisionRequests: number; comments: number };
};

type JevTriageCommentFields = {
  text?: string;
  commentText?: string;
  kind?: string | null;
};

export type JevTriageCandidate = {
  key: string;
  item: JevTriageItem;
  notificationIds: number[];
};

const JEV_KEEP_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.Assigned,
  NotificationType.Mentioned,
  NotificationType.Invited,
  NotificationType.TaskReminder,
  NotificationType.TaskDueDate,
  NotificationType.TaskOverdue,
  NotificationType.TaskMovedToInbox,
  NotificationType.AgentBoardAccessRequest,
]);

const JEV_ASK_TEXT = /\?|\b(question|asks?|decide|decision|confirm|approve|sign[- ]?off|review|choose|choose one|option|blocked|blocking|waiting on you|your call|can you|could you|would you|should we|shall we|do you|are you|need your|let me know|reply|respond)\b/i;

const JEV_SENSITIVE_TEXT = /\b(money|price|pricing|invoice|billing|charge|refund|payment|paid|bank|budget|cost|quota|subscription|renew|cancel|key|keys|token|credential|password|access|permission|admin|security|breach|outage|incident|delete|deletion)\b/i;

const jevCommentText = (notification: InboxZeroNotification) => {
  const comment = notification.comment as JevTriageCommentFields | null | undefined;
  return [comment?.commentText, comment?.text, comment?.kind].filter(Boolean).join(" ");
};

export const jevNoiseEligible = (
  item: VisibleInboxItem,
  userId: number,
  keep: InboxZeroKeep
): boolean => {
  if (isProtected(item, keep)) return false;

  for (const notification of item.notifications) {
    if (notification.fromUserId !== null) return false;
    if (JEV_KEEP_TYPES.has(notification.type)) return false;
    if (JEV_ASK_TEXT.test(jevCommentText(notification))) return false;
    if (JEV_SENSITIVE_TEXT.test(jevCommentText(notification))) return false;
  }

  const task = item.representative.task as JevTriageTaskFields | null;
  if (!task) return true;
  if (task.blockerCommentId != null) return false;
  if (task.waitingOnUserId === userId) return false;
  if ((task._count?.assignees ?? 0) > 0) return false;
  if ((task._count?.decisionRequests ?? 0) > 0) return false;
  if ((task._count?.comments ?? 0) > 0) return false;
  if (JEV_ASK_TEXT.test(task.description ?? "")) return false;
  if (JEV_SENSITIVE_TEXT.test(task.description ?? "")) return false;

  return true;
};

export const jevTriageCandidates = (
  notifications: InboxZeroNotification[],
  userId: number,
  keep: InboxZeroKeep
): JevTriageCandidate[] =>
  groupVisibleInboxItems(notifications).flatMap((item) => {
    if (!jevNoiseEligible(item, userId, keep)) return [];
    const { representative } = item;
    const task = representative.task as JevTriageTaskFields | null;
    const kind = Array.from(
      new Set(item.notifications.map((notification) => notification.type))
    ).join(", ");
    const text = item.notifications
      .map((notification) => jevCommentText(notification))
      .filter(Boolean)
      .join(" ");
    return [{
      key: item.key,
      notificationIds: item.notifications.map((notification) => notification.id),
      item: {
        id: item.key,
        kind,
        title: task?.title?.trim() || "Inbox",
        text,
      },
    }];
  });

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
      (rules.categories.jevNoise === true
        ? [...CATEGORY_KEYS, "jevNoise" as const]
        : CATEGORY_KEYS
      ).map((key) => [key, Array.from(matchesByCategory[key]).sort()])
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
        fromAgentId: notification.fromAgentId,
        ...(rules.safeUpdates ? {
          directReply: notification.directReply,
          activity: notification.comment?.activity,
          safety: notification.task ? {
            blockerCommentId: notification.task.blockerCommentId,
            waitingOnUserId: notification.task.waitingOnUserId,
            description: notification.task.description,
            counts: notification.task._count,
          } : null,
        } : {}),
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
  doneTitlesByProject?: ReadonlyMap<number, ReadonlySet<string>> | null,
  agentRowsAreNotOwn = false
): InboxZeroPreview & { notificationIds: number[] } => {
  const cutoff = new Date(now.getTime() - rules.threshold * 24 * 60 * 60 * 1000);
  const items = groupVisibleInboxItems(notifications);
  const matchesByCategory: Record<keyof InboxZeroCategories, Set<string>> = {
    read: new Set(),
    reactions: new Set(),
    ownActions: new Set(),
    superseded: new Set(),
    pastReminders: new Set(),
    jevNoise: new Set(),
  };
  const jevNoiseOn = rules.categories.jevNoise === true;
  const jevRequestedIds = new Set(rules.jevNotificationIds ?? []);

  const safeTaskIds = new Set(rules.safeUpdates?.taskIds);
  const pureUpdateTypes: ReadonlySet<NotificationType> = new Set([
    NotificationType.TaskMoved,
    NotificationType.TaskUpdateDescription,
    NotificationType.TaskArchived,
  ]);

  const pureActivityTypes = new Set(["TaskMove", "TaskDescriptionUpdate", "TaskArchive"]);

  for (const item of items) {
    if (rules.safeUpdates) {
      const task = item.representative.task;
      if (
        item.representative.taskId !== null &&
        safeTaskIds.has(item.representative.taskId) &&
        task && task.blockerCommentId === null &&
        task.waitingOnUserId !== userId &&
        task._count?.assignees === 0 &&
        task._count.comments === 0 &&
        task._count.decisionRequests === 0 &&
        !task.description?.includes(`name-${userId}`) &&
        item.notifications.every((notification) =>
          (pureUpdateTypes.has(notification.type) ||
            (notification.type === NotificationType.Comment &&
              Boolean(notification.fromAgentId) &&
              notification.comment?.activity !== null &&
              typeof notification.comment?.activity === "object" &&
              !Array.isArray(notification.comment.activity) &&
              "type" in notification.comment.activity &&
              typeof notification.comment.activity.type === "string" &&
              pureActivityTypes.has(notification.comment.activity.type))) &&
          notification.directReply === false &&
          (!rules.safeUpdates?.agentOnly || Boolean(notification.fromAgentId))
        )
      ) matchesByCategory.read.add(item.key);
      continue;
    }
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
      item.notifications.some(
        (notification) =>
          notification.fromUserId === userId &&
          !(agentRowsAreNotOwn && notification.fromAgentId)
      )
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

  if (jevNoiseOn && jevRequestedIds.size > 0) {
    for (const item of items) {
      if (
        item.notifications.some((notification) => jevRequestedIds.has(notification.id)) &&
        jevNoiseEligible(item, userId, rules.keep)
      ) {
        matchesByCategory.jevNoise.add(item.key);
      }
    }
  }

  const matchKeys: Array<keyof InboxZeroCategories> = jevNoiseOn
    ? [...CATEGORY_KEYS, "jevNoise"]
    : CATEGORY_KEYS;

  const categoryCounts = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, matchesByCategory[key].size])
  ) as InboxZeroCounts;
  const selectedItemKeys = new Set(
    matchKeys.flatMap((key) =>
      (rules.safeUpdates
        ? key === "read"
        : key === "jevNoise"
          ? jevNoiseOn
          : rules.categories[key])
        ? Array.from(matchesByCategory[key])
        : []
    )
  );
  const notificationIds = items.flatMap((item) =>
    selectedItemKeys.has(item.key)
      ? item.notifications.map((notification) => notification.id)
      : []
  );

  return {
    categoryCounts,
    ...(jevNoiseOn
      ? {
          jevNoiseCount: matchesByCategory.jevNoise.size,
          jevNotificationIds: items.flatMap((item) =>
            matchesByCategory.jevNoise.has(item.key)
              ? item.notifications.map((notification) => notification.id)
              : []
          ),
        }
      : {}),
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
