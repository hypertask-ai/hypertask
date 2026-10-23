import { webhookCredentialAllows } from "@/lib/webhooks/credentialScope";
import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import type { WebhookDelivery } from './events'
import { WORKSPACE_WEBHOOK_EVENTS, createWebhookEnvelope } from './events'
import { queueBoardWebhookDelivery } from './queue'


type BoardWebhookDb = Pick<Prisma.TransactionClient, "agent" | "project" | "task" | "comment" | "chatSession" | "agentRun"> & {
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}


export function webhookPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload)
  if (serialized === undefined) {
    throw new TypeError('Webhook payload must be JSON-serializable')
  }
  return crypto.createHash('sha256').update(serialized).digest('hex')
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
  supportsUnassignedEvent: boolean,
): WebhookDelivery {
  if (delivery.event === 'task.unassigned' && !supportsUnassignedEvent) {
    return {
      event: 'task.assigned',
      data: delivery.data,
    }
  }
  return delivery
}

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
          {
            AND: [
              { supportsUnassignedEvent: false },
              { events: { has: 'task.assigned' } },
            ],
          },
        ]
      : [
          { events: { isEmpty: true } },
          { events: { has: delivery.event } },
        ]
  const scopes: Prisma.WebhookSubscriptionWhereInput[] = [{ projectId }]
  if (
    (WORKSPACE_WEBHOOK_EVENTS as readonly string[]).includes(delivery.event)
  ) {
    scopes.push({
      projectId: null,
      team: { projects: { some: { id: projectId } } },
    })
  }
  const subscriptions: Array<{
    id: string
    supportsUnassignedEvent: boolean
    agentId: string | null
    createdByAgentId: string | null
    projectId: number | null
    teamId: string | null
  }> =
    await tx.webhookSubscription.findMany({
      where: {
        active: true,
        AND: [{ OR: eventSelection }, { OR: scopes }],
      },
      select: { id: true, supportsUnassignedEvent: true, agentId: true, createdByAgentId: true, projectId: true, teamId: true },
    })
  if (subscriptions.length === 0) return []

  const occurredAt = new Date().toISOString()
  const deliveryIds: string[] = []
  for (const subscription of subscriptions) {
    if (!await webhookCredentialAllows(subscription.agentId, delivery, subscription, tx)) continue
    const deliveryId = crypto.randomUUID()
    const stored = persistedDelivery({
      delivery: eventForSubscription(
        delivery,
        subscription.supportsUnassignedEvent,
      ),
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
  const source = await prisma.boardWebhookDelivery.findFirst({
    where: { id: input.deliveryId, subscriptionId: input.subscriptionId },
    select: { event: true, payload: true, payloadHash: true, subscription: true },
  })
  if (!source || !await webhookCredentialAllows(source.subscription.agentId, source.payload, source.subscription)) return null

  if (existing) return existing.id
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
