import {
  checkMcpRateLimit,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { hasManagementWritePermission } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import {
  deleteOwnedAgent,
  type AgentManagementDatabase,
} from './ownedAgents'

export async function handleDeleteAgentRequest(
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
      { success: false, error: 'Agents cannot delete agents' },
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
        error: 'Management key does not have permission to delete agents',
      },
      { status: 403 }
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

  const deletedAgent = await deleteOwnedAgent(
    prisma as unknown as AgentManagementDatabase,
    ctx.user.id,
    agentId
  )
  if (!deletedAgent) {
    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    agent: { id: deletedAgent.id },
    cleanup: {
      board_memberships: deletedAgent.deleted_board_memberships,
      task_assignments: deletedAgent.deleted_task_assignments,
    },
  })
}
