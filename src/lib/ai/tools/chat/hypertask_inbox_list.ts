import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskInboxListTool(context: ChatToolContext) {
  const { actingAgentId, buildCollectionMetadata, getStructuredInboxForAgent, heartbeatTurn, isNotificationInHeartbeatWindow, notificationGetAll, notificationInboxInclude, prisma, sanitizeForJson, sendStatus, tool, user, z } = context;
  return tool({
      description:
        "Return inbox notifications that mirror the app inbox view for the authenticated user, with total and truncated metadata. Set archived=true to list archived inbox notifications.",
      inputSchema: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        archived: z.boolean().default(false),
      }),
      execute: async (input) => {
        sendStatus("hypertask_inbox_list");
        if (actingAgentId) {
          if (input.archived) {
            return {
              success: false,
              error: "Archived inbox items are not available to agents.",
            };
          }
          const agentInbox = await getStructuredInboxForAgent({
            userId: user.id,
            agentId: actingAgentId,
            ...(heartbeatTurn
              ? {
                  window: {
                    after: heartbeatTurn.previousHeartbeatAt
                      ? new Date(heartbeatTurn.previousHeartbeatAt)
                      : null,
                    through: new Date(heartbeatTurn.scanWatermark),
                  },
                }
              : {}),
          });
          if (!agentInbox.ok) {
            return { success: false, error: "Failed to load agent inbox" };
          }
          const boundedNotifications = heartbeatTurn
            ? agentInbox.notifications.filter((notification) =>
                isNotificationInHeartbeatWindow(
                  notification.createdAt,
                  heartbeatTurn.previousHeartbeatAt,
                  heartbeatTurn.scanWatermark,
                )
              )
            : agentInbox.notifications;
          const visibleNotifications = boundedNotifications.slice(
            0,
            input.limit
          );
          return sanitizeForJson({
            success: true,
            user_notifications: visibleNotifications,
            ...buildCollectionMetadata(
              boundedNotifications.length,
              visibleNotifications.length
            ),
          });
        }
        if (input.archived) {
          const where: Prisma.NotificationWhereInput = {
            userId: user.id,
            agentId: null,
            archivedAt: { not: null },
            status: { not: "Deleted" },
          };
          const [total, notifications] = await Promise.all([
            prisma.notification.count({ where }),
            prisma.notification.findMany({
              include: notificationInboxInclude(user.id),
              where,
              orderBy: {
                archivedAt: { sort: "desc", nulls: "last" },
              },
              take: input.limit,
            }),
          ]);

          return sanitizeForJson({
            success: true,
            user_notifications: notifications,
            ...buildCollectionMetadata(total, notifications.length),
          });
        }

        const { status, json } = await notificationGetAll(user.id.toString());
        if (status !== 200 || !json || typeof json !== "object") {
          return { success: false, error: "Failed to load inbox" };
        }
        const payload = json as { notifications?: unknown[]; structuredData?: unknown };
        const notifications = payload.notifications ?? [];
        const visibleNotifications = notifications.slice(0, input.limit);
        return sanitizeForJson({
          success: true,
          user_notifications: visibleNotifications,
          ...buildCollectionMetadata(
            notifications.length,
            visibleNotifications.length
          ),
        });
      },
    });
}
