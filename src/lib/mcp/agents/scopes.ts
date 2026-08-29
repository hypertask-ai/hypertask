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
  ctx: McpAuthContext
): Promise<AgentRole> {
  if (!ctx.agentId) return 'write'

  // ponytail: add an in-memory TTL cache here if this DB round trip is measured
  // as a hot-path cost.
  const agent = await prisma.agent.findUnique({
    where: { id: ctx.agentId },
    select: { permissions: true },
  })

  return (agent?.permissions as AgentScopes | null)?.role ?? 'write'
}

export async function requireRole(
  ctx: McpAuthContext,
  minRole: AgentRole
): Promise<NextResponse | null> {
  const role = await getAgentRole(ctx)
  if (ROLE_RANK[role] >= ROLE_RANK[minRole]) return null

  return NextResponse.json(
    {
      success: false,
      error: `This agent's role ('${role}') does not permit this action; requires '${minRole}' or higher.`,
      code: 'insufficient_scope',
    },
    { status: 403 }
  )
}
