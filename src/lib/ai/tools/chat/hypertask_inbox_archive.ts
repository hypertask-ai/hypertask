import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskInboxArchiveTool(context: ChatToolContext) {
  const { broadcastInboxChange, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Archive one or more of the authenticated user's inbox notifications.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_archive");
        // The inbox shows one row per task, so archiving a row has to take its
        // siblings with it or the task reappears and the archive looks broken.
        // The UI route deletes those siblings; archiving them instead keeps the
        // task out of the inbox without destroying notifications nobody asked
        // to lose.
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
              // An owned agent's notifications carry the owner's userId, so
              // without this the user's archive would empty their agent's inbox.
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
    });
}
