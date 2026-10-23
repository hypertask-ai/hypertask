import { PLAN_LIMIT_MESSAGE_PREFIX } from "@/lib/nativeAgent/agentMessageEnvelope";
import { Prisma } from "@prisma/client";

import { inboxConfig } from "@/lib/configs/inbox.config";

export const visibleUserInboxWhere = (
  userId: number
): Prisma.NotificationWhereInput => ({
  status: "Normal",
  archivedAt: null,
  userId,
  agentId: null,
  NOT: {
    fromUserId: userId,
    fromAgentId: null,
    type: { in: inboxConfig.selfTriggeredHidden },
  },
  OR: [
    {
      AND: [
        {
          OR: [
            { task: { status: "Normal" } },
            { task: { status: "Archive" }, returnedFromReminders: true },
          ],
        },
        {
          OR: [
            {
              task: {
                Reminders: {
                  every: {
                    status: { not: "Normal" },
                  },
                },
              },
            },
            { taskId: null },
          ],
        },
        {
          task: {
            project: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId, agentId: null } } },
              ],
            },
          },
        },
      ],
    },
    {
      type: "AgentMessage",
      message: { startsWith: PLAN_LIMIT_MESSAGE_PREFIX },
      project: { ownerId: userId },
    },
  ],
});
