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
  "Mentioned": "@Mentions" // Primary category for Mentioned
}

// Define which notification types should also go into Important

export type InboxTabMeta = {
  idx: number;
  project: string;
  length: number;
  hasUnseen: boolean;
  projectId: number | null;
};


/** Tab layout with indices into the canonical `notifications` array (wire format). */
export type InboxStructuredDataCompact = {
  tabs: InboxTabMeta[];
  data: number[][];
};


/** Tab layout with full notification rows (React Query / UI cache). */
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


/** Expand compact tab indices into per-tab notification arrays for the inbox UI. */
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


/** Build React Query cache shape from a flat notification list. */
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


/** Normalize API payload (compact or legacy) into expanded cache shape. */
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
      // Only the user inbox enriches this. A single row cannot prove a type is
      // agent-only, so callers without it (the agent inbox) demote nothing.
      const agentOnlyTypes = notification.agentOnlyTypes ?? [];
      const mutedTypes = notification.mutedTypes ?? [];
      const directReplyTypes =
        notification.directReplyTypes ??
        (notification.directReply ? [notification.type] : []);
      // Agent housekeeping and routine output belong in Agents. A normal agent can
      // still reach Important by mentioning you; muted agents route every type here.
      const isChore = (type: NotificationType) =>
        !directReplyTypes.includes(type) &&
        ((agentOnlyTypes.includes(type) &&
          inboxConfig.agentSplitTypes.includes(type as any)) ||
          mutedTypes.includes(type));
      // HTPR-4236: bucket by the strongest active event so later updates cannot bury
      // mentions. Agent chores are skipped in the first pass so an agent comment cannot
      // drag a real human event into the Agent split with it.
      const effectiveType =
        autoSplitsAllowed.find((type) => activeTypes.includes(type) && !isChore(type))
        ?? autoSplitsAllowed.find((type) => activeTypes.includes(type));
      if (effectiveType) {
        const directReply = directReplyTypes.includes(effectiveType);
        const isAgentChore = !directReply && isChore(effectiveType);
        // HTPR-4769: Important = names you, on a task still alive. Computed at read
        // time from the task carried on the row, so state changes re-classify on the
        // next load and rows never leave the inbox (Inbox Zero stays the only drain).
        const task = notification.task as
          | {
              status?: string;
              section?: string;
              updatedAt?: string | Date;
              createdAt?: string | Date;
              lastCommentAt?: string | Date;
              /** Newest human comment only (agent comments excluded at query time). */
              comments?: { createdAt: string | Date }[];
              sectionChangedAt?: string | Date;
              assignees?: { userId: number; agentId?: string | null }[];
            }
          | undefined;
        // Gates apply to the user inbox only: agent-inbox rows (agentId set) keep
        // their old behavior, as do rows without task data (old client caches).
        const gated = notification.agentId == null && !!task;
        const staleCutoff = (nowMs ?? Date.now()) - inboxConfig.staleDays * 24 * 60 * 60 * 1000;
        // The staleness clock ticks on HUMAN activity (comments, column moves,
        // creation), not on updatedAt: the inne due-date bot bumps updatedAt every
        // morning, which would keep its tasks "alive" forever and their old mentions
        // stuck in Important. ponytail: edits-only activity (title/description) does
        // not reset the clock; wire a humanActivityAt column if that ever matters.
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
        // Inbox rows and client cache rebuilds do not carry board sections or
        // isDone flags. The payload and every cache-rebuild caller would need a
        // per-project done-title map before replacing this name fallback.
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
        // Stale rows get their own shelf, but only on boards that opted into
        // staleness tracking; everywhere else they stay in Updates.
        const staleHome =
          liveness === "stale" &&
          (notification.project as { stalenessEnabled?: boolean } | undefined)
            ?.stalenessEnabled === true
            ? staleSplitName
            : "Updates";
        // Assigned to YOU personally; a row for your agent's assignment carries the
        // owner's userId with agentId set and must not count.
        const assignedToMe =
          !gated ||
          !task!.assignees ||
          task!.assignees.some(
            (assignee) =>
              assignee.userId === notification.userId && assignee.agentId == null
          );
        const addressedToMe = (type: NotificationType) =>
          directReply ||
          // A row you snoozed and got back is your own reminder, whatever its type.
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

        // Mentions survive a move to Done when the mention is newer than the move
        // ("why did we close this?" is a real ask); archive and staleness kill them.
        // The timestamp check only means anything when the representative row IS the
        // mention; when a later move is representative, the mention predates it and
        // correctly dies with the task.
        const mentionSurvives =
          liveness === "alive" ||
          (liveness === "done" &&
            notification.type === "Mentioned" &&
            (!task?.sectionChangedAt ||
              // earnedAt: a display-swapped row keeps the representative's createdAt
              // (a newer bot bump), which must not vouch for an older mention.
              new Date(notification.earnedAt ?? notification.createdAt).getTime() >
                new Date(task.sectionChangedAt).getTime()));
        if (
          !isAgentChore &&
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
      // HTPR-7092: the server marks rows with an unanswered Question that @mentions
      // you (only while the flag is on). They keep their normal split too.
      if (notification.isDecision === true) {
        if (!notificationsByStatus[decisionsSplitName]) {
          notificationsByStatus[decisionsSplitName] = [];
        }
        notificationsByStatus[decisionsSplitName].push(i);
      }
      tasksByProject[projectId].push(i);
    }
  }

  // Blocked-by-you tasks always show in Important too, pinned on top. Skip
  // tasks that already have a real Important row (that row carries the flag).
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
        // Agent housekeeping sits after everything a person did; stale last, it is
        // a shelf for review, not a queue.
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

  // Project splits show even when only one project is present. Hiding them made the
  // board split vanish the moment the inbox happened to hold a single project.
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
