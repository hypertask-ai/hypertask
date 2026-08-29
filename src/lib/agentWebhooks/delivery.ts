import prisma from "@/lib/prisma";
import { postSignedWebhook } from "@/lib/mcp/webhooks/delivery";
import { queueAgentWebhookDelivery } from "./queue";

export const AGENT_WEBHOOK_MAX_ATTEMPTS = 4;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAYS_SECONDS = [0, 30, 5 * 60, 30 * 60] as const;

export function agentWebhookRetryDelaySeconds(attemptCount: number): number | null {
  if (attemptCount >= AGENT_WEBHOOK_MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_SECONDS[attemptCount] ?? null;
}

export type AgentWebhookAttemptResult =
  | { status: "skipped" }
  | { status: "delivered"; statusCode: number }
  | { status: "retrying" | "failed"; statusCode: number | null; error: string | null };

export async function deliverAgentWebhook(
  deliveryId: string,
): Promise<AgentWebhookAttemptResult> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const claimed = await prisma.agentWebhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: { in: ["pending", "retrying", "processing"] },
      nextAttemptAt: { lte: now },
      OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }],
    },
    data: { status: "processing", processingAt: now },
  });
  if (claimed.count === 0) return { status: "skipped" };

  const delivery = await prisma.agentWebhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        include: { agent: { select: { revokedAt: true } } },
      },
    },
  });
  if (!delivery) return { status: "skipped" };

  if (
    !delivery.subscription.active ||
    delivery.subscription.agent.revokedAt != null
  ) {
    await prisma.agentWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "cancelled", processingAt: null },
    });
    return { status: "skipped" };
  }

  const result = await postSignedWebhook({
    url: delivery.subscription.url,
    secret: delivery.subscription.secret,
    event: delivery.event,
    deliveryId: delivery.id,
    body: JSON.stringify(delivery.payload),
  });
  const attemptCount = delivery.attemptCount + 1;

  if (result.ok) {
    const deliveredAt = new Date();
    await prisma.$transaction([
      prisma.agentWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "delivered",
          attemptCount,
          processingAt: null,
          lastAttemptAt: deliveredAt,
          statusCode: result.statusCode,
          error: null,
          deliveredAt,
        },
      }),
      prisma.agentWebhookSubscription.update({
        where: { id: delivery.subscriptionId },
        data: { lastDeliveryAt: deliveredAt, lastDeliveryOk: true },
      }),
    ]);
    return { status: "delivered", statusCode: result.statusCode! };
  }

  const nextDelay = agentWebhookRetryDelaySeconds(attemptCount);
  const failedPermanently = nextDelay == null;
  const nextAttemptAt = new Date(Date.now() + (nextDelay ?? 0) * 1000);
  await prisma.$transaction([
    prisma.agentWebhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: failedPermanently ? "failed" : "retrying",
        attemptCount,
        processingAt: null,
        lastAttemptAt: new Date(),
        nextAttemptAt,
        statusCode: result.statusCode,
        error: result.error,
      },
    }),
    prisma.agentWebhookSubscription.update({
      where: { id: delivery.subscriptionId },
      data: { lastDeliveryAt: new Date(), lastDeliveryOk: false },
    }),
  ]);

  if (!failedPermanently) {
    await queueAgentWebhookDelivery(
      delivery.id,
      Math.floor(nextAttemptAt.getTime() / 1000),
    ).catch((error) => {
      console.warn("[agent-webhook] retry queue publish failed; sweep will retry", error);
    });
  }

  return {
    status: failedPermanently ? "failed" : "retrying",
    statusCode: result.statusCode,
    error: result.error,
  };
}

/** Republish due rows that were stranded by a QStash publish failure. */
export async function sweepAgentWebhookDeliveries(limit = 100): Promise<number> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const retentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await prisma.agentWebhookDelivery.deleteMany({
    where: {
      status: { in: ["delivered", "failed", "cancelled"] },
      createdAt: { lt: retentionCutoff },
    },
  });
  await prisma.agentWebhookDelivery.updateMany({
    where: { status: "processing", processingAt: { lt: staleBefore } },
    data: { status: "retrying", processingAt: null, nextAttemptAt: now },
  });

  const due = await prisma.agentWebhookDelivery.findMany({
    where: {
      status: { in: ["pending", "retrying"] },
      nextAttemptAt: { lte: now },
    },
    select: { id: true },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  const results = await Promise.allSettled(
    due.map(({ id }) => queueAgentWebhookDelivery(id)),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}
