/**
 * HTPR-6348: an agent with the admin role may add or remove its owner's other
 * agents on boards, but only on boards it is itself a member of (enforced inside
 * updateOwnedAgentBoards). The acting agent keeps its own identity; nobody
 * switches to the owner or shares a token.
 */
import type { McpAuthContext } from '@/lib/mcp/auth'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { NextResponse } from 'next/server'

const forbidden = (error: string) =>
  NextResponse.json({ success: false, error }, { status: 403 })

export async function checkAgentBoardDelegation(
  ctx: McpAuthContext,
  targetAgentId: string
): Promise<NextResponse | null> {
  const actingAgentId = ctx.agentId
  if (!actingAgentId) return null

  const roleError = await requireRole(ctx, 'admin')
  if (roleError) return roleError

  if (targetAgentId === actingAgentId) {
    return forbidden('An agent cannot change its own board access')
  }

  return null
}
