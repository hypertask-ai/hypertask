import prisma from "@/lib/prisma";
import { filterProjectMutedUserIds } from "@/utils/controllers/notifications/projectMute";

type ClaimedDueDateRow = { userId: number };

const invokeDueDate = async (payload: {
  taskId: number;
  projectId: number;
}) => {
  const { taskId, projectId } = payload;
  // Atomically claim the notification in one UPDATE ... RETURNING, mirroring the
  // sweep (src/pages/api/queues/sweep.ts). The dueDate <= now() predicate is the
  // stale-message guard: a delayed message for an old due date cannot fire after
  // the task was rescheduled into the future or archived/deleted.
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

/**
 * Creates the TaskOverdue notification for the task creator + assignees. Both callers
 * (invokeDueDate above and the sweep, src/pages/api/queues/sweep.ts) atomically claim
 * the task by setting dueDateNotifiedAt BEFORE calling this, so it deliberately does
 * NOT touch the marker itself: a blind marker write here would clobber a concurrent
 * setDueDate reset (user re-scheduling the due date) and suppress the re-notify.
 */
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
