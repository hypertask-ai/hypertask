import prisma from '@/lib/prisma'
import { postSignedWebhook } from './delivery'
import { queueBoardWebhookDelivery } from './queue'

export const BOARD_WEBHOOK_MAX_ATTEMPTS = 6
// Sixty times the sender's own 5s AbortSignal.timeout in delivery.ts, so a slow
// POST cannot outlive its claim and let a second worker send the same delivery.
// Keep this above DELIVERY_TIMEOUT_MS if that timeout is ever raised.
const PROCESSING_LEASE_MS = 5 * 60 * 1000
const RETRY_DELAYS_SECONDS = [0, 30, 2 * 60, 5 * 60, 10 * 60, 30 * 60] as const
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function boardWebhookRetryDelaySeconds(
  attemptCount: number
): number | null {
  if (attemptCount >= BOARD_WEBHOOK_MAX_ATTEMPTS) return null
  return RETRY_DELAYS_SECONDS[attemptCount] ?? null
}

export type BoardWebhookAttemptResult =
  | { status: 'skipped' }
  | { status: 'delivered'; statusCode: number }
  | {
      status: 'retrying' | 'failed'
      statusCode: number | null
      error: string | null
    }

/**
 * Attempt one board webhook delivery (HTPR-4530).
 *
 * The row is claimed with a conditional updateMany, so two overlapping QStash
 * messages for the same id cannot both POST. Retries are scheduled explicitly
 * rather than relying on QStash's own retry, which keeps one attempt in flight
 * at a time and keeps the backoff visible in the delivery row.
 */
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

  // Re-read through the lease token as well as the id: a sweep can reclaim a
  // stale claim between the update above and this read, and a worker that no
  // longer owns the row must not go on to POST it.
  const delivery = await prisma.boardWebhookDelivery.findFirst({
    where: { id: deliveryId, processingAt: now },
    include: { subscription: true },
  })
  if (!delivery) return { status: 'skipped' }

  if (!delivery.subscription.active) {
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
      // processingAt is this worker's lease token: if a sweep reclaimed the
      // row mid-flight, the timestamp no longer matches and this write is a
      // no-op instead of overwriting the current attempt.
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
      // The subscription health follows the same fence. A reclaimed worker
      // reporting its own outcome would otherwise overwrite the result of the
      // attempt that actually owns the row.
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

  if (!failedPermanently) {
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

/** Republish due rows stranded by a QStash publish failure, and prune history. */
export async function sweepBoardWebhookDeliveries(limit = 100): Promise<number> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS)
  await prisma.boardWebhookDelivery.deleteMany({
    where: {
      status: { in: ['delivered', 'failed', 'cancelled'] },
      createdAt: { lt: new Date(now.getTime() - RETENTION_MS) },
    },
  })
  // A worker that claimed a row may have POSTed before dying, so the abandoned
  // attempt still counts against the limit. Without this increment, a crash
  // loop after a successful POST would redeliver the same event forever.
  await prisma.boardWebhookDelivery.updateMany({
    where: { status: 'processing', processingAt: { lt: staleBefore } },
    data: {
      status: 'retrying',
      processingAt: null,
      nextAttemptAt: now,
      attemptCount: { increment: 1 },
    },
  })
  await prisma.boardWebhookDelivery.updateMany({
    where: {
      status: { in: ['pending', 'retrying'] },
      attemptCount: { gte: BOARD_WEBHOOK_MAX_ATTEMPTS },
    },
    data: { status: 'failed', processingAt: null },
  })

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
