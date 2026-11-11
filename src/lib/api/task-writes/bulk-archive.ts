import { NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { taskWriteRoute } from "./route";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9066_BULK_ARCHIVE_FLAG } from "@/lib/flags/definitions/htpr-9066-bulk-archive";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { lockAgentMutationFence } from "@/lib/mcp/tasks/agentMutationFence";
import { cancelDueDateJob } from "@/pages/api/queues/duedateQueue";
import { spawnNextRecurrence } from "@/utils/controllers/tasks/spawnRecurrence";
import { upsertTaskToTurbopuffer, upsertAllCommentsToTurbopuffer } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { broadcastInboxForTask } from "@/utils/controllers/notifications/broadcastInboxForTask";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { persistBoardWebhookEvent, publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import { persistAgentTaskUpdatedWebhook, publishAgentWebhookDeliveries } from "@/lib/agentWebhooks/outbox";
import type { WebhookTaskChanges } from "@/lib/mcp/webhooks/events";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";

const positiveId = z.number().int().positive();
export const POST = taskWriteRoute({
  schema: z.object({ ids: z.array(positiveId).min(1).max(500), projectId: positiveId, agentId: z.string().optional() }),
  validationMessage: "Invalid archive request",
  operation: async ({ ids, projectId, agentId }, session) => {
    if (!await isFeatureEnabled(HTPR_9066_BULK_ARCHIVE_FLAG, session.userId)) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    if (session.agentId || agentId) {
      return NextResponse.json({ message: "Use the agent archive endpoint" }, { status: 403 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, displayName: true, photoURL: true, email: true },
    });
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const selected = [...new Set(ids)].sort((a, b) => a - b);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const where = { id: { in: selected }, projectId, project: taskWriteAccessWhere(session.userId, null, session.teamScope) };
        const candidates = await tx.task.findMany({ where, select: { id: true } });
        for (const task of candidates.sort((a, b) => a.id - b.id)) {
          await lockAgentMutationFence(tx, task.id);
        }
        const tasks = await tx.task.findMany({ where: { ...where, status: { in: ["Normal", "Archive"] } } });
        const changed = tasks.filter((task) => task.status === "Normal");
        const changedIds = changed.map((task) => task.id);
        await tx.taskLease.deleteMany({ where: { taskId: { in: changedIds } } });
        const now = new Date();
        await tx.task.updateMany({
          where: { ...where, id: { in: changedIds }, status: "Normal" },
          data: { status: "Archive", archivedAt: now, deletedAt: null, updatedAt: now, dueDate: null },
        });
        await tx.task.updateMany({
          where: { id: { in: changedIds }, NOT: { updatedByUserIds: { has: user.id } } },
          data: { updatedByUserIds: { push: user.id } },
        });
        await tx.comment.createMany({ data: changed.map((task) => ({
          taskId: task.id, text: "", activity: { type: "TaskArchive", data: {
            fromUserId: user.id, fromUserDisplayName: user.displayName, fromUser: user, fromAgent: null, newStatus: "Archive",
          } },
        })) });
        return { tasks, changed };
      }, { timeout: 30_000 });
      const archivedIds = result.tasks.map((task) => task.id);
      const archived = new Set(archivedIds);
      waitUntil((async () => {
        await broadcastBoardChange(projectId, { originUserId: user.id }).catch((error) => console.error("Bulk archive broadcast failed", error));
        for (let offset = 0; offset < result.changed.length; offset += 5) {
          await Promise.all(result.changed.slice(offset, offset + 5).map(async (task) => {
            const changes: WebhookTaskChanges = { status: { from: task.status, to: "Archive" } };
            const actor = { userId: user.id, agentId: null, displayName: user.displayName };
            const work = [
              cancelDueDateJob(task.id, projectId),
              broadcastInboxForTask(task.id),
              broadcastTaskChange(task.id, { originUserId: user.id }),
              sendNotificationForTask(user.id, "TaskArchived", task.id, projectId, null),
              upsertTaskToTurbopuffer(task.id, { strict: true }),
              upsertAllCommentsToTurbopuffer(task.id, { strict: true }),
              scheduleTaskSummaryGeneration({ taskId: task.id, ownerUserId: task.userId, activityOnlyOwnerId: task.userId }),
              persistBoardWebhookEvent(prisma, projectId, { event: "task.updated", data: {
                task: { id: task.id, ticketNumber: task.ticketNumber, projectId, title: task.title },
                changes: { ...changes, ...(task.dueDate ? { dueDate: { from: task.dueDate.toISOString(), to: null } } : {}) }, actor,
              } }).then(publishBoardWebhookDeliveries),
              persistAgentTaskUpdatedWebhook(prisma, { taskId: task.id, actor, changes }).then(publishAgentWebhookDeliveries),
              ...(task.recurrence ? [spawnNextRecurrence(task.id, task.dueDate, user.id, null)] : []),
            ];
            const outcomes = await Promise.allSettled(work);
            for (const outcome of outcomes) if (outcome.status === "rejected") console.error("Bulk archive follow-up failed", task.id, outcome.reason);
          }));
        }
      })().catch((error) => console.error("Bulk archive follow-ups failed", error)));
      return NextResponse.json({ archivedIds, failedIds: selected.filter((id) => !archived.has(id)) });
    } catch (error) {
      console.error("Bulk archive failed", error);
      return NextResponse.json({ message: "No tickets were archived. Try again." }, { status: 500 });
    }
  },
});
