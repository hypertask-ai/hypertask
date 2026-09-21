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

/** Retry one task.created handoff that survived task creation. */
export async function recoverPendingAgentTaskCreatedWebhook(
  taskId: number,
  actor?: AgentWebhookActorInput,
): Promise<AgentTaskCreatedRecoveryResult> {
  // Lock the pending row while taking the recovery snapshot. The assignment
  // controller then rechecks project, section, and status under its mutation
  // fence, and the emitter rechecks the pending markers before writing rows.
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
    // autoAssignForSection re-reads the task under its assignment fence. The
    // ready marker is written only after that work commits, so a concurrent
    // sweep cannot emit a partial task.created snapshot.
    const autoAssigned = await autoAssignForSection({
      taskId,
      projectId: currentTask.projectId,
      sectionId: currentTask.sectionId,
      currentUserId: currentTask.userId,
      agentAssignerId: currentTask.agentId,
    });
    if (autoAssigned === "pending") {
      // Do not emit an incomplete task.created payload. The minute sweep keeps
      // this marker pending and retries the assignment before emitting it.
      console.warn("[agent-webhook] pending task.created auto-assignment remains pending", {
        taskId,
      });
      await ensurePendingAgentTaskCreatedWebhook(taskId);
      return "pending";
    }
    await markAgentTaskCreatedReady(taskId);
  }

  // The emitter takes the task row lock and checks both markers in the same
  // transaction. There is no separate check here that could go stale before
  // emission, so concurrent recovery workers cannot duplicate the event.
  await emitAgentTaskCreatedWebhook({
    taskId,
    ...(actor ? { actor } : {}),
  });
  return "recovered";
}

/** Retry task.created handoffs that survived task creation but not post-create work. */
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
