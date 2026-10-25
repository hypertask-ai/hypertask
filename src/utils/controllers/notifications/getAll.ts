import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7840_BLOCKED_INBOX_ARCHIVE_FLAG } from "@/lib/flags/definitions/htpr-7840-blocked-inbox-archive";
import { BLOCKED_INBOX_DISMISSAL_MESSAGE } from "@/lib/inbox/blockedInboxDismissal";
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { agentScopeEnforced } from "@/lib/auth/agentScope";
import { notificationBoardAccessWhere } from "@/utils/controllers/notifications/boardAccess";
import { NotificationType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getInboxTabs } from "@/utils/helperFunctions/helperFunctions";
import { markQuietAgentMentions } from "@/utils/controllers/notifications/quietOwnerInbox";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { generalConfig } from "@/lib/configs/general.config";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import {
  getShowImportantSplit,
  getSplitsNoImportant,
} from "@/lib/inboxSplitSettings";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  buildRecentInboxActors,
  normalizeInboxActorActivityRows,
  type InboxActorActivityRow,
} from "@/utils/controllers/notifications/recentActors";
import {
  agentIdsRequiringImportantPermission,
  directReplyStateForNotification,
  directReplyTypesByTask,
} from "@/utils/controllers/notifications/agentImportantPermission";

export function inboxTaskSelect(userId: number, includeCachedDescription = false): Prisma.TaskSelect {
  return {
    _count: {
      select: {
        comments: {
          where: { creatorId: { not: null } },
        },
      },
    },
    id: true,
    projectId: true,
    uniqueIndex: true,
    sectionId: true,
    priority: true,
    title: true,
    ...(includeCachedDescription ? { description_: { select: { content: true } } } : {}),
    estimate: true,
    section: true,
    sectionChangedAt: true,
    updatedAt: true,
    assignees: { select: { userId: true, agentId: true } },
    createdAt: true,
    lastCommentAt: true,
    staleNudgedAt: true,
    waitingOnUserId: true,
    waitingOnSetById: true,
    waitingOnSetAt: true,
    comments: {
      where: { agentId: null, creatorId: { not: null } },
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { createdAt: true },
    },
    taskLabels: { include: { label: true }, orderBy: { id: "asc" } },
    ticketNumber: true,
    dueDate: true,
    status: true,
    savedContent: {
      where: { userId, commentId: null },
      select: { id: true },
    },
  };
}

export function notificationInboxInclude(
  userId: number,
  includeCachedDescription = false
): Prisma.NotificationInclude {
  return {
    comment: { select: { id: true, text: true } },
    reaction: { select: { emoji: true } },
    notification_invite: { select: { inviteURL: true } },
    project: {
      select: { id: true, title: true, name: true, teamId: true, stalenessEnabled: true },
    },
    task: {
      select: inboxTaskSelect(userId, includeCachedDescription),
    },
    fromUser: { select: { displayName: true, photoURL: true } },
    fromAgent: { select: { displayName: true, photoURL: true } },
  };
}

const visibleInboxSql = (userId: number) => {
  const selfTriggeredHiddenTypes = Prisma.join(
    inboxConfig.selfTriggeredHidden.map((type) => Prisma.sql`${type}`),
  );

  return Prisma.sql`
    n."status" = 'Normal'::"Status"
    AND n."archivedAt" IS NULL
    AND n."userId" = ${userId}
    AND n."agentId" IS NULL
    AND (
      n."fromUserId" IS NULL
      OR n."fromUserId" <> ${userId}
      OR n."fromAgentId" IS NOT NULL
      OR n."type"::text NOT IN (${selfTriggeredHiddenTypes})
    )
    AND (
      t."status" = 'Normal'::"Status"
      OR (
        t."status" = 'Archive'::"Status"
        AND n."returnedFromReminders" = true
      )
    )
    -- Mirror projectContentAccessWhere(userId): a removed member's old
    -- notifications must not keep returning the task (HTPR-7182).
    AND EXISTS (
      SELECT 1
      FROM "Project" AS p
      WHERE p.id = t."projectId"
        AND (
          p."ownerId" = ${userId}
          OR EXISTS (
            SELECT 1
            FROM "Member" AS m
            WHERE m."projectId" = p.id
              AND m."userId" = ${userId}
              AND m."agentId" IS NULL
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "Reminder" AS r
      WHERE r."taskId" = t.id
        AND r."status" = 'Normal'::"Status"
    )
  `;
};

