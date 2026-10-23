import prisma from "@/lib/prisma";
import { autoAssignForSection } from "@/utils/controllers/assignees/autoAssignForSection";
import {
  ensurePendingAgentTaskCreatedWebhook,
  emitAgentTaskCreatedWebhook,
  markAgentTaskCreatedReady,
  type AgentWebhookActorInput,
} from "./outbox";

export type AgentTaskCreatedRecoveryResult =
  | "recovered"
  | "not-pending"
  | "pending";

const pendingTaskSelect = {
  projectId: true,
  sectionId: true,
  userId: true,
  agentId: true,
  agentTaskCreatedReadyAt: true,
} as const;

export async function recoverPendingAgentTaskCreatedWebhook(
  taskId: number,
  actor?: AgentWebhookActorInput,
): Promise<AgentTaskCreatedRecoveryResult> {
  const currentTask = await prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "Task"
      WHERE "id" = ${taskId}
        AND "agentTaskCreatedPendingAt" IS NOT NULL
        AND "agentTaskCreatedEmittedAt" IS NULL
      FOR UPDATE
    `;
    if (claimed.length === 0) return null;
    return tx.task.findFirst({
      where: {
        id: taskId,
        agentTaskCreatedPendingAt: { not: null },
        agentTaskCreatedEmittedAt: null,
      },
      select: pendingTaskSelect,
    });
  });
  if (!currentTask) return "not-pending";

  if (currentTask.agentTaskCreatedReadyAt == null) {
    const autoAssigned = await autoAssignForSection({
      taskId,
      projectId: currentTask.projectId,
      sectionId: currentTask.sectionId,
      currentUserId: currentTask.userId,
      agentAssignerId: currentTask.agentId,
    });
    if (autoAssigned === "pending") {
      console.warn("[agent-webhook] pending task.created auto-assignment remains pending", {
        taskId,
      });
      await ensurePendingAgentTaskCreatedWebhook(taskId);
      return "pending";
    }
    await markAgentTaskCreatedReady(taskId);
  }

  await emitAgentTaskCreatedWebhook({
    taskId,
    ...(actor ? { actor } : {}),
  });
  return "recovered";
}

export async function sweepPendingAgentTaskCreatedWebhooks(limit = 100): Promise<number> {
  const pending = await prisma.task.findMany({
    where: {
      agentTaskCreatedPendingAt: { not: null },
      agentTaskCreatedEmittedAt: null,
    },
    select: { id: true },
    orderBy: { agentTaskCreatedPendingAt: "asc" },
    take: limit,
  });

  let recovered = 0;
  for (const task of pending) {
    try {
      if (
        (await recoverPendingAgentTaskCreatedWebhook(task.id)) === "recovered"
      ) {
        recovered += 1;
      }
    } catch (error) {
      console.warn("[agent-webhook] pending task.created recovery failed", {
        taskId: task.id,
        error,
      });
    }
  }

  return recovered;
}
