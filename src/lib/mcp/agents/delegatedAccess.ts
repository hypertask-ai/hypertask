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
