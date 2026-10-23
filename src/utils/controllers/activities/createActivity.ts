import prisma from "@/lib/prisma";
import {
  ITaskMoveActivity,
  ITaskPriorityActivity,
  ITaskEstimateActivity,
  ITaskAssignedActivity,
  ITaskArchiveActivity,
  ITaskUpdateDescriptionActivity,
} from "@/models/ActivityModels.ts";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";
import { sanitizeAgentCredentials } from "@/lib/agents/publicAgent";
import {
  activityAgentDisplayName,
  activityAgentId,
} from "@/lib/agents/activityAttribution";
import type { Prisma } from "@prisma/client";

interface IProps {
  activityBody:
    | ITaskAssignedActivity
    | ITaskMoveActivity
    | ITaskPriorityActivity
    | ITaskEstimateActivity
    | ITaskArchiveActivity
    | ITaskUpdateDescriptionActivity
    | any;
  taskId: number;
  runTaskSummary?: boolean;
  transaction?: Prisma.TransactionClient;
}

const createActivity = async ({
  activityBody,
  taskId,
  runTaskSummary,
  transaction,
}: IProps) => {
  const shouldRunTaskSummary = runTaskSummary ?? !transaction;
  if (shouldRunTaskSummary && transaction) {
    throw new Error("Task summary scheduling must occur after transaction commit");
  }
  const client = transaction ?? prisma;
  const safeActivityBody = sanitizeAgentCredentials(activityBody);
  const comment = await client.comment.create({
    data: {
      text: "",
      taskId: taskId,
      activity: safeActivityBody as any,
      agentId: activityAgentId(safeActivityBody),
      agentDisplayName: activityAgentDisplayName(safeActivityBody),
    },
  });
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: { updatedByUserIds: true, userId: true },
  });

  const fromUserId =
    (safeActivityBody as any).data.fromUserId ??
    (safeActivityBody as any).data.fromUser?.id;
  if (fromUserId && !task?.updatedByUserIds?.includes(fromUserId)) {
    await client.task.update({
      where: { id: taskId },
      data: {
        updatedAt: new Date(),
        updatedByUserIds: {
          push: fromUserId,
        },
      },
    });
  }

  if (shouldRunTaskSummary) {
    scheduleTaskSummaryGeneration({
      taskId,
      activityOnlyOwnerId: activityBody.type === "TaskDescriptionUpdate" ? null : task?.userId,
    });
  }

  return comment;
};
export default createActivity;
