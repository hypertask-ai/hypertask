import prisma from '@/lib/prisma'
import { getManagementKeyTeam } from '@/lib/mcp/managementKeyTeamScope'
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'

export async function resolveAgentTeamScope(
  userId: number,
  agent: { credentialTeamId: string | null; credentialTeamAccessBinding: string | null },
): Promise<AgentTokenTeamScope | null> {
  const { credentialTeamId: teamId, credentialTeamAccessBinding: accessBinding } = agent
  if (teamId === null && accessBinding === null) return null
  if (typeof teamId !== 'string' || !teamId.trim() || typeof accessBinding !== 'string' || !accessBinding.trim()) {
    throw new Error('Invalid agent credential team binding')
  }
  const team = await getManagementKeyTeam(userId, teamId, prisma)
  if (!team || team.id !== teamId || team.accessBinding !== accessBinding) {
    throw new Error('Agent credential team grant is no longer valid')
  }
  return { teamId, accessBinding }
}
