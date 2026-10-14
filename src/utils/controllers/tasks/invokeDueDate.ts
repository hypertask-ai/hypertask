import prisma from "@/lib/prisma";
import { filterProjectMutedUserIds } from "@/utils/controllers/notifications/projectMute";

type ClaimedDueDateRow = { userId: number };

const invokeDueDate = async (payload: {
  taskId: number;
  projectId: number;
}) => {
  const { taskId, projectId } = payload;
  const claimed = await prisma.$queryRaw<ClaimedDueDateRow[]>`
    UPDATE "Task"
    SET "dueDateNotifiedAt" = now()
    WHERE id = ${taskId}
      AND "projectId" = ${projectId}
      AND "dueDateNotifiedAt" IS NULL
      AND "dueDate" IS NOT NULL
      AND "dueDate" <= now()
      AND status NOT IN ('Deleted', 'Archive')
    RETURNING "userId"
  `;
  if (claimed.length === 0) return "skipped";

  await createDueDateOverdueNotifications(taskId, projectId, claimed[0].userId);
  return "invoked";
};

export const createDueDateOverdueNotifications = async (
  taskId: number,
  projectId: number,
  taskCreatorId: number
) => {
  const userIds = await getUserIdsForNotification(taskId, taskCreatorId);
  const lastDueDate = await prisma.notification.findFirst({
    where: { taskId, type: "TaskDueDate" },
    orderBy: { createdAt: "desc" },
    select: { fromUserId: true, fromAgentId: true },
  });
  const fromUserId = lastDueDate?.fromUserId ?? taskCreatorId;
  const fromAgentId = lastDueDate?.fromAgentId ?? null;

  await createTaskNotifications({
    fromAgentId,
    fromUserId,
    projectId,
    taskId,
    type: "TaskOverdue",
    userIds,
  });
};

export const getUserIdsForNotification = async (
  taskId: number,
  taskCreatorId: number,
  assigneesOrCreator = false,
) => {
  const assigneesOfTask = await prisma.assignees.findMany({
    where: {
      taskId: taskId,
      ...(assigneesOrCreator ? { agentId: null } : {}),
      task: {
        status: { not: "Deleted" },
      },
    },
    select: { userId: true },
  });
  const assigneeIds = assigneesOfTask.map((assignee) => assignee.userId);
  const userIds = assigneesOrCreator && assigneeIds.length > 0
    ? assigneeIds
    : [taskCreatorId, ...assigneeIds];

  return [...new Set(userIds)];
};

export const createTaskNotifications = async ({
  fromAgentId,
  fromUserId,
  projectId,
  taskId,
  type,
  userIds,
}: {
  fromAgentId?: string | null;
  fromUserId: number;
  projectId: number;
  taskId: number;
  type: "TaskOverdue" | "TaskReminder";
  userIds: number[];
}) => {
  const allowedUserIds = await filterProjectMutedUserIds(userIds, projectId);
  for (const userId of allowedUserIds) {
    await prisma.notification.create({
      data: {
        status: "Normal",
        seen: false,
        userId,
        fromUserId,
        ...(fromAgentId ? { fromAgentId } : {}),
        taskId,
        projectId,
        type,
      },
    });
  }

  return allowedUserIds;
};

export default invokeDueDate;
