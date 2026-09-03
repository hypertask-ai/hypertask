import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import type { WebhookDelivery } from './events'
import { createWebhookEnvelope } from './events'
import { queueBoardWebhookDelivery } from './queue'

/**
 * Structural, not Prisma-generated: the same functions run against the root
 * client and interactive transaction clients.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type BoardWebhookDb = {
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function webhookPayloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function persistedDelivery(input: {
  delivery: WebhookDelivery
  deliveryId: string
  occurredAt: string
}) {
  const envelope = createWebhookEnvelope(input.delivery, {
    id: input.deliveryId,
    deliveredAt: input.occurredAt,
  })
  return {
    envelope,
    payloadBody: JSON.stringify(envelope),
    payloadHash: webhookPayloadHash(envelope.data),
  }
}

function eventForSubscription(
  delivery: WebhookDelivery,
  selectedEvents: string[],
): WebhookDelivery {
  // Before task.unassigned became independently selectable, board subscribers
  // received it as task.assigned with action=unassigned. Keep that wire contract
  // for legacy empty/all and task.assigned-only subscriptions. New subscriptions
  // that explicitly select task.unassigned receive the new event name once.
  if (
    delivery.event === 'task.unassigned' &&
    !selectedEvents.includes('task.unassigned')
  ) {
    return {
      event: 'task.assigned',
      data: delivery.data,
    }
  }
  return delivery
}

/** Persist intended recipients inside the caller's domain transaction. */
export async function persistBoardWebhookEvent(
  tx: BoardWebhookDb,
  projectId: number,
  delivery: WebhookDelivery,
): Promise<string[]> {
  const eventSelection =
    delivery.event === 'task.unassigned'
      ? [
          { events: { isEmpty: true } },
          { events: { has: 'task.unassigned' } },
          { events: { has: 'task.assigned' } },
        ]
      : [
          { events: { isEmpty: true } },
          { events: { has: delivery.event } },
        ]
  const subscriptions: Array<{ id: string; events: string[] }> =
    await tx.webhookSubscription.findMany({
      where: {
        active: true,
        AND: [
          { OR: eventSelection },
          {
            OR: [
              { projectId },
              {
                projectId: null,
                team: { projects: { some: { id: projectId } } },
              },
            ],
          },
        ],
      },
      select: { id: true, events: true },
    })
  if (subscriptions.length === 0) return []

  const occurredAt = new Date().toISOString()
  const deliveryIds: string[] = []
  for (const subscription of subscriptions) {
    const deliveryId = crypto.randomUUID()
    const stored = persistedDelivery({
      delivery: eventForSubscription(delivery, subscription.events),
      deliveryId,
      occurredAt,
    })
    await tx.boardWebhookDelivery.create({
      data: {
        id: deliveryId,
        subscriptionId: subscription.id,
        event: stored.envelope.event,
        payload: stored.envelope,
        payloadBody: stored.payloadBody,
        payloadHash: stored.payloadHash,
      },
    })
    deliveryIds.push(deliveryId)
  }
  return deliveryIds
}

export async function persistBoardWebhookEvents(
  tx: BoardWebhookDb,
  projectId: number,
  deliveries: WebhookDelivery[],
): Promise<string[]> {
  const deliveryIds: string[] = []
  for (const delivery of deliveries) {
    deliveryIds.push(
      ...(await persistBoardWebhookEvent(tx, projectId, delivery)),
    )
  }
  return deliveryIds
}

/** Publish only after the transaction commits; a failure remains sweepable. */
export async function publishBoardWebhookDeliveries(
  deliveryIds: string[],
): Promise<void> {
  await Promise.all(
    deliveryIds.map((deliveryId) =>
      queueBoardWebhookDelivery(deliveryId).catch((error) => {
        console.warn(
          '[board-webhook] queue publish failed; sweep will retry',
          error,
        )
      }),
    ),
  )
}

export async function createBoardWebhookTestDelivery(input: {
  subscriptionId: string
  projectId: number | null
}): Promise<string> {
  const deliveryId = crypto.randomUUID()
  const stored = persistedDelivery({
    delivery: {
      event: 'ping',
      data: {
        projectId: input.projectId,
        message: 'Test ping from Hypertask',
      },
    },
    deliveryId,
    occurredAt: new Date().toISOString(),
  })
  const { default: prisma } = await import('@/lib/prisma')
  await prisma.boardWebhookDelivery.create({
    data: {
      id: deliveryId,
      subscriptionId: input.subscriptionId,
      event: 'ping',
      payload: stored.envelope as unknown as Prisma.InputJsonValue,
      payloadBody: stored.payloadBody,
      payloadHash: stored.payloadHash,
    },
  })
  await publishBoardWebhookDeliveries([deliveryId])
  return deliveryId
}

/** Manual retry starts a fresh logical delivery so receiver deduplication works. */
export async function retryBoardWebhookDelivery(input: {
  deliveryId: string
  subscriptionId: string
  idempotencyKey: string
}): Promise<string | null> {
  const { default: prisma } = await import('@/lib/prisma')
  const existing = await prisma.boardWebhookDelivery.findFirst({
    where: {
      manualRetryKey: input.idempotencyKey,
      subscriptionId: input.subscriptionId,
      sourceDeliveryId: input.deliveryId,
    },
    select: { id: true },
  })
  if (existing) return existing.id

  const source = await prisma.boardWebhookDelivery.findFirst({
    where: { id: input.deliveryId, subscriptionId: input.subscriptionId },
    select: { event: true, payload: true, payloadHash: true },
  })
  if (!source) return null

  const deliveryId = crypto.randomUUID()
  const sourcePayload = source.payload as Record<string, unknown>
  const payload = {
    ...sourcePayload,
    id: deliveryId,
    deliveredAt: new Date().toISOString(),
  }
  try {
    await prisma.boardWebhookDelivery.create({
      data: {
        id: deliveryId,
        subscriptionId: input.subscriptionId,
        event: source.event,
        payload: payload as Prisma.InputJsonValue,
        payloadBody: JSON.stringify(payload),
        payloadHash:
          source.payloadHash ?? webhookPayloadHash(sourcePayload.data ?? sourcePayload),
        sourceDeliveryId: input.deliveryId,
        manualRetryKey: input.idempotencyKey,
      },
    })
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'P2002'
    ) {
      throw error
    }
    const raced = await prisma.boardWebhookDelivery.findFirst({
      where: {
        manualRetryKey: input.idempotencyKey,
        subscriptionId: input.subscriptionId,
        sourceDeliveryId: input.deliveryId,
      },
      select: { id: true },
    })
    if (!raced) throw error
    return raced.id
  }
  await publishBoardWebhookDeliveries([deliveryId])
  return deliveryId
}
