import { webhookCredentialAllows } from "@/lib/webhooks/credentialScope";
import prisma from '@/lib/prisma'
import { postSignedWebhook } from './delivery'
import {
  BOARD_WEBHOOK_MAX_ATTEMPTS,
  BOARD_WEBHOOK_RETRY_DELAYS_SECONDS,
} from './events'
import { queueBoardWebhookDelivery } from './queue'

export { BOARD_WEBHOOK_MAX_ATTEMPTS } from './events'
const PROCESSING_LEASE_MS = 5 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function boardWebhookRetryDelaySeconds(
  attemptCount: number
): number | null {
  if (attemptCount >= BOARD_WEBHOOK_MAX_ATTEMPTS) return null
  return BOARD_WEBHOOK_RETRY_DELAYS_SECONDS[attemptCount] ?? null
}

export type BoardWebhookAttemptResult =
  | { status: 'skipped' }
  | { status: 'delivered'; statusCode: number }
  | {
      status: 'retrying' | 'failed'
      statusCode: number | null
      error: string | null
    }

export async function deliverBoardWebhook(
  deliveryId: string
): Promise<BoardWebhookAttemptResult> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS)
  const claimed = await prisma.boardWebhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: { in: ['pending', 'retrying', 'processing'] },
      attemptCount: { lt: BOARD_WEBHOOK_MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }],
    },
    data: { status: 'processing', processingAt: now },
  })
  if (claimed.count === 0) return { status: 'skipped' }

  const delivery = await prisma.boardWebhookDelivery.findFirst({
    where: { id: deliveryId, processingAt: now },
    include: { subscription: true },
  })
  if (!delivery) return { status: 'skipped' }

  if (!delivery.subscription.active || !await webhookCredentialAllows(delivery.subscription.agentId, delivery.payloadBody ?? delivery.payload, delivery.subscription)) {
    await prisma.boardWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'cancelled', processingAt: null },
    })
    return { status: 'skipped' }
  }

  const result = await postSignedWebhook({
    url: delivery.subscription.url,
    secret: delivery.subscription.secret,
    event: delivery.event,
    deliveryId: delivery.id,
    body: delivery.payloadBody ?? JSON.stringify(delivery.payload),
  })
  const attemptCount = delivery.attemptCount + 1

  if (result.ok) {
    const deliveredAt = new Date()
    await prisma.$transaction(async (tx) => {
      const fenced = await tx.boardWebhookDelivery.updateMany({
        where: { id: delivery.id, processingAt: now },
        data: {
          status: 'delivered',
          attemptCount,
          processingAt: null,
          lastAttemptAt: deliveredAt,
          statusCode: result.statusCode,
          error: null,
          deliveredAt,
        },
      })
      if (fenced.count === 0) return
      await tx.boardWebhookAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber: attemptCount,
          statusCode: result.statusCode,
          durationMs: result.durationMs,
        },
      })
      await tx.webhookSubscription.update({
        where: { id: delivery.subscriptionId },
        data: { lastDeliveryAt: deliveredAt, lastDeliveryOk: true },
      })
    })
    return { status: 'delivered', statusCode: result.statusCode! }
  }

  const nextDelay = boardWebhookRetryDelaySeconds(attemptCount)
  const failedPermanently = nextDelay == null
  const failedAt = new Date()
  const nextAttemptAt = new Date(failedAt.getTime() + (nextDelay ?? 0) * 1000)
  await prisma.$transaction(async (tx) => {
    const fenced = await tx.boardWebhookDelivery.updateMany({
      where: { id: delivery.id, processingAt: now },
      data: {
        status: failedPermanently ? 'failed' : 'retrying',
        attemptCount,
        processingAt: null,
        lastAttemptAt: failedAt,
        nextAttemptAt,
        statusCode: result.statusCode,
        error: result.error,
      },
    })
    if (fenced.count === 0) return
    await tx.boardWebhookAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: attemptCount,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        error: result.error,
      },
    })
    await tx.webhookSubscription.update({
      where: { id: delivery.subscriptionId },
      data: { lastDeliveryAt: failedAt, lastDeliveryOk: false },
    })
  })

  if (failedPermanently) {
    console.error(
      `[board-webhook] delivery failed after ${attemptCount} attempts (${result.statusCode ? `HTTP ${result.statusCode}` : 'no response'})`
    )
  } else {
    await queueBoardWebhookDelivery(
      delivery.id,
      Math.floor(nextAttemptAt.getTime() / 1000)
    ).catch((error) => {
      console.warn(
        '[board-webhook] retry queue publish failed; sweep will retry',
        error
      )
    })
  }

  return {
    status: failedPermanently ? 'failed' : 'retrying',
    statusCode: result.statusCode,
    error: result.error,
  }
}

export async function sweepBoardWebhookDeliveries(limit = 100): Promise<number> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS)
  await prisma.boardWebhookDelivery.deleteMany({
    where: {
      status: { in: ['delivered', 'failed', 'cancelled'] },
      createdAt: { lt: new Date(now.getTime() - RETENTION_MS) },
    },
  })
  await prisma.boardWebhookDelivery.updateMany({
    where: { status: 'processing', processingAt: { lt: staleBefore } },
    data: {
      status: 'retrying',
      processingAt: null,
      nextAttemptAt: now,
      attemptCount: { increment: 1 },
    },
  })
  const exhausted = await prisma.boardWebhookDelivery.updateMany({
    where: {
      status: { in: ['pending', 'retrying'] },
      attemptCount: { gte: BOARD_WEBHOOK_MAX_ATTEMPTS },
    },
    data: { status: 'failed', processingAt: null },
  })
  for (let i = 0; i < exhausted.count; i++) {
    console.error('[board-webhook] delivery failed after its worker stopped (no response)')
  }

  const due = await prisma.boardWebhookDelivery.findMany({
    where: {
      status: { in: ['pending', 'retrying'] },
      nextAttemptAt: { lte: now },
    },
    select: { id: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  })
  const results = await Promise.allSettled(
    due.map(({ id }) => queueBoardWebhookDelivery(id))
  )
  return results.filter((result) => result.status === 'fulfilled').length
}
