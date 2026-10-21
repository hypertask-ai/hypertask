import { INotification } from "@/models/model";
import { NotificationType } from "@prisma/client";
import { agentSplitName, decisionsSplitName, inboxConfig, staleSplitName } from "@/lib/configs/inbox.config";
import { isDoneColumn } from "@/lib/doneColumns";
import { getInboxSplitKey, type InboxSplitKey } from "@/lib/inboxSplitSettings";



export const inboxDoneNameFallback = (title: string) =>
  title.trim().toLowerCase() === "done";



export interface ISplit{
  splitName: string;
  projectId: number | null;
  notifications: INotification[];
}

export const translates: any = {
  "TaskMoved": "Updates",
  "TaskArchived": "Updates",
  "Reacted": "Reactions",
  "Comment": "Important",
  "Assigned": "Important",
  "AddedToFollowerInTask": "@Mentions",
  "TaskReminder": "Important",
  "TaskMovedToInbox": "Important",
  "TaskUpdateDescription": "Important",
  "TaskOverdue": "Important",
  "TaskDueDate": "Updates",
  "Mentioned": "@Mentions"
}


export type InboxTabMeta = {
  idx: number;
  project: string;
  length: number;
  hasUnseen: boolean;
  projectId: number | null;
};


export type InboxStructuredDataCompact = {
  tabs: InboxTabMeta[];
  data: number[][];
};


export type InboxStructuredDataExpanded = {
  tabs: InboxTabMeta[];
  data: INotification[][];
};


export type InboxQueryPayload = {
  notifications: INotification[];
  structuredData: InboxStructuredDataExpanded;
  splitsNoImportant: InboxSplitKey[];
  showImportantSplit: boolean;
  accountId?: number;
  serverDocumentGeneration?: string;
  dataOrigin?: "placeholder" | "indexeddb" | "network" | "optimistic";
  readModelRevision?: import("@/lib/inboxSync/revision").InboxReadModelRevision;
};


export function isInboxStructuredDataCompact(
  data: INotification[][] | number[][]
): data is number[][] {
  if (data.length === 0) return true;
  const firstRow = data[0];
  if (!firstRow || firstRow.length === 0) return true;
  return typeof firstRow[0] === "number";
}


export function resolveInboxStructuredData(
  notifications: INotification[],
  structuredData: InboxStructuredDataCompact
): InboxStructuredDataExpanded {
  return {
    tabs: structuredData.tabs,
    data: structuredData.data.map((indices) =>
      indices.map((i) => notifications[i])
    ),
  };
}


export function buildInboxQueryCache(
  notifications: INotification[],
  splitsNoImportant: readonly InboxSplitKey[] = [],
  showImportantSplit = false,
  metadata?: Pick<
    InboxQueryPayload,
    "accountId" | "dataOrigin" | "readModelRevision"
  >
): InboxQueryPayload {
  const rows = notifications.filter(
    (notification): notification is INotification => notification != null
  );
  const compact = getInboxTabs(
    rows,
    splitsNoImportant,
    showImportantSplit
  );
  return {
    notifications: rows,
    structuredData: resolveInboxStructuredData(rows, compact),
    splitsNoImportant: [...splitsNoImportant],
    showImportantSplit,
    ...metadata,
  };
}


export function expandInboxApiResponse(raw: {
  notifications: INotification[];
  splitsNoImportant?: InboxSplitKey[];
  showImportantSplit?: boolean;
  structuredData: {
    tabs: InboxTabMeta[];
    data: INotification[][] | number[][];
  };
  accountId?: number;
  dataOrigin?: InboxQueryPayload["dataOrigin"];
  readModelRevision?: import("@/lib/inboxSync/revision").InboxReadModelRevision;
}): InboxQueryPayload {
  const { notifications, structuredData } = raw;
  const expanded = isInboxStructuredDataCompact(structuredData.data)
    ? resolveInboxStructuredData(notifications, {
        tabs: structuredData.tabs,
        data: structuredData.data,
      })
    : {
        tabs: structuredData.tabs,
        data: structuredData.data as INotification[][],
      };

  return {
    notifications,
    structuredData: expanded,
    splitsNoImportant: raw.splitsNoImportant ?? [],
    showImportantSplit: raw.showImportantSplit ?? false,
    accountId: raw.accountId,
    dataOrigin: raw.dataOrigin,
    readModelRevision: raw.readModelRevision,
  };
}


