import { crossTeamRequestFence } from "@/lib/auth/crossTeamContext"
import { agentScopeEnforced, recordAgentBoardScopeMiss } from '@/lib/auth/agentScope'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { allowAgentSelfJoin } from '@/lib/mcp/agents/selfJoin'
import { NextResponse } from 'next/server'

const forbidden = (error: string) =>
  NextResponse.json({ success: false, error, code: 'forbidden' }, { status: 403 })

export function selfBoardAccessRefusal(projectId: number, agentId: string) {
  return `Ask a member of board ${projectId} to run: hypertask project invite ${projectId} --user ${agentId}`
}

function unnamedBoardAccessRefusal(agentId: string) {
  return `Ask a member of the board to run: hypertask project invite <board> --user ${agentId}`
}

export async function checkAgentBoardDelegation(
  ctx: McpAuthContext,
  targetAgentId: string,
  change: { addProjectIds?: number[]; removeProjectIds?: number[]; projectId?: number } = {},
): Promise<NextResponse | null> {
  const actingAgentId = ctx.agentId
  if (!actingAgentId) return null

  if (targetAgentId === actingAgentId) {
    const addProjectIds = change.addProjectIds ?? []
    const removeProjectIds = change.removeProjectIds ?? []
    if (addProjectIds.length > 0 && removeProjectIds.length === 0) {
      const decision = await allowAgentSelfJoin(ctx.user.id, actingAgentId, addProjectIds)
      if (decision.ok) return null
      return forbidden(selfBoardAccessRefusal(decision.projectId, actingAgentId))
    }
    const projectId = change.projectId ?? addProjectIds[0] ?? removeProjectIds[0]
    return forbidden(projectId == null
      ? unnamedBoardAccessRefusal(actingAgentId)
      : selfBoardAccessRefusal(projectId, actingAgentId))
  }

  const roleError = await requireRole(ctx, 'admin')
  if (roleError) return roleError

  return null
}

type AgentBoardScopeMember = {
  findMany(args: {
    where: { agentId: string; projectId: { in: number[] }; status?: 'Accepted'; agent?: { userId: number; revokedAt: null }; project?: import("@prisma/client").Prisma.ProjectWhereInput }
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
      ...(crossTeamRequestFence() ? { project: crossTeamRequestFence()! } : {}),
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
