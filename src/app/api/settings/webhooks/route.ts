import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import {
  WorkspaceWebhookError,
  createWorkspaceWebhook,
  deleteWorkspaceWebhook,
  listWorkspaceWebhooks,
  retryWorkspaceWebhook,
  rotateWorkspaceWebhookSecret,
  setWorkspaceWebhookActive,
  testWorkspaceWebhook,
} from '@/lib/mcp/webhooks/workspaceManagement'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Body = Record<string, unknown>

function noStore<T>(body: T, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function trustedMutationOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function authenticatedUserId(request: NextRequest) {
  return (await getSessionUser(request.headers))?.userId ?? null
}

async function bodyFrom(request: NextRequest): Promise<Body> {
  const body = await request.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WorkspaceWebhookError('Request body must be a JSON object')
  }
  return body as Body
}

function teamIdFrom(value: unknown) {
  const teamId = typeof value === 'string' ? value.trim() : ''
  if (!teamId) throw new WorkspaceWebhookError('teamId is required', 400, 'teamId')
  return teamId
}

function idFrom(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) throw new WorkspaceWebhookError('id is required', 400, 'id')
  return id
}

function routeError(error: unknown) {
  if (error instanceof WorkspaceWebhookError) {
    return noStore(
      { success: false, error: error.message, field: error.field },
      { status: error.status },
    )
  }
  if (error instanceof SyntaxError) {
    return noStore(
      { success: false, error: 'Request body must be valid JSON' },
      { status: 400 },
    )
  }
  console.error('[workspace-webhooks] settings route failed', error)
  return noStore(
    { success: false, error: 'Internal server error' },
    { status: 500 },
  )
}

async function authorizeMutation(request: NextRequest) {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    throw new WorkspaceWebhookError('Unauthorized', 401)
  }
  if (!trustedMutationOrigin(request)) {
    throw new WorkspaceWebhookError('Invalid request origin', 403)
  }
  return userId
}

export async function GET(request: NextRequest) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) throw new WorkspaceWebhookError('Unauthorized', 401)
    const teamId = teamIdFrom(request.nextUrl.searchParams.get('teamId'))
    return noStore(
      await listWorkspaceWebhooks({
        userId,
        teamId,
        endpointId: request.nextUrl.searchParams.get('endpointId'),
      }),
    )
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await authorizeMutation(request)
    const body = await bodyFrom(request)
    const teamId = teamIdFrom(body.teamId)
    const action = body.action ?? 'create'
    let result
    if (action === 'create') {
      result = await createWorkspaceWebhook({
        userId,
        teamId,
        projectId: body.projectId,
        url: body.url,
        events: body.events,
      })
    } else if (action === 'test') {
      result = await testWorkspaceWebhook({
        userId,
        teamId,
        id: idFrom(body.id),
      })
    } else if (action === 'rotate') {
      result = await rotateWorkspaceWebhookSecret({
        userId,
        teamId,
        id: idFrom(body.id),
      })
    } else if (action === 'retry') {
      result = await retryWorkspaceWebhook({
        userId,
        teamId,
        id: idFrom(body.id),
        deliveryId: body.deliveryId,
        idempotencyKey: body.idempotencyKey,
      })
    } else {
      throw new WorkspaceWebhookError(
        'action must be create, test, rotate, or retry',
        400,
        'action',
      )
    }
    return noStore(result, { status: action === 'create' ? 201 : 202 })
  } catch (error) {
    return routeError(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await authorizeMutation(request)
    const body = await bodyFrom(request)
    return noStore(
      await setWorkspaceWebhookActive({
        userId,
        teamId: teamIdFrom(body.teamId),
        id: idFrom(body.id),
        active: body.active,
      }),
    )
  } catch (error) {
    return routeError(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await authorizeMutation(request)
    const body = await bodyFrom(request)
    return noStore(
      await deleteWorkspaceWebhook({
        userId,
        teamId: teamIdFrom(body.teamId),
        id: idFrom(body.id),
      }),
    )
  } catch (error) {
    return routeError(error)
  }
}