export const getInboxTabs = (
  notifications: INotification[],
  splitsNoImportant: readonly InboxSplitKey[] = [],
  showImportantSplit = false,
  nowMs?: number,
  locale?: string,
): InboxStructuredDataCompact => {
  const noImportant = new Set(splitsNoImportant);
  const autoSplitsAllowed: NotificationType[] = [
    ...inboxConfig.mentionedSplit,
    ...inboxConfig.importantSplit,
    ...inboxConfig.reactionSplit,
    ...inboxConfig.statusSplits,
  ];

  const tasksByProject: Record<number, number[]> = {};
  const notificationsByStatus: Record<string, number[]> = showImportantSplit
    ? { Important: [] }
    : {};
  const blockedByYouIndices: number[] = [];
  const projectOrder: number[] = [];

  for (let i = 0; i < notifications.length; i++) {
    const notification = notifications[i];
    if (!notification) continue;
    if (notification.waitingOnSynthetic) {
      blockedByYouIndices.push(i);
      continue;
    }
    const projectId = notification?.projectId;
    if (projectId) {
      if (!tasksByProject[projectId]) {
        tasksByProject[projectId] = [];
        projectOrder.push(projectId);
      }

      const activeTypes = notification.activeNotificationTypes ?? [notification.type];
      const agentOnlyTypes = notification.agentOnlyTypes ?? [];
      const mutedTypes = notification.mutedTypes ?? [];
      const directReplyTypes =
        notification.directReplyTypes ??
        (notification.directReply ? [notification.type] : []);
      const isChore = (type: NotificationType) =>
        !directReplyTypes.includes(type) &&
        ((agentOnlyTypes.includes(type) &&
          inboxConfig.agentSplitTypes.includes(type as any)) ||
          mutedTypes.includes(type));
      const effectiveType =
        autoSplitsAllowed.find((type) => activeTypes.includes(type) && !isChore(type))
        ?? autoSplitsAllowed.find((type) => activeTypes.includes(type));
      if (effectiveType) {
        const directReply = directReplyTypes.includes(effectiveType);
        const isAgentChore = !directReply && isChore(effectiveType);
        const task = notification.task as
          | {
              status?: string;
              section?: string;
              updatedAt?: string | Date;
              createdAt?: string | Date;
              lastCommentAt?: string | Date;
              comments?: { createdAt: string | Date }[];
              sectionChangedAt?: string | Date;
              assignees?: { userId: number; agentId?: string | null }[];
            }
          | undefined;
        const gated = notification.agentId == null && !!task;
        const staleCutoff = (nowMs ?? Date.now()) - inboxConfig.staleDays * 24 * 60 * 60 * 1000;
        const activityTimes = [
          task?.comments?.[0]?.createdAt ?? task?.lastCommentAt,
          task?.sectionChangedAt,
          task?.createdAt,
        ]
          .filter(Boolean)
          .map((time) => new Date(time as string | Date).getTime());
        const lastHumanActivity = activityTimes.length
          ? Math.max(...activityTimes)
          : task?.updatedAt
            ? new Date(task.updatedAt).getTime()
            : (nowMs ?? Date.now());
        const liveness: "alive" | "done" | "archived" | "stale" = !gated
          ? "alive"
          : task!.status === "Archive"
            ? "archived"
            : lastHumanActivity <= staleCutoff
              ? "stale"
              : isDoneColumn(
                  task!.section,
                  undefined,
                  inboxDoneNameFallback
                )
                ? "done"
                : "alive";
        const staleHome =
          liveness === "stale" &&
          (notification.project as { stalenessEnabled?: boolean } | undefined)
            ?.stalenessEnabled === true
            ? staleSplitName
            : "Updates";
        const assignedToMe =
          !gated ||
          !task!.assignees ||
          task!.assignees.some(
            (assignee) =>
              assignee.userId === notification.userId && assignee.agentId == null
          );
        const addressedToMe = (type: NotificationType) =>
          directReply ||
          notification.returnedFromReminders === true ||
          inboxConfig.importantAddressedAlways.includes(type as any) ||
          (inboxConfig.importantAddressedIfAssigned.includes(type as any) &&
            assignedToMe);

        let primaryCategory = isAgentChore
          ? agentSplitName
          : translates[effectiveType];
        if (
          primaryCategory === "Important" &&
          (liveness !== "alive" || !addressedToMe(effectiveType))
        ) {
          primaryCategory = staleHome;
        } else if (primaryCategory === "Updates") {
          primaryCategory = staleHome;
        }
        const projectSplitName =
          notification.project?.title ?? notification.project?.name ?? "Project";
        const projectSplitKey = getInboxSplitKey({
          project: projectSplitName,
          projectId,
        });
        const mutedImportant =
          !directReply &&
          primaryCategory === "Important" &&
          noImportant.has(projectSplitKey);
        const routesToProjectSplit =
          mutedImportant && !!tasksByProject[projectId];
        if (mutedImportant && !routesToProjectSplit) {
          primaryCategory = staleHome;
        }
        notification.computedSplit = routesToProjectSplit
          ? projectSplitName
          : primaryCategory;
        if (!routesToProjectSplit) {
          if (!notificationsByStatus[primaryCategory]) {
            notificationsByStatus[primaryCategory] = [];
          }
          notificationsByStatus[primaryCategory].push(i);
        }

        const mentionSurvives =
          liveness === "alive" ||
          (liveness === "done" &&
            notification.type === "Mentioned" &&
            (!task?.sectionChangedAt ||
              new Date(notification.earnedAt ?? notification.createdAt).getTime() >
                new Date(task.sectionChangedAt).getTime()));
        if (
          !isAgentChore &&
          (directReply || !notification.quietImportant) &&
          (directReply || inboxConfig.alsoImportant.includes(effectiveType as any)) &&
          (directReply || mentionSurvives) &&
          (directReply ||
            (!noImportant.has(
              getInboxSplitKey({
                project: primaryCategory,
                projectId: null,
              })
            ) &&
              !noImportant.has(projectSplitKey)))
        ) {
          if (!notificationsByStatus["Important"]) {
            notificationsByStatus["Important"] = [];
          }
          notificationsByStatus["Important"].push(i);
        }
      }
      if (notification.isDecision === true) {
        if (!notificationsByStatus[decisionsSplitName]) {
          notificationsByStatus[decisionsSplitName] = [];
        }
        notificationsByStatus[decisionsSplitName].push(i);
      }
      tasksByProject[projectId].push(i);
    }
  }

  if (blockedByYouIndices.length > 0) {
    const importantTaskIds = new Set(
      (notificationsByStatus.Important ?? []).map(
        (index) => notifications[index].taskId
      )
    );
    const syntheticForImportant = blockedByYouIndices.filter(
      (index) => !importantTaskIds.has(notifications[index].taskId)
    );
    if (syntheticForImportant.length > 0) {
      notificationsByStatus.Important = [
        ...syntheticForImportant,
        ...(notificationsByStatus.Important ?? []),
      ];
    }
  }

  notificationsByStatus.Important?.sort((a, b) => {
    const isBlockedByMe = (index: number) =>
      notifications[index].task?.waitingOnUserId ===
      notifications[index].userId;
    return Number(isBlockedByMe(b)) - Number(isBlockedByMe(a));
  });

  type NotificationSplit = {
    splitName: string;
    notificationIndices: number[];
    projectId: number | null;
  };

  const autoSplits: NotificationSplit[] = Object.keys(notificationsByStatus)
    .map(
      (type): NotificationSplit => ({
        splitName: type,
        notificationIndices: notificationsByStatus[type],
        projectId: null,
      })
    )
    .sort((a, b) => {
      const priority = (name: string): number => {
        if (name === "Important") return 0;
        if (name === decisionsSplitName) return 0.5;
        if (name === "@Mentions") return 1;
        if (name === agentSplitName) return 3;
        if (name === staleSplitName) return 4;
        return 2;
      };
      return priority(a.splitName) - priority(b.splitName);
    });

  const tasksByProjectValues: NotificationSplit[] = projectOrder
    .map((projectId) => {
      const project = notifications[tasksByProject[projectId][0]].project!;
      return {
        splitName: project.title ?? project.name ?? "Project",
        notificationIndices: tasksByProject[projectId],
        projectId,
      };
    })
    .sort((a, b) => a.splitName.localeCompare(b.splitName, locale));

  const allIndices = notifications.flatMap((notification, i) =>
    !notification || notification.waitingOnSynthetic ? [] : [i]
  );
  const AllSplit: NotificationSplit = {
    splitName: "All",
    notificationIndices: allIndices,
    projectId: null,
  };

  const autoSplitsWithBlocked = [...autoSplits];
  if (blockedByYouIndices.length > 0) {
    const importantIndex = autoSplitsWithBlocked.findIndex(
      (split) => split.splitName === "Important"
    );
    autoSplitsWithBlocked.splice(
      importantIndex >= 0 ? importantIndex + 1 : Math.min(1, autoSplits.length),
      0,
      {
        splitName: "Blocked by you",
        notificationIndices: blockedByYouIndices,
        projectId: null,
      }
    );
  }

  const splits: NotificationSplit[] = [
    ...autoSplitsWithBlocked,
    ...tasksByProjectValues,
    AllSplit,
  ];

  const tabs: InboxTabMeta[] = [];
  const data: number[][] = [];

  splits.forEach((split, index) => {
    const hasUnseen = split.notificationIndices.every(
      (i) => notifications[i].seen === true
    );
    tabs.push({
      idx: index,
      project: split.splitName,
      length: split.notificationIndices.length,
      hasUnseen,
      projectId: split.projectId,
    });
    data.push(split.notificationIndices);
  });

  return { tabs, data };
};
