import {
  agentTokenCredentialFields,
  checkMcpRateLimit,
  type McpAuthContext,
  validateManagementOrSessionAuth,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { hasManagementWritePermission } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

type RevokeAgentBody = {
  agent_id?: unknown
}

export async function handleRevokeAgentRequest(
  request: NextRequest,
  authMode: 'mcp' | 'management' = 'mcp'
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = authMode === 'management'
    ? await validateManagementOrSessionAuth(request, 'write')
    : await validateMcpAuth(request, { deferManagementPermissionCheck: true })
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }
  if (ctx.agentId) {
    return NextResponse.json(
      { success: false, error: 'Agents cannot revoke agents' },
      { status: 403 }
    )
  }
  if (
    ctx.management &&
    !hasManagementWritePermission(ctx.management.permissions)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Management key does not have permission to revoke agents',
      },
      { status: 403 }
    )
  }

  return revokeAgentForUser(request, ctx.user)
}

export async function revokeAgentForUser(
  request: NextRequest,
  user: McpAuthContext['user']
): Promise<NextResponse> {

  let body: RevokeAgentBody
  try {
    body = (await request.json()) as RevokeAgentBody
  } catch {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'body',
        'Request body must be valid JSON'
      ),
      { status: 400 }
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'body',
        'Request body must be a JSON object'
      ),
      { status: 400 }
    )
  }

  if (body.agent_id === undefined) {
    return NextResponse.json(
      buildFieldError('missing_field', 'agent_id', 'agent_id is required'),
      { status: 400 }
    )
  }
  if (typeof body.agent_id !== 'string' || !body.agent_id.trim()) {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'agent_id',
        'agent_id must be a non-empty string'
      ),
      { status: 400 }
    )
  }
  const agentId = body.agent_id.trim()

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId: user.id,
      revokedAt: null,
    },
    select: { id: true },
  })
  if (!agent) {
    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    )
  }

  const revokedAt = new Date()
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      revokedAt,
      ...agentTokenCredentialFields(null),
      runtimeGeneration: { increment: 1 },
    },
  })

  return NextResponse.json({
    success: true,
    agent: {
      id: agent.id,
      revoked_at: revokedAt.toISOString(),
    },
  })
}
