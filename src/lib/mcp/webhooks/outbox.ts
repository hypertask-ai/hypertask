import crypto from 'crypto'
import type { WebhookDelivery } from './events'
import { createWebhookEnvelope } from './events'
import { queueBoardWebhookDelivery } from './queue'

/**
 * Structural, not Prisma-generated: the same functions run against the root
 * client (events with no domain transaction of their own) and against an
 * interactive transaction client, whose delegate types are not interchangeable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type BoardWebhookDb = {
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The root client, which can open its own transaction. */
type BoardWebhookRootDb = BoardWebhookDb & {
  $transaction: <T>(fn: (tx: BoardWebhookDb) => Promise<T>) => Promise<T>
}

/**
 * Persist one board event as outbox rows inside the caller's domain transaction
 * (HTPR-4530). Returns the delivery ids to publish once that transaction has
 * committed. A row that is never published stays due and the sweep republishes
 * it, so a QStash outage delays delivery instead of dropping the event.
 *
 * An empty `events` array on a subscription means "every event", matching the
 * registration contract in /api/mcp/webhooks.
 */
export async function persistBoardWebhookEvent(
  tx: BoardWebhookDb,
  projectId: number,
  delivery: WebhookDelivery
): Promise<string[]> {
  const subscriptions: Array<{ id: string }> =
    await tx.webhookSubscription.findMany({
      where: {
        projectId,
        active: true,
        OR: [
          { events: { isEmpty: true } },
          { events: { has: delivery.event } },
        ],
      },
      select: { id: true },
    })
  if (subscriptions.length === 0) return []

  const occurredAt = new Date().toISOString()
  const deliveryIds: string[] = []
  for (const subscription of subscriptions) {
    const deliveryId = crypto.randomUUID()
    // Freeze the exact wire body now. Every retry then re-sends identical bytes
    // under the same delivery id, which is what makes receiver-side dedup work.
    const envelope = createWebhookEnvelope(delivery, {
      id: deliveryId,
      deliveredAt: occurredAt,
    })
    await tx.boardWebhookDelivery.create({
      data: {
        id: deliveryId,
        subscriptionId: subscription.id,
        event: delivery.event,
        payload: envelope,
      },
    })
    deliveryIds.push(deliveryId)
  }
  return deliveryIds
}

/** Persist related domain events through the same transaction client. */
export async function persistBoardWebhookEvents(
  tx: BoardWebhookDb,
  projectId: number,
  deliveries: WebhookDelivery[]
): Promise<string[]> {
  const deliveryIds: string[] = []
  for (const delivery of deliveries) {
    deliveryIds.push(
      ...(await persistBoardWebhookEvent(tx, projectId, delivery))
    )
  }
  return deliveryIds
}

/** Publish only after the transaction commits; a failure remains sweepable. */
export async function publishBoardWebhookDeliveries(
  deliveryIds: string[]
): Promise<void> {
  await Promise.all(
    deliveryIds.map((deliveryId) =>
      queueBoardWebhookDelivery(deliveryId).catch((error) => {
        console.warn(
          '[board-webhook] queue publish failed; sweep will retry',
          error
        )
      })
    )
  )
}
