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
import { HTPR_6530_MCP_LIST_QUERY_FLAG, isFeatureEnabled } from '@/lib/flags'
import { applyCollectionQuery } from '@/lib/mcp/listQuery'
import { readEnabledListQuery } from '@/lib/mcp/readListQuery'

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
  const listQueryEnabled = await isFeatureEnabled(HTPR_6530_MCP_LIST_QUERY_FLAG, ctx.user.id)
  const parsedListQuery = readEnabledListQuery(
    listQueryEnabled,
    request.nextUrl.searchParams,
  )
  if (parsedListQuery.error) return parsedListQuery.error
  const listQuery = parsedListQuery.listQuery
  if (!listQuery) {
    return NextResponse.json({ success: true, agents })
  }
  const projected = applyCollectionQuery(
    agents as unknown as Array<Record<string, unknown>>,
    listQuery,
    { searchFields: ['display_name', 'id'] },
  )
  return NextResponse.json({
    success: true,
    agents: projected.items,
    total: projected.total,
    nextCursor: projected.nextCursor,
  })
}
