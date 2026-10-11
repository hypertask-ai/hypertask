import prisma from '@/lib/prisma'
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from '@/lib/mcp/agents'
import type { VisibleReactionAgents } from '@/lib/mcp/comments/reactionResponse'

// HTPR-7122: names of the agents behind agent reactions, with the same visibility
// rule as an agent's comment. A hidden agent reads as "Private agent".
export async function loadVisibleReactionAgents(
  agentIds: string[],
  userId: number,
  projectId: number
): Promise<VisibleReactionAgents> {
  if (agentIds.length === 0) return new Map()
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: mcpVisibleAgentSelect(userId, projectId),
  })
  const visible = new Map<string, string>()
  for (const agent of agents) {
    const summary = mapVisibleMcpAgent(agent, userId, projectId)
    if (summary) visible.set(summary.id, summary.displayName)
  }
  return visible
}
