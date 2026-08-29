import prisma from "@/lib/prisma";
import { includeSenderInRecipients } from "./agentActionRecipients";
import { filterProjectMutedUserIds } from "./projectMute";

const idsToSendNotificationsTo = async (
  taskId: number,
  senderId: number,
  taskCreatorId: number,
  projectId: number,
  fromAgentId?: string | null
) => {
  const agentActed = includeSenderInRecipients(fromAgentId);

  const userIds =
    taskCreatorId === senderId && !agentActed ? [] : [taskCreatorId];

  const assigneesOfTask = await prisma.assignees.findMany({
    where: {
      taskId,
      ...(!agentActed ? { userId: { not: senderId } } : {}),
      task: {
        status: { not: "Deleted" },
      },
      agentId: null,
    },
  });

  const followersOfTask = await prisma.follower.findMany({
    where: {
      taskId,
      ...(!agentActed ? { userId: { not: senderId } } : {}),
      task: {
        status: { not: "Deleted" },
      },
      agentId: null,
    },
  });

  const combinedUserIds = [
    ...userIds,
    ...assigneesOfTask.map((x) => x.userId),
    ...followersOfTask.map((x) => x.userId),
  ].filter((id): id is number => id != null);

  const uniqueUserIds = [...new Set(combinedUserIds)];

  if (uniqueUserIds.length === 0) return uniqueUserIds;

  const [taskMutes, projectAllowedUserIds] = await Promise.all([
    prisma.taskMute.findMany({
      where: {
        taskId,
        userId: { in: uniqueUserIds },
      },
      select: { userId: true },
    }),
    filterProjectMutedUserIds(uniqueUserIds, projectId),
  ]);
  const mutedUserIds = new Set(taskMutes.map((taskMute) => taskMute.userId));

  return projectAllowedUserIds.filter((userId) => !mutedUserIds.has(userId));
};

export default idsToSendNotificationsTo;
