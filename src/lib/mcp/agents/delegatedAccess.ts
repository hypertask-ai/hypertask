import { agentScopeEnforced, recordAgentBoardScopeMiss } from '@/lib/auth/agentScope'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { NextResponse } from 'next/server'

const forbidden = (error: string) =>
  NextResponse.json({ success: false, error, code: 'forbidden' }, { status: 403 })

export async function checkAgentBoardDelegation(
  ctx: McpAuthContext,
  targetAgentId: string
): Promise<NextResponse | null> {
  const actingAgentId = ctx.agentId
  if (!actingAgentId) return null

  if (targetAgentId === actingAgentId) {
    return forbidden('An agent cannot change its own board access. Ask the person who owns this agent to open Agents, pick this agent, and add the board under Board access.')
  }

  const roleError = await requireRole(ctx, 'admin')
  if (roleError) return roleError

  return null
}

type AgentBoardScopeMember = {
  findMany(args: {
    where: { agentId: string; projectId: { in: number[] }; status?: 'Accepted'; agent?: { userId: number; revokedAt: null } }
    select: { projectId: true }
  }): Promise<Array<{ projectId: number }>>
}

export async function getAgentBoardScope(
  member: AgentBoardScopeMember,
  actingAgentId: string,
  userId: number,
  projectIds: number[]
): Promise<Set<number>> {
  const rows = await member.findMany({
    where: {
      agentId: actingAgentId,
      projectId: { in: projectIds },
      ...(agentScopeEnforced() ? { status: 'Accepted' as const, agent: { userId, revokedAt: null } } : {}),
    },
    select: { projectId: true },
  })
  return new Set(rows.map((row) => row.projectId))
}

export class AgentBoardInviteScopeError extends Error {
  readonly status = 403

  constructor() {
    super('This agent is not a member of this board. Ask the board owner to add it.')
    this.name = 'AgentBoardInviteScopeError'
  }
}

export async function assertAgentBoardInviteScope(
  member: AgentBoardScopeMember,
  projectId: number,
  userId: number,
  actingAgentId?: string | null
): Promise<void> {
  if (!actingAgentId) return
  const inScope = await getAgentBoardScope(member, actingAgentId, userId, [projectId])
  recordAgentBoardScopeMiss(projectId, 'write')
  if (!inScope.has(projectId)) throw new AgentBoardInviteScopeError()
}
