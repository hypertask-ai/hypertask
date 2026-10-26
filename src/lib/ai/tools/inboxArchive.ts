import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8045_INBOX_BATCHES_FLAG } from "@/lib/flags/definitions/htpr-8045-inbox-batches";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { inboxListCoversBatch } from "./inboxListReceipt";
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
        "Archive inbox notifications. When inbox_list supplies list_tokens, archive a listed batch: first call with notification_ids, list_tokens from inbox_list, and confirmed=false. Show every previewed ticket, including sibling notifications, then ask once. After the user says yes in a NEW message, repeat the exact batch with confirmed=true. A changed batch is refused with a fresh preview. Report every archived ticket and the exact archived_count from the result.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
        list_tokens: z.array(z.string().uuid()).optional(),
        confirmed: z.boolean().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_archive");
        if (await isFeatureEnabled(HTPR_8045_INBOX_BATCHES_FLAG, user.id)) {
          const ids = [...new Set(input.notification_ids)].sort((left, right) => left - right);
          if (!await inboxListCoversBatch(user.id, context.confirmationSessionId, input.list_tokens ?? [], ids)) {
            return { success: false, error: "List this exact batch again and supply its list_tokens. Nothing was archived." };
          }
          const result = await prisma.$transaction(async (tx) => {
            const scope = { userId: user.id, agentId: context.actingAgentId, status: "Normal", archivedAt: null } satisfies Prisma.NotificationWhereInput;
            const selected = await tx.notification.findMany({
              where: { ...scope, id: { in: ids } },
              select: { id: true, taskId: true },
            });
            if (selected.length !== ids.length) {
              return { success: false, error: "The listed batch changed. List it again. Nothing was archived." };
            }
            const taskIds = selected.flatMap(({ taskId }) => taskId === null ? [] : [taskId]);
            const batch = await tx.notification.findMany({
              where: { ...scope, OR: [{ id: { in: ids } }, { taskId: { in: taskIds } }] },
              select: {
                id: true, taskId: true, type: true, createdAt: true, message: true,
                comment: { select: { id: true, text: true } },
                task: { select: { id: true, title: true, ticketNumber: true, projectId: true, uniqueIndex: true } },
              },
              orderBy: { id: "asc" },
            });
            const notifications = batch.map((notification) => ({
              ...notification,
              sibling: !ids.includes(notification.id),
            }));
            const outcome = await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: context.confirmationSessionId,
              operationKey: JSON.stringify(["inbox-archive", ids, batch]),
              confirmed: input.confirmed,
              previewsIssuedThisRequest: context.bulkPreviewsIssued,
            });
            if (outcome === "preview") {
              return {
                success: false,
                confirmation_required: true,
                notifications,
                notification_ids: batch.map(({ id }) => id),
                archive_count: batch.length,
                sibling_count: notifications.filter(({ sibling }) => sibling).length,
                message: "Nothing was archived. Show this entire exact batch, including siblings, and ask once. After approval in a new message, repeat the original notification_ids and list_tokens with confirmed=true. Changed batches need fresh approval.",
              };
            }
            const updated = await tx.notification.updateMany({
              where: { ...scope, id: { in: batch.map(({ id }) => id) } },
              data: { status: "Archive", archivedAt: new Date() },
            });
            if (updated.count !== batch.length) throw new Error("Inbox batch changed during archive");
            return {
              success: true,
              archived_count: updated.count,
              notifications,
              sibling_count: notifications.filter(({ sibling }) => sibling).length,
            };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          if (result.success) void broadcastInboxChange(user.id, { originUserId: user.id });
          return sanitizeForJson(result);
        }
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
