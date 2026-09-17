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
import { activityAgentId } from "@/lib/agents/activityAttribution";
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

// Correctly use the interface to type the function parameters
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
      text: "", // Consider providing a meaningful text or removing this field if not needed
      taskId: taskId,
      activity: safeActivityBody as any,
      // Provenance: the acting agent is stamped on the row itself, not only
      // inside the activity JSON, so a change can be traced back to the agent
      // that made it the same way agent comments and page versions already are.
      agentId: activityAgentId(safeActivityBody),
    },
  });
  // Get the current updatedByUserIds for the task
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: { updatedByUserIds: true },
  });

  // Add fromUserId only if not already present
  const fromUserId =
    (safeActivityBody as any).data.fromUserId ??
    (safeActivityBody as any).data.fromUser?.id; // Use data.fromUserId if available, otherwise use fromUser.id
  if (fromUserId && !task?.updatedByUserIds?.includes(fromUserId)) {
    await client.task.update({
      where: { id: taskId },
      data: {
        updatedAt: new Date(),
        updatedByUserIds: {
          push: fromUserId, // Use data.fromUserId if available, otherwise use fromUserId
        },
      },
    });
  }

  if (shouldRunTaskSummary) {
    scheduleTaskSummaryGeneration({
      taskId,
    });
  }

  return comment;
};
export default createActivity;
