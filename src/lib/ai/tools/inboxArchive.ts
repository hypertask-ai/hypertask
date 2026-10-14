import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createInboxArchiveTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_inbox_archive: tool({
      description:
        "Archive one or more of the authenticated user's inbox notifications.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_archive");
        const notifications = await prisma.notification.findMany({
          where: { id: { in: input.notification_ids }, userId: user.id },
          select: { taskId: true },
        });
        const taskIds = notifications
          .map((notification) => notification.taskId)
          .filter((taskId): taskId is number => taskId !== null);

        const archivedAt = new Date();
        if (taskIds.length) {
          await prisma.notification.updateMany({
            where: {
              id: { notIn: input.notification_ids },
              taskId: { in: taskIds },
              userId: user.id,
              agentId: null,
              status: "Normal",
            },
            data: { status: "Archive", archivedAt },
          });
        }

        const result = await prisma.notification.updateMany({
          where: { id: { in: input.notification_ids }, userId: user.id },
          data: { status: "Archive", archivedAt },
        });

        void broadcastInboxChange(user.id, { originUserId: user.id });

        return sanitizeForJson({ success: true, archived_count: result.count });
      }),
    }),
  };
}
