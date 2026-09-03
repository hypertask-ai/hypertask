import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import {
  WEBHOOK_EVENT_DEFINITIONS,
  WEBHOOK_EVENTS,
  parseWebhookEventSelection,
} from '@/lib/mcp/webhooks/events'
import { assertSafeWebhookTarget } from '@/lib/mcp/webhooks/ssrfGuard'
import {
  AgentWebhookInputError,
  manageAgentWebhook,
  type AgentWebhookManagementAction,
} from '@/lib/agentWebhooks/management'

const MAX_SUBS_PER_PROJECT = 20

function targetAgentId(value: unknown, sessionAgentId: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const requested = value.trim()
  if (requested === 'self') return sessionAgentId ?? null
  return requested
}

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}

// Never return the raw secret on reads — it is shown once at creation only.
function maskSecret(secret: string): string {
  return `whsec_…${secret.slice(-4)}`
}

function serialize(sub: {
  id: string
  projectId: number | null
  url: string
  secret: string
  events: string[]
  active: boolean
  createdAt: Date
  lastDeliveryAt: Date | null
  lastDeliveryOk: boolean | null
}) {
  return {
    id: sub.id,
    projectId: sub.projectId,
    url: sub.url,
    events: sub.events,
    active: sub.active,
    secretHint: maskSecret(sub.secret),
    createdAt: sub.createdAt.toISOString(),
    lastDeliveryAt: sub.lastDeliveryAt ? sub.lastDeliveryAt.toISOString() : null,
    lastDeliveryOk: sub.lastDeliveryOk,
  }
}

/**
 * GET /api/mcp/webhooks?project_id=
 * List a board's outbound webhook subscriptions. Secrets are masked.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const requestedAgentId = request.nextUrl.searchParams.get('agent_id')
    if (requestedAgentId) {
      const agentId = targetAgentId(requestedAgentId, ctx.agentId)
      if (!agentId || (ctx.agentId && ctx.agentId !== agentId)) {
        return NextResponse.json(
          { success: false, error: 'agent_id must identify the calling agent' },
          { status: 403 }
        )
      }
      try {
        return NextResponse.json(
          await manageAgentWebhook({
            userId: ctx.user.id,
            agentId,
            action: 'get',
          })
        )
      } catch (error) {
        if (error instanceof AgentWebhookInputError) {
          return NextResponse.json(
            { success: false, error: error.message, field: error.field },
            { status: error.status }
          )
        }
        throw error
      }
    }

    const projectId = Number(request.nextUrl.searchParams.get('project_id'))
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return validationError('project_id is required', 'project_id')
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId) },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    const subs = await prisma.webhookSubscription.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      projectId,
      availableEvents: WEBHOOK_EVENTS,
      eventDefinitions: WEBHOOK_EVENT_DEFINITIONS,
      subscriptions: subs.map(serialize),
    })
  } catch (error) {
    console.error('[MCP Webhooks] GET error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/mcp/webhooks
 * Register a signed outbound webhook for a board.
 * Body: { project_id, url, events? }. `events` omitted/empty = all events.
 * Returns the generated `secret` ONCE (used to verify the HMAC signature).
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return validationError('Request body must be a JSON object')
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 })
    }


    if (body.agent_id !== undefined) {
      const agentId = targetAgentId(body.agent_id, ctx.agentId)
      if (!agentId || (ctx.agentId && ctx.agentId !== agentId)) {
        return NextResponse.json(
          { success: false, error: 'agent_id must identify the calling agent' },
          { status: 403 }
        )
      }
      const requestedAction = body.action ?? (body.rotate_secret === true ? 'rotate' : 'configure')
      const allowedActions: AgentWebhookManagementAction[] = [
        'configure',
        'test',
        'replay',
        'rotate',
      ]
      if (
        typeof requestedAction !== 'string' ||
        !allowedActions.includes(requestedAction as AgentWebhookManagementAction)
      ) {
        return validationError(
          'action must be configure, test, replay, or rotate',
          'action'
        )
      }
      try {
        const result = await manageAgentWebhook({
          userId: ctx.user.id,
          agentId,
          action: requestedAction as AgentWebhookManagementAction,
          url: body.url,
          events: body.events,
          projectId: body.project_id === undefined ? undefined : body.project_id,
          active: body.active,
          deliveryId: body.delivery_id,
        })
        return NextResponse.json(
          result,
          { status: requestedAction === 'configure' || requestedAction === 'rotate' ? 201 : 202 }
        )
      } catch (error) {
        if (error instanceof AgentWebhookInputError) {
          return NextResponse.json(
            { success: false, error: error.message, field: error.field },
            { status: error.status }
          )
        }
        throw error
      }
    }

    const projectId = Number(body.project_id)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return validationError('project_id is required', 'project_id')
    }

    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return validationError('url is required', 'url')
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return validationError('url must be a valid absolute URL', 'url')
    }
    // https only: the signature protects integrity, not confidentiality — a
    // plaintext http receiver would leak the payload in transit.
    if (parsedUrl.protocol !== 'https:') {
      return validationError('url must use https', 'url')
    }
    if (url.length > 2000) {
      return validationError('url must be 2000 characters or less', 'url')
    }
    // SSRF guard: reject targets that resolve to private/reserved addresses.
    const safe = await assertSafeWebhookTarget(url)
    if (!safe.ok) {
      return validationError(safe.reason, 'url')
    }

    const parsedEvents = parseWebhookEventSelection(body.events)
    if (!parsedEvents.ok) {
      return NextResponse.json(
        {
          success: false,
          error: parsedEvents.error,
          code: 'invalid_field',
          field: 'events',
          allowed_values: WEBHOOK_EVENTS,
        },
        { status: 400 }
      )
    }
    const events = parsedEvents.events

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId) },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    const existingCount = await prisma.webhookSubscription.count({ where: { projectId } })
    if (existingCount >= MAX_SUBS_PER_PROJECT) {
      return validationError(
        `A board may have at most ${MAX_SUBS_PER_PROJECT} webhook subscriptions`,
        'project_id'
      )
    }

    const secret = 'whsec_' + crypto.randomBytes(24).toString('hex')
    const sub = await prisma.webhookSubscription.create({
      data: {
        projectId,
        url,
        secret,
        events,
        createdById: ctx.user.id,
        agentId: ctx.agentId ?? null,
      },
    })

    // Return the full secret exactly once, alongside the masked view.
    return NextResponse.json(
      { success: true, subscription: serialize(sub), secret },
      { status: 201 }
    )
  } catch (error) {
    console.error('[MCP Webhooks] POST error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/mcp/webhooks?id=
 * Remove a subscription the caller can access (scoped by board access).
 */
