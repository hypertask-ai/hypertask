import { tool } from "ai";
import { z } from "zod";
import { getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";
import { isNotificationInHeartbeatWindow } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { buildCollectionMetadata } from "@/app/api/ai/chat/stream/bulkTools";
import { Prisma, type Task } from "@prisma/client";
import prisma from "@/lib/prisma";
import notificationGetAll, { notificationInboxInclude } from "@/utils/controllers/notifications/getAll";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8045_INBOX_BATCHES_FLAG } from "@/lib/flags/definitions/htpr-8045-inbox-batches";
import { recordInboxList, recordInboxCursor, readInboxCursor } from "./inboxListReceipt";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

type InboxToolRow = {
  id: number | string;
  type?: string;
  seen?: boolean;
  createdAt?: Date | string;
  message?: string | null;
  reaction?: { emoji?: string } | null;
  notification_invite?: { inviteURL?: string | null } | null;
  computedSplit?: string;
  agentOnlyTypes?: string[];
  task?: (Pick<Task, "id" | "title" | "projectId" | "uniqueIndex"> & { ticketNumber?: Task["ticketNumber"]; section?: unknown; waitingOnUserId?: number | null }) | null;
  comment?: { text?: string | null } | null;
  fromUser?: { displayName?: string | null } | null;
  fromAgent?: { displayName?: string | null } | null;
};

export function createInboxListTool(context: ToolContext) {
  const { sendStatus, actingAgentId, user, heartbeatTurn } = context;
  return {
    hypertask_inbox_list: tool({
      description:
        "Read inbox notifications without confirmation. When next_cursor is returned, pass it unchanged as cursor to continue until null, even if earlier items were archived. Request limit=500 for large passes. Keep each returned list_token to archive only listed IDs. If paging metadata is absent, this account uses the legacy first-page read. Set archived=true for archived items.",
      inputSchema: z.object({
        limit: z.coerce.number().int().min(1).max(500).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        cursor: z.object({ token: z.string().uuid(), offset: z.number().int().min(0) }).optional(),
        archived: z.boolean().default(false),
      }),
      execute: async (input) => {
        sendStatus("hypertask_inbox_list");
        const batchesEnabled = await isFeatureEnabled(HTPR_8045_INBOX_BATCHES_FLAG, user.id);
        const limit = batchesEnabled ? input.limit : Math.min(input.limit, 100);
        const offset = batchesEnabled ? (input.cursor?.offset ?? input.offset) : 0;
        const cursorIds = batchesEnabled && input.cursor
          ? await readInboxCursor(user.id, context.confirmationSessionId, input.cursor.token)
          : undefined;
        if (cursorIds === null) return { success: false, error: "Inbox cursor expired. Start a fresh read." };
        const pageResult = async (total: number, rows: InboxToolRow[]) => {
          const ids = cursorIds ?? rows.map(({ id }) => Number(id));
          const cursorToken = batchesEnabled && !input.archived
            ? input.cursor?.token ?? await recordInboxCursor(user.id, context.confirmationSessionId, ids)
            : undefined;
          const byId = new Map(rows.map((row) => [Number(row.id), row]));
          const notifications = cursorToken
            ? ids.slice(offset, offset + limit).flatMap((id) => { const row = byId.get(id); return row ? [row] : []; })
            : rows;
          const pageTotal = cursorToken ? ids.length : total;
          const nextOffset = offset + (cursorToken ? limit : notifications.length);
          return sanitizeForJson({
            success: true,
            user_notifications: batchesEnabled ? notifications.map((notification) => ({
              id: Number(notification.id),
              type: notification.type,
              seen: notification.seen,
              createdAt: notification.createdAt,
              message: notification.message,
              reaction: notification.reaction,
              notification_invite: notification.notification_invite,
              computedSplit: notification.computedSplit,
              agentOnlyTypes: notification.agentOnlyTypes,
              task: notification.task ? {
                id: notification.task.id,
                title: notification.task.title,
                ticketNumber: notification.task.ticketNumber,
                projectId: notification.task.projectId,
                uniqueIndex: notification.task.uniqueIndex,
                section: notification.task.section,
                waitingOnUserId: notification.task.waitingOnUserId,
              } : null,
              comment_text: notification.comment?.text?.slice(0, 500),
              comment_truncated: (notification.comment?.text?.length ?? 0) > 500,
              from_user: notification.fromUser?.displayName,
              from_agent: notification.fromAgent?.displayName,
            })) : notifications,
            ...buildCollectionMetadata(pageTotal, notifications.length),
            ...(batchesEnabled ? {
              offset,
              next_offset: nextOffset < pageTotal ? nextOffset : null,
              next_cursor: cursorToken && nextOffset < pageTotal ? { token: cursorToken, offset: nextOffset } : null,
              list_token: input.archived ? null : await recordInboxList(user.id, context.confirmationSessionId, notifications.map(({ id }) => Number(id)).filter((id) => id > 0)),
            } : {}),
          });
        };
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
          return pageResult(boundedNotifications.length, batchesEnabled ? boundedNotifications : boundedNotifications.slice(0, limit));
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
              orderBy: [{ archivedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
              take: limit,
              skip: offset,
            }),
          ]);

          return pageResult(total, notifications);
        }

        const { status, json } = await notificationGetAll(user.id.toString(), batchesEnabled ? { withCachedDescription: false } : undefined);
        if (status !== 200 || !json || typeof json !== "object") {
          return { success: false, error: "Failed to load inbox" };
        }
        const notifications = "notifications" in json ? json.notifications : [];
        return pageResult(notifications.length, batchesEnabled ? notifications : notifications.slice(0, limit));
      },
    }),
  };
}
