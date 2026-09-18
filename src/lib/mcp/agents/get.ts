import { HTPR_6473_GET_AGENT_FLAG, isFeatureEnabled } from '@/lib/flags'
import {
  checkMcpRateLimit,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { hasManagementReadPermission } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { getOwnedAgent } from './ownedAgents'

export async function handleGetAgentRequest(
  request: NextRequest,
  rawAgentId: string
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = await validateMcpAuth(request, {
    deferManagementPermissionCheck: true,
  })
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
      { success: false, error: 'Agents cannot list managed agent identities' },
      { status: 403 }
    )
  }
  if (
    ctx.management &&
    !hasManagementReadPermission(ctx.management.permissions)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Management key does not have permission to list agents',
      },
      { status: 403 }
    )
  }

  let featureEnabled = false
  try {
    featureEnabled = await isFeatureEnabled(HTPR_6473_GET_AGENT_FLAG, ctx.user.id)
  } catch (error) {
    console.error('[get-agent] feature flag check failed', error)
  }
  if (!featureEnabled) {
    return NextResponse.json(
      { success: false, error: 'Not found.' },
      { status: 404 }
    )
  }

  const agentId = rawAgentId.trim()
  if (!agentId) {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'agent_id',
        'agent_id must be a non-empty string'
      ),
      { status: 400 }
    )
  }

  const agent = await getOwnedAgent(
    prisma,
    ctx.user.id,
    agentId,
    ctx.management?.teamId
  )
  if (!agent) {
    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({ success: true, agent })
}
