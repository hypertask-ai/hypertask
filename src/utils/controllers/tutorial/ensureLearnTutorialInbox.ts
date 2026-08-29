import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

const LEARN_TUTORIAL_INBOX_SIZE = 2;
const SERIALIZABLE_RETRY_LIMIT = 3;

export type LearnTutorialInboxTarget = {
  notificationId: number;
  taskId: number;
};

// Native inbox creation leaves this nullable field null, while reminder rows
// use true. False is therefore a schema-compatible marker reserved for the
// two disposable tutorial notifications.
const TUTORIAL_NOTIFICATION_MARKER = false as const;

const tutorialNotificationKey = ({
  projectId,
  taskId,
  userId,
}: {
  projectId: number;
  taskId: number;
  userId: number;
}) => `learn-inbox-v1:user=${userId}:project=${projectId}:task=${taskId}`;

async function hasLegacyTutorialKeyColumn(
  transaction: Prisma.TransactionClient,
) {
  const [{ exists = false } = {}] = await transaction.$queryRaw<
    { exists: boolean }[]
  >`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Notification'
        AND column_name = 'tutorialKey'
    ) AS "exists"
  `;
  return exists;
}

async function findLegacyTutorialNotificationId({
  transaction,
  tutorialKey,
}: {
  transaction: Prisma.TransactionClient;
  tutorialKey: string;
}) {
  const [notification] = await transaction.$queryRaw<{ id: number }[]>`
    SELECT "id"
    FROM "Notification"
    WHERE "tutorialKey" = ${tutorialKey}
    LIMIT 1
    FOR UPDATE
  `;
  return notification?.id ?? null;
}

async function writeLegacyTutorialKey({
  notificationId,
  transaction,
  tutorialKey,
}: {
  notificationId: number;
  transaction: Prisma.TransactionClient;
  tutorialKey: string;
}) {
  await transaction.$executeRaw`
    UPDATE "Notification"
    SET "tutorialKey" = ${tutorialKey}
    WHERE "id" = ${notificationId}
  `;
}

const isRetryableConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2034" ||
    error.code === "P2002" ||
    (error.code === "P2010" && error.meta?.code === "23505"));

/**
 * Keep exactly the two practice tasks addressable by the tutorial without
 * relying on, or mutating, any unrelated inbox activity.
 */
export async function ensureLearnTutorialInbox({
  projectId,
  userId,
}: {
  projectId: number;
  userId: number;
}): Promise<LearnTutorialInboxTarget[]> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      project: { ownerId: userId, title: "Learn Hypertask" },
      status: "Normal",
    },
    orderBy: { uniqueIndex: "asc" },
    take: LEARN_TUTORIAL_INBOX_SIZE,
    select: { id: true },
  });
  const taskIds = tasks.map(({ id }) => id);
  if (taskIds.length !== LEARN_TUTORIAL_INBOX_SIZE) {
    throw new Error("Learn Hypertask needs two tutorial inbox tasks");
  }

  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      const targets = await prisma.$transaction(
        async (transaction) => {
          const hasLegacyColumn = await hasLegacyTutorialKeyColumn(transaction);
          return Promise.all(
            taskIds.map(async (taskId) => {
              const tutorialKey = tutorialNotificationKey({
                projectId,
                taskId,
                userId,
              });
              const existing = await transaction.notification.findFirst({
                where: {
                  fromAgentId: null,
                  fromUserId: userId,
                  projectId,
                  returnedFromReminders: TUTORIAL_NOTIFICATION_MARKER,
                  taskId,
                  type: "TaskMovedToInbox",
                  userId,
                },
                orderBy: { id: "asc" },
                select: { id: true },
              });
              const legacyNotificationId =
                existing === null && hasLegacyColumn
                  ? await findLegacyTutorialNotificationId({
                      transaction,
                      tutorialKey,
                    })
                  : null;
              const data = {
                archivedAt: null,
                fromAgentId: null,
                fromUserId: userId,
                projectId,
                returnedFromReminders: TUTORIAL_NOTIFICATION_MARKER,
                seen: false,
                status: "Normal" as const,
                taskId,
                type: "TaskMovedToInbox" as const,
                userId,
              };
              const notificationId = existing?.id ?? legacyNotificationId;
              const notification = notificationId
                ? await transaction.notification.update({
                    where: { id: notificationId },
                    data,
                    select: { id: true },
                  })
                : await transaction.notification.create({
                    data,
                    select: { id: true },
                  });
              if (hasLegacyColumn) {
                await writeLegacyTutorialKey({
                  notificationId: notification.id,
                  transaction,
                  tutorialKey,
                });
              }
              return { notificationId: notification.id, taskId };
            }),
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return targets;
    } catch (error) {
      if (!isRetryableConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT) {
        throw error;
      }
    }
  }

  throw new Error("Could not prepare tutorial inbox notifications");
}

export async function validateLearnTutorialInboxTargets({
  archivedNotificationIds,
  projectId,
  targets,
  userId,
}: {
  archivedNotificationIds: number[];
  projectId: number;
  targets: LearnTutorialInboxTarget[];
  userId: number;
}): Promise<LearnTutorialInboxTarget[] | null> {
  if (
    targets.length !== LEARN_TUTORIAL_INBOX_SIZE ||
    new Set(targets.map(({ notificationId }) => notificationId)).size !==
      LEARN_TUTORIAL_INBOX_SIZE ||
    new Set(targets.map(({ taskId }) => taskId)).size !==
      LEARN_TUTORIAL_INBOX_SIZE ||
    new Set(archivedNotificationIds).size !== archivedNotificationIds.length ||
    archivedNotificationIds.some(
      (notificationId) =>
        !targets.some((target) => target.notificationId === notificationId),
    )
  ) {
    return null;
  }

  const notifications = await prisma.notification.findMany({
    where: {
      fromAgentId: null,
      fromUserId: userId,
      id: { in: targets.map(({ notificationId }) => notificationId) },
      projectId,
      project: { ownerId: userId, title: "Learn Hypertask" },
      returnedFromReminders: TUTORIAL_NOTIFICATION_MARKER,
      task: { status: "Normal" },
      taskId: { in: targets.map(({ taskId }) => taskId) },
      type: "TaskMovedToInbox",
      userId,
    },
    select: {
      archivedAt: true,
      id: true,
      status: true,
      taskId: true,
    },
  });
  const archivedIds = new Set(archivedNotificationIds);
  const exactTargets = new Set(
    notifications.flatMap(({ archivedAt, id, status, taskId }) =>
      taskId === null ||
      (archivedIds.has(id)
        ? status !== "Archive" || archivedAt === null
        : status !== "Normal" || archivedAt !== null)
        ? []
        : [`${id}:${taskId}`],
    ),
  );
  return targets.every(({ notificationId, taskId }) =>
    exactTargets.has(`${notificationId}:${taskId}`),
  )
    ? targets
    : null;
}