export async function getInboxNotifications(
  userId: number,
  client: typeof prisma = prisma,
  { withCachedDescription = true }: { withCachedDescription?: boolean } = {},
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
) {
  if ((teamScope != null || (agentId && agentScopeEnforced()))) {
    return client.notification.findMany({
      where: { AND: [visibleUserInboxWhere(userId), notificationBoardAccessWhere(userId, agentId, teamScope)] },
      include: notificationInboxInclude(userId, withCachedDescription),
      distinct: ["taskId", "notification_inviteId"],
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }
  const selectedRows = await client.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT selected.id
    FROM (
      SELECT DISTINCT ON (n."taskId", n."notification_inviteId")
        n.id,
        n."createdAt"
      FROM "Notification" AS n
      INNER JOIN "Task" AS t ON t.id = n."taskId"
      WHERE ${visibleInboxSql(userId)}
      ORDER BY
        n."taskId",
        n."notification_inviteId",
        n."createdAt" DESC,
        n.id DESC
    ) AS selected
    ORDER BY selected."createdAt" DESC, selected.id DESC
  `);

  if (!selectedRows.length) return [];

  return client.notification.findMany({
    include: notificationInboxInclude(userId, withCachedDescription),
    where: {
      AND: [
        { id: { in: selectedRows.map(({ id }) => id) } },
        visibleUserInboxWhere(userId),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    relationLoadStrategy: "join",
  });
}

const getRecentInboxActorActivity = (userId: number, agentId?: string | null, teamScope?: AgentTokenTeamScope | null) => {
  if ((teamScope != null || (agentId && agentScopeEnforced()))) {
    return prisma.notification.findMany({
      where: { AND: [visibleUserInboxWhere(userId), notificationBoardAccessWhere(userId, agentId, teamScope)] },
      select: { taskId: true, type: true, fromAgentId: true, fromUserId: true, createdAt: true },
      distinct: ["taskId", "type", "fromAgentId", "fromUserId"],
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }
  return prisma.$queryRaw<InboxActorActivityRow[]>(Prisma.sql`
    SELECT DISTINCT ON (n."taskId", n."type", n."fromAgentId", n."fromUserId")
      n."taskId" AS "taskId",
      n."type" AS "type",
      n."fromAgentId" AS "fromAgentId",
      n."fromUserId" AS "fromUserId",
      n."createdAt" AS "createdAt"
    FROM "Notification" AS n
    INNER JOIN "Task" AS t ON t.id = n."taskId"
    WHERE ${visibleInboxSql(userId)}
    ORDER BY
      n."taskId",
      n."type",
      n."fromAgentId",
      n."fromUserId",
      n."createdAt" DESC,
      n.id DESC
  `);
};

const notificationGetAll = async (
  userId: string | string[],
  options: { withCachedDescription?: boolean } = {},
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
) => {
  const parsedUserId = parseInt(userId as string);
  try {
    const inboxWhere: Prisma.NotificationWhereInput = agentId || teamScope != null
      ? { AND: [visibleUserInboxWhere(parsedUserId), notificationBoardAccessWhere(parsedUserId, agentId, teamScope)] }
      : visibleUserInboxWhere(parsedUserId);
    const [
      notifications,
      actorActivityRows,
      directReplyRows,
      hyperAiInvites,
      blockedTasks,
      userSetting,
    ] = await Promise.all([
      getInboxNotifications(parsedUserId, prisma, options, agentId, teamScope),
      getRecentInboxActorActivity(parsedUserId, agentId, teamScope),
      prisma.notification.findMany({
        where: { ...inboxWhere, directReply: true },
        select: { taskId: true, type: true, fromAgentId: true },
        distinct: ["taskId", "type", "fromAgentId"],
      }),
      prisma.notification.findMany({
        where: {
          userId: generalConfig.hyperAiId,
          fromUserId: parsedUserId,
          type: "Mentioned",
          taskId: { not: null },
          ...(agentId || teamScope != null ? { AND: [notificationBoardAccessWhere(parsedUserId, agentId, teamScope)] } : {}),
        },
        select: { taskId: true },
        distinct: ["taskId"],
      }),
      prisma.task.findMany({
        where: {
          waitingOnUserId: parsedUserId,
          status: "Normal",
          project: projectContentAccessWhere(parsedUserId, agentId, teamScope),
        },
        orderBy: { waitingOnSetAt: "asc" },
        select: {
          ...inboxTaskSelect(parsedUserId),
          notifications: {
            where: {
              userId: parsedUserId, agentId: null, status: "Archive", archivedAt: { not: null },
              type: "TaskReminder", message: BLOCKED_INBOX_DISMISSAL_MESSAGE,
            },
            orderBy: { archivedAt: "desc" },
            take: 1,
            select: { archivedAt: true },
          },
          project: {
            select: {
              id: true,
              title: true,
              name: true,
              teamId: true,
              stalenessEnabled: true,
            },
          },
          user: {
            select: {
              id: true,
              displayName: true,
              photoURL: true,
              email: true,
            },
          },
        },
      }),
      prisma.userSetting.findUnique({
        where: { userId: parsedUserId },
        select: { notificationMatrix: true },
      }),
    ]);
    const activeNotificationTypeRows = normalizeInboxActorActivityRows(
      actorActivityRows,
    );
    const splitsNoImportant = getSplitsNoImportant(
      userSetting?.notificationMatrix
    );
    const showImportantSplit = getShowImportantSplit(
      userSetting?.notificationMatrix
    );
    const pageAgentIds = agentIdsRequiringImportantPermission(
      activeNotificationTypeRows,
      directReplyRows,
      notifications,
    );
    const pageUserIds = activeNotificationTypeRows.flatMap((row) =>
      row.fromUserId != null ? [row.fromUserId] : []
    );
    const waitingOnSetByUserIds = blockedTasks.flatMap((task) =>
      task.waitingOnSetById ? [task.waitingOnSetById] : []
    );
    const actorAndWaitingUserIds = Array.from(
      new Set([...pageUserIds, ...waitingOnSetByUserIds])
    );
    const taskIds = Array.from(
      new Set(
        notifications
          .map((notification) => notification.taskId)
          .filter(
            (taskId): taskId is number =>
              typeof taskId === "number" && Number.isFinite(taskId)
          )
      )
    );

    const [actorEnrichment, counts] = await Promise.all([
      (async () => {
        const [pageAgents, actorAndWaitingUsers] = await Promise.all([
          pageAgentIds.length
            ? prisma.agent.findMany({
                where: { id: { in: pageAgentIds } },
                select: {
                  id: true,
                  permissions: true,
                  displayName: true,
                  photoURL: true,
                },
              })
            : Promise.resolve([]),
          actorAndWaitingUserIds.length
            ? prisma.user.findMany({
                where: { id: { in: actorAndWaitingUserIds } },
                select: { id: true, displayName: true, photoURL: true, email: true },
              })
            : Promise.resolve([]),
        ]);
        const mutedAgentIds = new Set(
          pageAgents
            .filter(
              (agent) =>
                (agent.permissions as AgentScopes | null)?.postsToImportant === false
            )
            .map((agent) => agent.id)
        );
        const directReplyTypesByTaskId = directReplyTypesByTask(
          directReplyRows,
          mutedAgentIds,
        );

        const usersById = new Map(
          actorAndWaitingUsers.map((user) => [user.id, user])
        );
        const waitingOnSetByUserMap = usersById;
        const agentsById = new Map(pageAgents.map((agent) => [agent.id, agent]));

        const hyperAiInvitedTaskIds = new Set(
          hyperAiInvites.map((invite) => invite.taskId)
        );
        const activeNotificationTypesByTaskId: Record<number, NotificationType[]> = {};
        const humanAuthoredTypes = new Set<string>();
        const agentAuthoredTypes = new Set<string>();
        const mutedAuthoredTypes = new Set<string>();
        const nonMutedAuthoredTypes = new Set<string>();
        for (const row of activeNotificationTypeRows) {
          if (row.taskId == null) continue;
          activeNotificationTypesByTaskId[row.taskId] ??= [];
          if (!activeNotificationTypesByTaskId[row.taskId].includes(row.type)) {
            activeNotificationTypesByTaskId[row.taskId].push(row.type);
          }
          const key = `${row.taskId}:${row.type}`;
          const byAgent =
            !!row.fromAgentId ||
            (row.fromUserId === generalConfig.hyperAiId &&
              !hyperAiInvitedTaskIds.has(row.taskId));
          (byAgent ? agentAuthoredTypes : humanAuthoredTypes).add(key);
          if (row.fromAgentId && mutedAgentIds.has(row.fromAgentId)) {
            mutedAuthoredTypes.add(key);
          } else {
            nonMutedAuthoredTypes.add(key);
          }
        }
        const agentOnlyTypesByTaskId: Record<number, NotificationType[]> = {};
        const mutedTypesByTaskId: Record<number, NotificationType[]> = {};
        for (const [taskId, types] of Object.entries(activeNotificationTypesByTaskId)) {
          agentOnlyTypesByTaskId[Number(taskId)] = types.filter(
            (type) =>
              agentAuthoredTypes.has(`${taskId}:${type}`) &&
              !humanAuthoredTypes.has(`${taskId}:${type}`)
          );
          mutedTypesByTaskId[Number(taskId)] = types.filter(
            (type) =>
              mutedAuthoredTypes.has(`${taskId}:${type}`) &&
              !nonMutedAuthoredTypes.has(`${taskId}:${type}`)
          );
        }
        const recentActorsByTaskId = buildRecentInboxActors({
          activity: activeNotificationTypeRows,
          agentsById,
          usersById,
        });
        const notificationsWithDirectReplies = notifications.map((notification) => {
          const directReplyState = directReplyStateForNotification(
            notification,
            directReplyTypesByTaskId,
            mutedAgentIds,
          );

          return {
            ...notification,
            ...directReplyState,
          };
        });

        const notificationsWithActors = notificationsWithDirectReplies.map((notification) => {
          const nudgedAt = notification.task?.staleNudgedAt?.getTime();
          const latestActivity = notification.task
            ? Math.max(
                notification.task.sectionChangedAt.getTime(),
                (notification.task.lastCommentAt ?? notification.task.createdAt).getTime(),
              )
            : null;
          const staleNudgeDays =
            notification.type === "TaskReminder" &&
            notification.fromUserId === generalConfig.hyperAiId &&
            nudgedAt &&
            latestActivity !== null &&
            latestActivity <= nudgedAt &&
            notification.createdAt.getTime() >= nudgedAt &&
            notification.createdAt.getTime() - nudgedAt < 300_000
              ? Math.floor((nudgedAt - latestActivity) / 86_400_000)
              : undefined;

          return {
            ...notification,
            activeNotificationTypes: notification.taskId == null
              ? [notification.type]
              : activeNotificationTypesByTaskId[notification.taskId] ?? [notification.type],
            agentOnlyTypes: notification.taskId == null
              ? (notification.fromAgentId ? [notification.type] : [])
              : agentOnlyTypesByTaskId[notification.taskId] ?? [],
            mutedTypes: notification.taskId == null
              ? (notification.fromAgentId && mutedAgentIds.has(notification.fromAgentId)
                  ? [notification.type]
                  : [])
              : mutedTypesByTaskId[notification.taskId] ?? [],
            recentActors: notification.taskId ? recentActorsByTaskId[notification.taskId] : undefined,
            ...(staleNudgeDays === undefined ? {} : { staleNudgeDays }),
          };
        });

        const splitPickOrder: NotificationType[] = [
          ...inboxConfig.mentionedSplit,
          ...inboxConfig.importantSplit,
          ...inboxConfig.reactionSplit,
          ...inboxConfig.statusSplits,
        ] as NotificationType[];
        const earningTypeOf = (notification: (typeof notificationsWithActors)[number]) => {
          const activeTypes = notification.activeNotificationTypes;
          const agentOnly = notification.agentOnlyTypes ?? [];
          const muted = notification.mutedTypes ?? [];
          const directReplyTypes = notification.directReplyTypes ?? [];
          const isChore = (type: NotificationType) =>
            !directReplyTypes.includes(type) &&
            ((agentOnly.includes(type) &&
              (inboxConfig.agentSplitTypes as string[]).includes(type)) ||
              muted.includes(type));
          return (
            splitPickOrder.find((type) => activeTypes.includes(type) && !isChore(type)) ??
            splitPickOrder.find((type) => activeTypes.includes(type))
          );
        };
        const swapWanted = new Map<number, NotificationType>();
        for (const notification of notificationsWithActors) {
          if (notification.taskId == null) continue;
          const earningType = earningTypeOf(notification);
          if (earningType && earningType !== notification.type) {
            swapWanted.set(notification.taskId, earningType);
          }
        }
        const earnerRows = swapWanted.size
          ? await prisma.notification.findMany({
              where: {
                ...inboxWhere,
                taskId: { in: Array.from(swapWanted.keys()) },
                type: { in: Array.from(new Set(swapWanted.values())) },
              },
              orderBy: { createdAt: "desc" },
              distinct: ["taskId", "type", "fromAgentId"],
              include: {
                comment: { select: { id: true, text: true } },
                fromUser: { select: { displayName: true, photoURL: true } },
                fromAgent: { select: { displayName: true, photoURL: true } },
              },
            })
          : [];
        return {
          notificationsWithActors,
          earnerRows,
          swapWanted,
          mutedAgentIds,
          mutedTypesByTaskId,
          waitingOnSetByUserMap,
        };
      })(),
      (async () => {
        const unreadCountByTaskId = new Map<number, number>();
        if (taskIds.length) {
          const readStates = await prisma.taskReadState.findMany({
            where: {
              userId: parsedUserId,
              taskId: { in: taskIds },
            },
            select: {
              taskId: true,
              lastReadAt: true,
            },
          });

          const taskIdsWithReadState = new Set(
            readStates.map((readState) => readState.taskId)
          );
          const taskIdsWithoutReadState = taskIds.filter(
            (taskId) => !taskIdsWithReadState.has(taskId)
          );

          const [unreadCommentCounts, unreadNotificationCounts] =
            await Promise.all([
            readStates.length
              ? prisma.comment.groupBy({
                  by: ["taskId"],
                  where: {
                    AND: [
                      {
                        OR: readStates.map((readState) => ({
                          taskId: readState.taskId,
                          createdAt: { gt: readState.lastReadAt },
                        })),
                      },
                      {
                        OR: [
                          { creatorId: null },
                          { creatorId: { not: parsedUserId } },
                          { agentId: { not: null } },
                        ],
                      },
                    ],
                    activity: { equals: Prisma.DbNull },
                  },
                  _count: { _all: true },
                })
              : Promise.resolve([]),
            taskIdsWithoutReadState.length
              ? prisma.notification.groupBy({
                  by: ["taskId"],
                  where: {
                    status: "Normal",
                    userId: parsedUserId,
                    agentId: null,
                    seen: false,
                    taskId: { in: taskIdsWithoutReadState },
                    NOT: visibleUserInboxWhere(parsedUserId).NOT,
                    ...(agentId || teamScope != null ? { AND: [notificationBoardAccessWhere(parsedUserId, agentId, teamScope)] } : {}),
                  },
                  _count: { _all: true },
                })
              : Promise.resolve([]),
          ]);

          unreadCommentCounts.forEach((row) => {
            unreadCountByTaskId.set(row.taskId, row._count._all);
          });

          unreadNotificationCounts.forEach((row) => {
            if (row.taskId != null) {
              unreadCountByTaskId.set(row.taskId, row._count._all);
            }
          });
        }

        return { unreadCountByTaskId };
      })(),
    ]);
    const {
      earnerRows,
      swapWanted,
      mutedAgentIds,
      mutedTypesByTaskId,
      waitingOnSetByUserMap,
    } = actorEnrichment;
    const { unreadCountByTaskId } = counts;
    const enrichedNotifications = actorEnrichment.notificationsWithActors.map((notification) => ({
      ...notification,
      ...(typeof notification.taskId === "number" && Number.isFinite(notification.taskId)
        ? {
            unreadCount: unreadCountByTaskId.get(notification.taskId) ?? 0,
          }
        : {}),
    }));
    type EarnerRow = (typeof earnerRows)[number];
    const earnersByTaskAndType = new Map<string, EarnerRow>();
    for (const earner of earnerRows) {
      if (earner.taskId == null) continue;
      if (
        earner.fromAgentId &&
        mutedAgentIds.has(earner.fromAgentId) &&
        !mutedTypesByTaskId[earner.taskId]?.includes(earner.type)
      ) continue;
      const key = `${earner.taskId}:${earner.type}`;
      if (!earnersByTaskAndType.has(key)) earnersByTaskAndType.set(key, earner);
    }
    const displayedNotifications = enrichedNotifications.map((notification) => {
      if (notification.taskId == null) return notification;
      const wantedType = swapWanted.get(notification.taskId);
      if (!wantedType || wantedType === notification.type) return notification;
      const earner = earnersByTaskAndType.get(
        `${notification.taskId}:${wantedType}`
      );
      if (!earner) return notification;
      const earnerActor = earner.fromAgent
        ? { displayName: earner.fromAgent.displayName ?? "", photoURL: earner.fromAgent.photoURL ?? null }
        : earner.fromUser
          ? { displayName: earner.fromUser.displayName ?? "", photoURL: earner.fromUser.photoURL ?? null }
          : null;
      const recentActors = earnerActor
        ? [
            earnerActor,
            ...(notification.recentActors ?? []).filter(
              (actor) => actor.displayName !== earnerActor.displayName
            ),
          ].slice(0, 2)
        : notification.recentActors;
      return {
        ...notification,
        type: earner.type,
        comment: earner.comment,
        commentId: earner.commentId,
        fromUserId: earner.fromUserId,
        fromUser: earner.fromUser,
        fromAgentId: earner.fromAgentId,
        fromAgent: earner.fromAgent,
        directReply: notification.directReply,
        recentActors,
        earnedAt: earner.createdAt,
      };
    });

    const dismissedBlockedTasks = blockedTasks.filter((task) =>
      task.notifications.some((notification) =>
        notification.archivedAt && notification.archivedAt >= (task.waitingOnSetAt ?? task.createdAt)
      )
    );
    const blockedInboxArchive = dismissedBlockedTasks.length > 0
      && await isFeatureEnabled(HTPR_7840_BLOCKED_INBOX_ARCHIVE_FLAG, parsedUserId).catch(() => false);
    const dismissedBlockedTaskIds = new Set(blockedInboxArchive ? dismissedBlockedTasks.map((task) => task.id) : []);
    const blockedByYouRows = blockedTasks.filter((task) => !dismissedBlockedTaskIds.has(task.id))
      .map(({ notifications: _archivedNotifications, ...task }) => {
      const fromUser =
        (task.waitingOnSetById
          ? waitingOnSetByUserMap.get(task.waitingOnSetById)
          : undefined) ?? task.user;
      return {
        id: `-${task.id}`,
        waitingOnSynthetic: true,
        type: "TaskReminder" as const,
        activeNotificationTypes: ["TaskReminder" as const],
        status: "Normal",
        seen: true,
        userId: parsedUserId,
        user: fromUser,
        createdAt: task.waitingOnSetAt ?? task.createdAt,
        project: task.project,
        projectId: task.projectId,
        task,
        taskId: task.id,
        fromUserId: fromUser.id,
        fromUser,
        agentId: null,
        fromAgentId: null,
      };
    });
    const quietRows = await markQuietAgentMentions(prisma, parsedUserId, displayedNotifications);
    const inboxRows = [...quietRows, ...blockedByYouRows];

    const structuredData = getInboxTabs(
      inboxRows as any,
      splitsNoImportant,
      showImportantSplit
    )

    return ({
      status: 200,
      json: {
        structuredData,
        notifications: inboxRows,
        splitsNoImportant,
        showImportantSplit,
      }
    })
  } catch (error) {
    console.log(error);
    return ({
      status: 500,
      json: []
    })
  }
};

export default notificationGetAll;
