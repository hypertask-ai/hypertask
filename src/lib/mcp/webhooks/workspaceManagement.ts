import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { assertSafeWebhookTarget } from './ssrfGuard'
import {
  createBoardWebhookTestDelivery,
  retryBoardWebhookDelivery,
} from './outbox'
import { parseWebhookEventSelection } from './events'

export const WORKSPACE_WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.assigned',
  'task.unassigned',
  'comment.created',
  'comment.mention',
] as const

const MAX_ENDPOINTS_PER_TEAM = 20

export class WorkspaceWebhookError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message)
  }
}

const teamSubscriptionWhere = (
  teamId: string,
): Prisma.WebhookSubscriptionWhereInput => ({
  OR: [{ teamId, projectId: null }, { project: { teamId } }],
})

export async function assertWorkspaceWebhookOwner(
  userId: number,
  teamId: string,
) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, googleAccount: { userId } },
    select: { id: true },
  })
  if (!team) {
    throw new WorkspaceWebhookError(
      'Only the team owner can manage workspace webhooks',
      403,
    )
  }
  return team
}

function secretHint(secret: string) {
  return `whsec_…${secret.slice(-4)}`
}

function serializeSubscription(sub: {
  id: string
  projectId: number | null
  teamId: string | null
  url: string
  secret: string
  events: string[]
  active: boolean
  createdAt: Date
  lastDeliveryAt: Date | null
  lastDeliveryOk: boolean | null
  project: { id: number; title: string | null; name: string } | null
  createdBy: { displayName: string | null } | null
}) {
  return {
    id: sub.id,
    kind: 'workspace' as const,
    scope: sub.teamId ? ('team' as const) : ('project' as const),
    project: sub.project
      ? { id: sub.project.id, name: sub.project.title ?? sub.project.name }
      : null,
    url: sub.url,
    events: sub.events,
    active: sub.active,
    secretHint: secretHint(sub.secret),
    createdAt: sub.createdAt.toISOString(),
    createdBy: sub.createdBy?.displayName ?? null,
    lastDeliveryAt: sub.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryOk: sub.lastDeliveryOk,
  }
}

function serializeAgentSubscription(sub: {
  id: string
  projectId: number | null
  url: string
  events: string[]
  active: boolean
  lastDeliveryAt: Date | null
  lastDeliveryOk: boolean | null
  project: { id: number; title: string | null; name: string } | null
  agent: { id: string; displayName: string }
}) {
  return {
    id: sub.id,
    kind: 'agent' as const,
    scope: sub.projectId == null ? ('team' as const) : ('project' as const),
    project: sub.project
      ? { id: sub.project.id, name: sub.project.title ?? sub.project.name }
      : null,
    agent: sub.agent,
    url: sub.url,
    events: sub.events,
    active: sub.active,
    lastDeliveryAt: sub.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryOk: sub.lastDeliveryOk,
  }
}

type WorkspaceDeliveryLogEntry = {
  deliveryId: string
  event: string
  payload: Prisma.JsonValue
  payloadHash: string | null
  status: string
  attemptNumber: number
  statusCode: number | null
  durationMs: number | null
  error: string | null
  attemptedAt: string
}

function boardDeliveryAttempts(deliveries: Array<{
  id: string
  event: string
  payload: Prisma.JsonValue
  payloadHash: string | null
  status: string
  attemptCount: number
  statusCode: number | null
  error: string | null
  createdAt: Date
  lastAttemptAt: Date | null
  attempts: Array<{
    attemptNumber: number
    statusCode: number | null
    durationMs: number
    error: string | null
    attemptedAt: Date
  }>
}>): WorkspaceDeliveryLogEntry[] {
  return deliveries.flatMap((delivery): WorkspaceDeliveryLogEntry[] => {
    if (delivery.attempts.length === 0) {
      return [{
        deliveryId: delivery.id,
        event: delivery.event,
        payload: delivery.payload,
        payloadHash: delivery.payloadHash,
        status: delivery.status,
        attemptNumber: delivery.attemptCount,
        statusCode: delivery.statusCode,
        durationMs: null,
        error: delivery.error,
        attemptedAt: (delivery.lastAttemptAt ?? delivery.createdAt).toISOString(),
      }]
    }
    return delivery.attempts.map((attempt) => ({
      deliveryId: delivery.id,
      event: delivery.event,
      payload: delivery.payload,
      payloadHash: delivery.payloadHash,
      status:
        attempt.statusCode != null &&
        attempt.statusCode >= 200 &&
        attempt.statusCode < 300
          ? 'delivered'
          : 'failed',
      attemptNumber: attempt.attemptNumber,
      statusCode: attempt.statusCode,
      durationMs: attempt.durationMs,
      error: attempt.error,
      attemptedAt: attempt.attemptedAt.toISOString(),
    }))
  })
}

