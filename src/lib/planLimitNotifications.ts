import { createHash } from "node:crypto";
import { agentMessageMarker, encodeAgentMessage } from "@/lib/nativeAgent/agentMessageEnvelope";
import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";
import type { PlanLimitReachedError } from "@/lib/planLimits";

export async function notifyPlanLimitOwner({
  projectId,
  taskId = null,
  title,
  sourceKey,
  actorUserId,
  error,
}: {
  projectId: number;
  taskId?: number | null;
  title: string;
  sourceKey?: string;
  actorUserId: number;
  error: PlanLimitReachedError;
}): Promise<void> {
  try {
    const key = `plan-limit-notification:${projectId}:${taskId ?? sourceKey ?? title}:${error.limit}`;
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const markerId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
    const message = encodeAgentMessage(markerId, `Could not create the next ticket for "${title}": ${error.message}`);
    const notifiedOwner = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${digest}))`;
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true } });
      const existing = await tx.notification.findFirst({
        where: {
          projectId,
          taskId,
          userId: project.ownerId,
          type: "AgentMessage",
          message: { startsWith: agentMessageMarker(markerId) },
        },
        select: { id: true },
      });
      if (existing) return null;
      await tx.notification.create({
        data: {
          userId: project.ownerId,
          fromUserId: actorUserId,
          projectId,
          taskId,
          type: "AgentMessage",
          message,
        },
      });
      return project.ownerId;
    });
    if (notifiedOwner != null) await broadcastInboxChange(notifiedOwner);
  } catch (notificationError) {
    console.warn("[plan-limit] owner notification failed", { projectId, taskId, notificationError });
  }
}
