import {
  checkMcpRateLimit,
  validateManagementOrSessionAuth,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { hasManagementReadPermission } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import {
  listOwnedAgents,
  type AgentManagementDatabase,
} from './ownedAgents'

export async function handleListAgentsRequest(
  request: NextRequest,
  authMode: 'mcp' | 'management' = 'mcp'
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = authMode === 'management'
    ? await validateManagementOrSessionAuth(request, 'read')
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

  const agents = await listOwnedAgents(
    prisma as unknown as AgentManagementDatabase,
    ctx.user.id
  )

  return NextResponse.json({ success: true, agents })
}
