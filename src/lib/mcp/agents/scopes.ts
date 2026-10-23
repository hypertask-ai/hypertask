import type { McpAuthContext } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'

export type AgentRole = 'read' | 'write' | 'admin'
export type AgentScopes = {
  role?: AgentRole
  postsToImportant?: boolean
}

const ROLE_RANK: Record<AgentRole, number> = {
  read: 0,
  write: 1,
  admin: 2,
}

export async function getAgentRole(
  ctx: Pick<McpAuthContext, 'agentId'>
): Promise<AgentRole> {
  if (!ctx.agentId) return 'write'

  const agent = await prisma.agent.findUnique({
    where: { id: ctx.agentId },
    select: { permissions: true },
  })

  return (agent?.permissions as AgentScopes | null)?.role ?? 'write'
}

export function roleMeets(role: AgentRole, minRole: AgentRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

export function insufficientScopeResponse(
  role: AgentRole,
  minRole: AgentRole
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: `This agent's role ('${role}') does not permit this action; requires '${minRole}' or higher.`,
      code: 'insufficient_scope',
    },
    { status: 403 }
  )
}

export async function requireRole(
  ctx: McpAuthContext,
  minRole: AgentRole
): Promise<NextResponse | null> {
  const role = await getAgentRole(ctx)
  if (roleMeets(role, minRole)) return null

  return insufficientScopeResponse(role, minRole)
}
