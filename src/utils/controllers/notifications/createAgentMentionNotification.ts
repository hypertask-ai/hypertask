import prisma from "@/lib/prisma";
import checkReminderAndCreateNotification from "./creation-service/check-reminder_create-notification";

export interface CreateAgentMentionNotificationParams {
  agentId: string;
  taskId: number;
  projectId: number;
  mentionedBy: number;
  commentId?: number;
  fromAgentId?: string | null;
}

export async function createAgentMentionNotification(
  params: CreateAgentMentionNotificationParams
): Promise<void> {
  const { agentId, taskId, projectId, mentionedBy, commentId, fromAgentId } =
    params;

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      revokedAt: null,
      OR: [
        { userId: mentionedBy },
        {
          visibility: "TEAM",
          members: { some: { projectId } },
        },
      ],
    },
    select: { id: true, userId: true },
  });

  if (!agent) return;

  await checkReminderAndCreateNotification(agent.userId, projectId, taskId, {
    type: "Mentioned",
    taskId,
    projectId,
    userId: agent.userId,
    agentId: agent.id,
    fromUserId: mentionedBy,
    ...(commentId != null ? { commentId } : {}),
    ...(fromAgentId ? { fromAgentId } : {}),
  });
}