export async function listWorkspaceWebhooks(input: {
  userId: number
  teamId: string
  endpointId?: string | null
}) {
  await assertWorkspaceWebhookOwner(input.userId, input.teamId)
  const [subscriptions, agentSubscriptions] = await Promise.all([
    prisma.webhookSubscription.findMany({
      where: teamSubscriptionWhere(input.teamId),
      select: {
        id: true,
        projectId: true,
        teamId: true,
        url: true,
        secret: true,
        events: true,
        active: true,
        createdAt: true,
        lastDeliveryAt: true,
        lastDeliveryOk: true,
        project: { select: { id: true, title: true, name: true } },
        createdBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.agentWebhookSubscription.findMany({
      where: {
        agent: {
          userId: input.userId,
          revokedAt: null,
          members: { some: { project: { teamId: input.teamId } } },
        },
        OR: [{ projectId: null }, { project: { teamId: input.teamId } }],
      },
      select: {
        id: true,
        projectId: true,
        url: true,
        events: true,
        active: true,
        lastDeliveryAt: true,
        lastDeliveryOk: true,
        project: { select: { id: true, title: true, name: true } },
        agent: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  let deliveries: ReturnType<typeof boardDeliveryAttempts> = []
  let selectedKind: 'workspace' | 'agent' | null = null
  if (input.endpointId) {
    const selected = subscriptions.find(({ id }) => id === input.endpointId)
    if (selected) {
      const rows = await prisma.boardWebhookDelivery.findMany({
        where: { subscriptionId: selected.id },
        select: {
          id: true,
          event: true,
          payload: true,
          payloadHash: true,
          status: true,
          attemptCount: true,
          statusCode: true,
          error: true,
          createdAt: true,
          lastAttemptAt: true,
          attempts: {
            select: {
              attemptNumber: true,
              statusCode: true,
              durationMs: true,
              error: true,
              attemptedAt: true,
            },
            orderBy: { attemptNumber: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      })
      deliveries = boardDeliveryAttempts(rows)
      selectedKind = 'workspace'
    } else {
      const selectedAgent = agentSubscriptions.find(
        ({ id }) => id === input.endpointId,
      )
      if (selectedAgent) {
        const teamProjects = await prisma.project.findMany({
          where: { teamId: input.teamId },
          select: { id: true },
        })
        const rows = teamProjects.length
          ? await prisma.agentWebhookDelivery.findMany({
              where: {
                subscriptionId: selectedAgent.id,
                OR: teamProjects.map(({ id }) => ({
                  payload: { path: ['projectId'], equals: id },
                })),
              },
              select: {
                id: true,
                event: true,
                payload: true,
                status: true,
                attemptCount: true,
                statusCode: true,
                error: true,
                createdAt: true,
                lastAttemptAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 25,
            })
          : []
        deliveries = rows.map((delivery) => ({
          deliveryId: delivery.id,
          event: delivery.event,
          payload: delivery.payload,
          payloadHash: crypto
            .createHash('sha256')
            .update(JSON.stringify(delivery.payload))
            .digest('hex'),
          status: delivery.status,
          attemptNumber: delivery.attemptCount,
          statusCode: delivery.statusCode,
          durationMs: null,
          error: delivery.error,
          attemptedAt: (
            delivery.lastAttemptAt ?? delivery.createdAt
          ).toISOString(),
        }))
        selectedKind = 'agent'
      }
    }
  }

  return {
    success: true,
    availableEvents: WORKSPACE_WEBHOOK_EVENTS,
    endpoints: [
      ...subscriptions.map(serializeSubscription),
      ...agentSubscriptions.map(serializeAgentSubscription),
    ],
    selectedKind,
    deliveries,
  }
}

async function validatedUrl(value: unknown) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) throw new WorkspaceWebhookError('Endpoint URL is required', 400, 'url')
  if (url.length > 2000) {
    throw new WorkspaceWebhookError(
      'Endpoint URL must be 2000 characters or less',
      400,
      'url',
    )
  }
  const safe = await assertSafeWebhookTarget(url)
  if (!safe.ok) throw new WorkspaceWebhookError(safe.reason, 400, 'url')
  return url
}

function validatedEvents(value: unknown) {
  const parsed = parseWebhookEventSelection(value)
  if (!parsed.ok) throw new WorkspaceWebhookError(parsed.error, 400, 'events')
  if (
    parsed.events.length === 0 ||
    parsed.events.some(
      (event) =>
        !(WORKSPACE_WEBHOOK_EVENTS as readonly string[]).includes(event),
    )
  ) {
    throw new WorkspaceWebhookError(
      `Select at least one of: ${WORKSPACE_WEBHOOK_EVENTS.join(', ')}`,
      400,
      'events',
    )
  }
  return parsed.events
}

export async function createWorkspaceWebhook(input: {
  userId: number
  teamId: string
  projectId: unknown
  url: unknown
  events: unknown
}) {
  await assertWorkspaceWebhookOwner(input.userId, input.teamId)
  const url = await validatedUrl(input.url)
  const events = validatedEvents(input.events)
  const projectId =
    input.projectId == null || input.projectId === ''
      ? null
      : Number(input.projectId)
  if (projectId != null && (!Number.isSafeInteger(projectId) || projectId <= 0)) {
    throw new WorkspaceWebhookError('Select a valid board', 400, 'projectId')
  }

  const lockId = crypto
    .createHash('sha256')
    .update(`workspace-webhooks:${input.teamId}`)
    .digest()
    .readBigInt64BE(0)
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${lockId})`,
    )
    if (projectId != null) {
      const project = await tx.project.findFirst({
        where: { id: projectId, teamId: input.teamId },
        select: { id: true },
      })
      if (!project) {
        throw new WorkspaceWebhookError(
          'The selected board does not belong to this team',
          403,
          'projectId',
        )
      }
    }
    const count = await tx.webhookSubscription.count({
      where: teamSubscriptionWhere(input.teamId),
    })
    if (count >= MAX_ENDPOINTS_PER_TEAM) {
      throw new WorkspaceWebhookError(
        `A team may have at most ${MAX_ENDPOINTS_PER_TEAM} webhook endpoints`,
      )
    }
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`
    const subscription = await tx.webhookSubscription.create({
      data: {
        ...(projectId == null
          ? { teamId: input.teamId }
          : { projectId }),
        url,
        events,
        secret,
        createdById: input.userId,
      },
      include: {
        project: { select: { id: true, title: true, name: true } },
        createdBy: { select: { displayName: true } },
      },
    })
    return { secret, subscription }
  })
  return {
    success: true,
    secret: result.secret,
    endpoint: serializeSubscription(result.subscription),
  }
}

async function ownedSubscription(userId: number, teamId: string, id: string) {
  await assertWorkspaceWebhookOwner(userId, teamId)
  const subscription = await prisma.webhookSubscription.findFirst({
    where: { id, ...teamSubscriptionWhere(teamId) },
  })
  if (!subscription) {
    throw new WorkspaceWebhookError('Endpoint not found', 404)
  }
  return subscription
}

export async function setWorkspaceWebhookActive(input: {
  userId: number
  teamId: string
  id: string
  active: unknown
}) {
  const subscription = await ownedSubscription(
    input.userId,
    input.teamId,
    input.id,
  )
  if (typeof input.active !== 'boolean') {
    throw new WorkspaceWebhookError('active must be a boolean', 400, 'active')
  }
  await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: { active: input.active },
  })
  return { success: true }
}

export async function rotateWorkspaceWebhookSecret(input: {
  userId: number
  teamId: string
  id: string
}) {
  const subscription = await ownedSubscription(
    input.userId,
    input.teamId,
    input.id,
  )
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`
  await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: { secret },
  })
  return { success: true, secret, secretHint: secretHint(secret) }
}

export async function testWorkspaceWebhook(input: {
  userId: number
  teamId: string
  id: string
}) {
  const subscription = await ownedSubscription(
    input.userId,
    input.teamId,
    input.id,
  )
  if (!subscription.active) {
    throw new WorkspaceWebhookError('Enable this endpoint before testing it')
  }
  const deliveryId = await createBoardWebhookTestDelivery({
    subscriptionId: subscription.id,
    projectId: subscription.projectId,
  })
  return { success: true, deliveryId }
}

export async function retryWorkspaceWebhook(input: {
  userId: number
  teamId: string
  id: string
  deliveryId: unknown
  idempotencyKey: unknown
}) {
  const subscription = await ownedSubscription(
    input.userId,
    input.teamId,
    input.id,
  )
  if (!subscription.active) {
    throw new WorkspaceWebhookError('Enable this endpoint before retrying a delivery')
  }
  const deliveryId =
    typeof input.deliveryId === 'string' ? input.deliveryId.trim() : ''
  const idempotencyKey =
    typeof input.idempotencyKey === 'string'
      ? input.idempotencyKey.trim()
      : ''
  if (!deliveryId) {
    throw new WorkspaceWebhookError('deliveryId is required', 400, 'deliveryId')
  }
  if (!idempotencyKey || idempotencyKey.length > 100) {
    throw new WorkspaceWebhookError(
      'A valid idempotencyKey is required',
      400,
      'idempotencyKey',
    )
  }
  const retriedId = await retryBoardWebhookDelivery({
    deliveryId,
    subscriptionId: subscription.id,
    idempotencyKey: `${subscription.id}:${idempotencyKey}`,
  })
  if (!retriedId) throw new WorkspaceWebhookError('Delivery not found', 404)
  return { success: true, deliveryId: retriedId }
}

export async function deleteWorkspaceWebhook(input: {
  userId: number
  teamId: string
  id: string
}) {
  const subscription = await ownedSubscription(
    input.userId,
    input.teamId,
    input.id,
  )
  await prisma.webhookSubscription.delete({ where: { id: subscription.id } })
  return { success: true }
}
