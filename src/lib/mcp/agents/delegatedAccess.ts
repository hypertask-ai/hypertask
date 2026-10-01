/**
 * HTPR-6348: an agent with the admin role may add or remove its owner's other
 * agents on boards, but only on boards it is itself a member of. The acting
 * agent keeps its own identity; nobody switches to the owner or shares a token.
 */
import {
  HTPR_6348_AGENT_ACCESS_DELEGATION_FLAG,
  isFeatureEnabled,
} from '@/lib/flags'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { requireRole } from '@/lib/mcp/agents/scopes'
import type { AgentBoardUpdateInput } from '@/lib/mcp/agents/updateBoards'
import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'

const forbidden = (error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, error, ...extra }, { status: 403 })

export async function checkAgentBoardDelegation(
  ctx: McpAuthContext,
  targetAgentId: string,
  input: AgentBoardUpdateInput
): Promise<NextResponse | null> {
  const actingAgentId = ctx.agentId
  if (!actingAgentId) return null

  let enabled = false
  try {
    enabled = await isFeatureEnabled(
      HTPR_6348_AGENT_ACCESS_DELEGATION_FLAG,
      ctx.user.id
    )
  } catch (error) {
    console.error(
      '[MCP Agent Access Delegation] feature flag check failed',
      error
    )
  }
  if (!enabled) return forbidden('Agents cannot manage agents')

  const roleError = await requireRole(ctx, 'admin')
  if (roleError) return roleError

  if (targetAgentId === actingAgentId) {
    return forbidden('An agent cannot change its own board access')
  }

  const projectIds = [...input.addProjectIds, ...input.removeProjectIds]
  const memberships = await prisma.member.findMany({
    where: { agentId: actingAgentId, projectId: { in: projectIds } },
    select: { projectId: true },
  })
  const inScope = new Set(memberships.map((row) => row.projectId))
  const outside = projectIds.filter((id) => !inScope.has(id))
  if (outside.length) {
    return forbidden(
      `This agent is not a member of project ${outside.join(', ')}, so it cannot grant or remove access there`,
      { code: 'outside_delegated_scope', field: 'project_ids' }
    )
  }
  return null
}
