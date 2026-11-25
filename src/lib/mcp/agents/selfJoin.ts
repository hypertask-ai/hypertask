import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_9625_AGENTS_JOIN_BOARDS_FLAG } from '@/lib/flags/definitions/htpr-9625-agents-join-boards'
import prisma from '@/lib/prisma'
import isProjectAdmin from '@/utils/controllers/projects/isProjectAdmin'

export type AgentSelfJoinDecision = { ok: true } | { ok: false; projectId: number }

export async function allowAgentSelfJoin(
  userId: number,
  agentId: string,
  projectIds: number[],
): Promise<AgentSelfJoinDecision> {
  const refused = (projectId: number): AgentSelfJoinDecision => ({ ok: false, projectId })
  if (projectIds.length === 0) return refused(0)
  if (!(await isFeatureEnabled(HTPR_9625_AGENTS_JOIN_BOARDS_FLAG, userId))) {
    return refused(projectIds[0])
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId, revokedAt: null, archivedAt: null },
    select: {
      boardHomeTeamId: true,
      credentialTeamId: true,
      credentialTeamAccessBinding: true,
      members: {
        orderBy: { id: 'asc' },
        select: { project: { select: { teamId: true } } },
      },
    },
  })
  if (!agent) return refused(projectIds[0])
  if (agent.credentialTeamAccessBinding && !agent.credentialTeamId) return refused(projectIds[0])

  const homeTeamId = agent.boardHomeTeamId
    ?? agent.credentialTeamId
    ?? agent.members.find((membership) => membership.project.teamId)?.project.teamId
    ?? null
  if (!homeTeamId) return refused(projectIds[0])
  if (agent.credentialTeamId && agent.credentialTeamId !== homeTeamId) return refused(projectIds[0])

  for (const projectId of projectIds) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, status: 'Normal' },
      select: { id: true, teamId: true, ownerId: true },
    })
    if (!project?.teamId || project.teamId !== homeTeamId) return refused(projectId)
    if (agent.credentialTeamId && project.teamId !== agent.credentialTeamId) return refused(projectId)

    const visible = project.ownerId === userId || (await prisma.member.findFirst({
      where: { projectId, userId, agentId: null },
      select: { id: true },
    })) != null
    if (!visible) return refused(projectId)
    if (!(await isProjectAdmin(userId, projectId))) return refused(projectId)
  }

  return { ok: true }
}