export async function DELETE(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const requestedAgentId = request.nextUrl.searchParams.get('agent_id')
    if (requestedAgentId) {
      const agentId = targetAgentId(requestedAgentId, ctx.agentId)
      if (!agentId || (ctx.agentId && ctx.agentId !== agentId)) {
        return NextResponse.json(
          { success: false, error: 'agent_id must identify the calling agent' },
          { status: 403 }
        )
      }
      try {
        return NextResponse.json(
          await manageAgentWebhook({
            userId: ctx.user.id,
            agentId,
            action: 'delete',
          })
        )
      } catch (error) {
        if (error instanceof AgentWebhookInputError) {
          return NextResponse.json(
            { success: false, error: error.message, field: error.field },
            { status: error.status }
          )
        }
        throw error
      }
    }

    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) return validationError('id or agent_id is required', 'id')

    const agentSubscription = await prisma.agentWebhookSubscription.findUnique({
      where: { id },
      select: { id: true, agentId: true, agent: { select: { userId: true } } },
    })
    if (agentSubscription) {
      const allowed =
        agentSubscription.agent.userId === ctx.user.id &&
        (!ctx.agentId || ctx.agentId === agentSubscription.agentId)
      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'Subscription not found or access denied' },
          { status: 404 }
        )
      }
      await prisma.agentWebhookSubscription.delete({ where: { id } })
      return NextResponse.json({ success: true, deleted: id })
    }

    // Delete only if the subscription's board is one the caller can access.
    const result = await prisma.webhookSubscription.deleteMany({
      where: { id, project: getProjectWhere(ctx.user.id, ctx.agentId) },
    })
    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: 'Subscription not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, deleted: id })
  } catch (error) {
    console.error('[MCP Webhooks] DELETE error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
