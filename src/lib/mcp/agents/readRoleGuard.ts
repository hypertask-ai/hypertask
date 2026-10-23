import type { McpAuthContext } from '@/lib/mcp/auth'
import { insufficientScopeResponse, getAgentRole, roleMeets } from '@/lib/mcp/agents/scopes'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG } from '@/lib/flags/keys'
import type { NextResponse } from 'next/server'

export async function agentReadRoleGuardEnabled(ownerUserId: number): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG, ownerUserId)
  } catch (error) {
    console.warn('[agent-read-role-guard] flag read failed; guard off', error)
    return false
  }
}

export async function requireAgentWriteRole(
  ctx: Pick<McpAuthContext, 'agentId' | 'agentRole'> & { user: { id: number } }
): Promise<NextResponse | null> {
  if (!ctx.agentId) return null
  if (ctx.agentRole && roleMeets(ctx.agentRole, 'write')) return null
  if (!(await agentReadRoleGuardEnabled(ctx.user.id))) return null

  const role = ctx.agentRole ?? (await getAgentRole(ctx))
  if (roleMeets(role, 'write')) return null

  return insufficientScopeResponse(role, 'write')
}
