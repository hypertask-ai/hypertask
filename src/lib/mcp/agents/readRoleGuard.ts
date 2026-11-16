import type { McpAuthContext } from '@/lib/mcp/auth'
import { insufficientScopeResponse, getAgentRole, roleMeets } from '@/lib/mcp/agents/scopes'
import type { NextResponse } from 'next/server'

export async function requireAgentWriteRole(
  ctx: Pick<McpAuthContext, 'agentId' | 'agentRole'> & { user: { id: number } }
): Promise<NextResponse | null> {
  if (!ctx.agentId) return null
  if (ctx.agentRole && roleMeets(ctx.agentRole, 'write')) return null

  const role = ctx.agentRole ?? (await getAgentRole(ctx))
  if (roleMeets(role, 'write')) return null

  return insufficientScopeResponse(role, 'write')
}
