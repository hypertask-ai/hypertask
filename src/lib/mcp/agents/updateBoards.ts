import { agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import type { Prisma } from '@prisma/client'
import { getAgentBoardScope } from '@/lib/mcp/agents/delegatedAccess'

import { crossTeamAgentsEnabled, ownerTeamWhere } from '@/lib/agents/crossTeam'

import { agentWithinTeamWhere } from '@/lib/mcp/managementKeyTeamScope'

const MAX_PROJECT_UPDATES = 100
const MAX_TRANSACTION_ATTEMPTS = 3

export class AgentBoardUpdateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string
  ) {
    super(message)
    this.name = 'AgentBoardUpdateError'
  }
}

export type AgentBoardUpdateInput = {
  agentId: string
  addProjectIds: number[]
  removeProjectIds: number[]
}

type Membership = { projectId: number; project: { teamId: string | null } }
type AgentRead = {
  findFirst(args: {
    where: Prisma.AgentWhereInput
    select: {
      id: true
      userId: true
      revokedAt: true
      archivedAt: true
      credentialTeamId: true
      credentialTeamAccessBinding: true
      boardHomeTeamId: true
      crossTeamHomeTeamId: true
      crossTeamAccessGranted: true
      members: {
        orderBy: { id: 'asc' }
        select: {
          projectId: true
          project: { select: { teamId: true } }
        }
      }
    }
  }): Promise<{
    id: string
    userId: number
    revokedAt: Date | null
    archivedAt: Date | null
    credentialTeamId: string | null
    credentialTeamAccessBinding: string | null
    boardHomeTeamId: string | null
    crossTeamHomeTeamId: string | null
    crossTeamAccessGranted: boolean
    members: Membership[]
  } | null>
}
type MemberWrite = {
  findMany(args: {
    where: { agentId: string; projectId: { in: number[] }; status?: 'Accepted'; agent?: { userId: number; revokedAt: null } }
    select: { projectId: true }
  }): Promise<Array<{ projectId: number }>>
  deleteMany(args: {
    where: { agentId: string; projectId: { in: number[] } }
  }): Promise<{ count: number }>
  createMany(args: {
    data: Array<{ projectId: number; userId: number; agentId: string }>
    skipDuplicates: boolean
  }): Promise<{ count: number }>
}

type AgentBoardUpdateTransaction = {
  agent: AgentRead & {
    update(args: Pick<Prisma.AgentUpdateArgs, "where" | "data">): Promise<unknown>
  }
  member: MemberWrite
  project: Pick<Prisma.TransactionClient["project"], "findFirst">
}

export type AgentBoardUpdateDatabase = {
  $transaction<T>(
    callback: (tx: AgentBoardUpdateTransaction) => Promise<T>,
    options: { isolationLevel: 'Serializable' }
  ): Promise<T>
}

export type AccessibleAgentBoard = { id: number; teamId: string | null }

function projectIds(value: unknown, field: string): number[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > MAX_PROJECT_UPDATES ||
    !value.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new AgentBoardUpdateError(
      `${field} must be an array of at most ${MAX_PROJECT_UPDATES} positive integers`,
      400,
      field
    )
  }
  return [...new Set(value as number[])]
}

export function parseAgentBoardUpdateBody(body: unknown): AgentBoardUpdateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AgentBoardUpdateError('Request body must be a JSON object', 400, 'body')
  }
  const raw = body as Record<string, unknown>
  const agentId = typeof raw.agent_id === 'string' ? raw.agent_id.trim() : ''
  if (!agentId) {
    throw new AgentBoardUpdateError('agent_id is required', 400, 'agent_id')
  }

  const addProjectIds = projectIds(raw.add_project_ids, 'add_project_ids')
  const removeProjectIds = projectIds(raw.remove_project_ids, 'remove_project_ids')
  if (!addProjectIds.length && !removeProjectIds.length) {
    throw new AgentBoardUpdateError(
      'Provide add_project_ids or remove_project_ids',
      400,
      'add_project_ids'
    )
  }
  const removals = new Set(removeProjectIds)
  if (addProjectIds.some((id) => removals.has(id))) {
    throw new AgentBoardUpdateError(
      'A project cannot be added and removed in the same update',
      400,
      'project_ids'
    )
  }
  return { agentId, addProjectIds, removeProjectIds }
}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  )
}

