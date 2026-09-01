import { NotificationType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getInboxTabs } from "@/utils/helperFunctions/helperFunctions";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { generalConfig } from "@/lib/configs/general.config";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import {
  getShowImportantSplit,
  getSplitsNoImportant,
} from "@/lib/inboxSplitSettings";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
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

/** Prisma include for inbox notification rows — fields match inbox UI usage only. */
export function inboxTaskSelect(userId: number): Prisma.TaskSelect {
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
  userId: number
): Prisma.NotificationInclude {
  return {
    comment: { select: { id: true, text: true } },
    reaction: { select: { emoji: true } },
    notification_invite: { select: { inviteURL: true } },
    project: {
      select: { id: true, title: true, name: true, teamId: true, stalenessEnabled: true },
    },
    task: {
      select: inboxTaskSelect(userId),
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
    AND NOT EXISTS (
      SELECT 1
      FROM "Reminder" AS r
      WHERE r."taskId" = t.id
        AND r."status" = 'Normal'::"Status"
    )
  `;
};

/**
 * Select one lightweight row per Inbox item before loading its deep relations.
 * Prisma applies `distinct` after a relation-join query, which made PostgreSQL
 * build task, comment, label, and assignee JSON for every historical
 * notification before Node discarded duplicates.
 */
export async function getInboxNotifications(
  userId: number,
  client: typeof prisma = prisma,
) {
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
    include: notificationInboxInclude(userId),
    where: {
      AND: [
        { id: { in: selectedRows.map(({ id }) => id) } },
        visibleUserInboxWhere(userId),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // The ID reduction above keeps this deep relation join bounded to the rows
    // that the response will actually return.
    relationLoadStrategy: "join",
  });
}

/**
 * Return one newest notification per task/type/actor pair for Inbox splits and
 * the actor strip.
 * DISTINCT ON keeps newest-row selection in PostgreSQL and returns the compact
 * actor/type shape directly.
 */
const getRecentInboxActorActivity = (userId: number) => {
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

const notificationGetAll = async (userId: string | string[]) => {
  const parsedUserId = parseInt(userId as string);
  try {
    const inboxWhere = visibleUserInboxWhere(parsedUserId);
    // Kick off as soon as the Inbox row selection resolves rather than after
    // every other wave-1 query — taskIds only ever comes from `notifications`,
    // so waiting on actor/direct-reply/blocked/settings queries first was one
    // unconditional round trip this didn't need.
    const notificationsPromise = getInboxNotifications(parsedUserId);
    const taskIdsPromise = notificationsPromise.then((rows) =>
      Array.from(
        new Set(
          rows
            .map((notification) => notification.taskId)
            .filter(
              (taskId): taskId is number =>
                typeof taskId === "number" && Number.isFinite(taskId)
            )
        )
      )
    );
    const readStatesPromise = taskIdsPromise.then((taskIds) =>
      taskIds.length
        ? prisma.taskReadState.findMany({
            where: {
              userId: parsedUserId,
              taskId: { in: taskIds },
            },
            select: {
              taskId: true,
              lastReadAt: true,
            },
          })
        : Promise.resolve([])
    );
    // Started ahead of the outer Promise.all it feeds into below. If that
    // Promise.all (or getInboxNotifications itself) rejects first, the catch
    // block returns before the later `await readStatesPromise`/`taskIdsPromise`
    // runs, which would otherwise leave these chains' own rejections
    // unobserved and trip Node's unhandled-rejection handling. These no-op
    // catches only mark them handled — the real awaits further down still
    // throw normally.
    void taskIdsPromise.catch(() => undefined);
    void readStatesPromise.catch(() => undefined);
    const [
      notifications,
      actorActivityRows,
      directReplyRows,
      hyperAiInvites,
      blockedTasks,
      userSetting,
    ] = await Promise.all([
      notificationsPromise,
      getRecentInboxActorActivity(parsedUserId),
      prisma.notification.findMany({
        where: { ...inboxWhere, directReply: true },
        select: { taskId: true, type: true, fromAgentId: true },
        distinct: ["taskId", "type", "fromAgentId"],
      }),
      // Tasks where you @mentioned HyperAI. Its replies there are answers to you, so
      // they stay Important; everywhere else it is working on its own.
      prisma.notification.findMany({
        where: {
          userId: generalConfig.hyperAiId,
          fromUserId: parsedUserId,
          type: "Mentioned",
          taskId: { not: null },
        },
        select: { taskId: true },
        distinct: ["taskId"],
      }),
      prisma.task.findMany({
        where: {
          waitingOnUserId: parsedUserId,
          status: "Normal",
        },
        orderBy: { waitingOnSetAt: "asc" },
        select: {
          ...inboxTaskSelect(parsedUserId),
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
    // A type counts as agent-only when no human authored that event on the task, so a
    // human comment is never demoted just because an agent also touched the task.
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
      // HyperAI posts under its own user account rather than an Agent record, so it has
      // to be recognised here or its autonomous work (GitHub webhooks, board moves)
      // reads as a person's. Once you invite it into a task it is answering you.
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
    // Already in flight since notificationsPromise resolved — this awaits
    // work that has been running concurrently with the wave-1/wave-2 queries
    // above instead of starting it fresh.
    const taskIds = await taskIdsPromise;

    const unreadCountByTaskId = new Map<number, number>();
    if (taskIds.length) {
      const readStates = await readStatesPromise;

      const taskIdsWithReadState = new Set(
        readStates.map((readState) => readState.taskId)
      );
      const taskIdsWithoutReadState = taskIds.filter(
        (taskId) => !taskIdsWithReadState.has(taskId)
      );

      const [unreadCommentCounts, unreadNotificationCounts] = await Promise.all([
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
                    // own comments don't count, unless agent-authored
                    // (agent comments carry the token owner's creatorId)
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
                // Rows hidden from the inbox must not show up in its unread count.
                NOT: inboxWhere.NOT,
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

    const notificationsWithUnreadCount = notifications.map((notification) => {
      const hasTaskId =
        typeof notification.taskId === "number" &&
        Number.isFinite(notification.taskId);
      const directReplyState = directReplyStateForNotification(
        notification,
        directReplyTypesByTaskId,
        mutedAgentIds,
      );

      return {
        ...notification,
        // A later row can represent the task after a direct answer. Preserve the
        // addressed marker while any active direct-reply row remains in the inbox.
        ...directReplyState,
        ...(hasTaskId
          ? { unreadCount: unreadCountByTaskId.get(notification.taskId!) ?? 0 }
          : {}),
      };
    });

    const enrichedNotifications = notificationsWithUnreadCount.map((notification) => {
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

    // Show the event that EARNED the row its place, not the newest event. A task can
    // sit in Important because of a mention or its own overdue state while a due-date
    // bot bump is the newest row; displaying the bump makes Important read as bot
    // noise (HTPR-4769). Mirror getInboxTabs' strongest-active-event pick (chores
    // skipped) and swap the display fields to the newest row of that type;
    // id/seen/createdAt/unreadCount stay the representative's so archive, read state,
    // sorting and date groups keep working.
    const splitPickOrder: NotificationType[] = [
      ...inboxConfig.mentionedSplit,
      ...inboxConfig.importantSplit,
      ...inboxConfig.reactionSplit,
      ...inboxConfig.statusSplits,
    ] as NotificationType[];
    const earningTypeOf = (notification: (typeof enrichedNotifications)[number]) => {
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
    for (const notification of enrichedNotifications) {
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
      // The actor strip must lead with the callout's author, or the row reads as
      // the bot having mentioned you.
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
        // When the earning event happened, for the Done-survival check; createdAt
        // stays the representative's so sorting and date groups do not move.
        earnedAt: earner.createdAt,
      };
    });

    const blockedByYouRows = blockedTasks.map((task) => {
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
    const inboxRows = [...displayedNotifications, ...blockedByYouRows];

    // Process the notifications to keep only one notification per task.
    // getInboxTabs recognizes the task-backed synthetic rows and keeps them only
    // in the dedicated split, including when the client rebuilds its cache.
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



// please export this from a different file, migraine right now cba
// i dont understand exporting this from a different file. But I do understand migraine. 

export default notificationGetAll;