export async function updateOwnedAgentBoards(
  database: AgentBoardUpdateDatabase,
  getAccessibleBoard: (
    projectId: number,
    userId: number,
    database: AgentBoardUpdateTransaction,
  ) => Promise<AccessibleAgentBoard | null>,
  userId: number,
  input: AgentBoardUpdateInput,
  teamId?: string,
  actingAgentId?: string
) {
  const scopeWhere = teamId ? agentWithinTeamWhere(teamId) : {}
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(
        async (tx) => {
          const enabled = await crossTeamAgentsEnabled(userId)
          const { agent: agentStore, member } = tx
          const agent = await agentStore.findFirst({
            where: { ...scopeWhere, id: input.agentId, userId },
            select: {
              id: true,
              userId: true,
              revokedAt: true,
              archivedAt: true,
              credentialTeamId: true,
              credentialTeamAccessBinding: true,
              boardHomeTeamId: true,
              crossTeamHomeTeamId: true,
              crossTeamAccessGranted: true,
              members: {
                orderBy: { id: 'asc' },
                select: { projectId: true, project: { select: { teamId: true } } },
              },
            },
          })
          if (!agent) {
            throw new AgentBoardUpdateError(
              'Agent not found or you do not own this agent',
              404,
              'agent_id'
            )
          }

          let allowedProjects: Set<number> | undefined
          if (actingAgentId) {
            const touched = [...input.addProjectIds, ...input.removeProjectIds]
            const inScope = await getAgentBoardScope(
              member,
              actingAgentId,
              userId,
              [...touched, ...agent.members.map((row) => row.projectId)]
            )
            allowedProjects = inScope
            touched.forEach((id) => recordAgentBoardScopeMiss(id, 'write'))
            const outside = touched.filter((id) => !inScope.has(id) || teamId != null && agent.members.some((row) => row.projectId === id && row.project.teamId !== teamId))
            if (outside.length) {
              throw new AgentBoardUpdateError(
                `This agent is not a member of project ${outside.join(', ')}, so it cannot grant or remove access there`,
                403,
                'project_ids'
              )
            }
          }
          const existing = new Map(
            agent.members.map((membership) => [membership.projectId, membership])
          )
          const toRemove = input.removeProjectIds.filter((id) => existing.has(id))
          const toAdd = input.addProjectIds.filter((id) => !existing.has(id))
          const additions = await Promise.all(
            toAdd.map(async (id) => {
              const project = await getAccessibleBoard(id, userId, tx)
              if (!project || project.id !== id) {
                throw new AgentBoardUpdateError(
                  `You do not have access to project ${id}`,
                  403,
                  'add_project_ids'
                )
              }
              if (!project.teamId) {
                throw new AgentBoardUpdateError(
                  'Agents require a team board',
                  400,
                  'add_project_ids'
                )
              }
              if (
                (teamId && project.teamId !== teamId) ||
                (agent.credentialTeamId && project.teamId !== agent.credentialTeamId) ||
                (agent.credentialTeamAccessBinding && !agent.credentialTeamId)
              ) {
                throw new AgentBoardUpdateError(
                  `You do not have access to project ${id}`,
                  403,
                  'add_project_ids'
                )
              }
              if (enabled || agent.crossTeamAccessGranted) {
                const ownerTeamBoard = await tx.project.findFirst({
                  where: { id, status: 'Normal', team: ownerTeamWhere(userId) },
                  select: { id: true },
                })
                if (!ownerTeamBoard || agent.revokedAt || agent.archivedAt) {
                  throw new AgentBoardUpdateError(
                    `You do not have access to project ${id}`,
                    403,
                    'add_project_ids'
                  )
                }
              }
              return project
            })
          )

          const homeTeamId = agent.crossTeamHomeTeamId ?? agent.boardHomeTeamId ??
            agent.members.find((membership) => membership.project.teamId)?.project.teamId ??
            additions[0]?.teamId
          const expandsTeams = additions.some((project) =>
            homeTeamId != null && project.teamId !== homeTeamId
          ) || new Set([
            ...agent.members.map((membership) => membership.project.teamId),
            ...additions.map((project) => project.teamId),
          ].filter((teamId) => teamId != null)).size > 1
          if (additions.length && !enabled) {
            const finalTeams = [
              ...agent.members.filter((membership) => !input.removeProjectIds.includes(membership.projectId))
                .map((membership) => membership.project.teamId),
              ...additions.map((project) => project.teamId),
            ]
            const invalidTeam = agent.crossTeamAccessGranted
              ? additions.some((project) => project.teamId !== homeTeamId)
              : finalTeams.includes(null) || new Set(finalTeams).size > 1
            if (invalidTeam) {
              throw new AgentBoardUpdateError(
                'Agents can only belong to boards in one team',
                400,
                'add_project_ids'
              )
            }
          }
          const markExpanded = additions.length > 0 && expandsTeams && !agent.crossTeamHomeTeamId
          const grantCrossTeamAccess = enabled && additions.length > 0 && expandsTeams && !agent.crossTeamAccessGranted
          if (homeTeamId && ((!agent.boardHomeTeamId && (toAdd.length || toRemove.length)) || markExpanded || grantCrossTeamAccess)) {
            await agentStore.update({
              where: { id: agent.id },
              data: {
                ...(!agent.boardHomeTeamId ? { boardHomeTeamId: homeTeamId } : {}),
                ...(markExpanded ? { crossTeamHomeTeamId: homeTeamId } : {}),
                ...(grantCrossTeamAccess ? { crossTeamAccessGranted: true } : {}),
              },
            })
          }

          const removedSet = new Set(toRemove)
          const projectIds = [
            ...[...existing.keys()].filter((id) => !removedSet.has(id)),
            ...toAdd,
          ].filter((id) => {
            if (actingAgentId) recordAgentBoardScopeMiss(id, 'read')
            return (!teamId || existing.get(id)?.project.teamId === teamId || additions.some((project) => project.id === id)) && (!actingAgentId || !agentScopeEnforced() || allowedProjects?.has(id))
          }).sort((a, b) => a - b)
          if (!toAdd.length && !toRemove.length) {
            return {
              agentId: agent.id,
              addedProjects: 0,
              removedProjects: 0,
              projectIds,
            }
          }
          const removed = toRemove.length
            ? await member.deleteMany({
                where: { agentId: agent.id, projectId: { in: toRemove } },
              })
            : { count: 0 }
          const added = toAdd.length
            ? await member.createMany({
                data: toAdd.map((projectId) => ({
                  projectId,
                  userId: agent.userId,
                  agentId: agent.id,
                })),
                skipDuplicates: true,
              })
            : { count: 0 }
          return {
            agentId: agent.id,
            addedProjects: added.count,
            removedProjects: removed.count,
            projectIds,
          }
        },
        { isolationLevel: 'Serializable' }
      )
    } catch (error) {
      if (!isSerializationConflict(error) || attempt + 1 >= MAX_TRANSACTION_ATTEMPTS) {
        throw error
      }
    }
  }
}
