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
    where: { id: string; userId: number }
    select: {
      id: true
      userId: true
      members: {
        select: {
          projectId: true
          project: { select: { teamId: true } }
        }
      }
    }
  }): Promise<{
    id: string
    userId: number
    members: Membership[]
  } | null>
}
type MemberWrite = {
  deleteMany(args: {
    where: { agentId: string; projectId: { in: number[] } }
  }): Promise<{ count: number }>
  createMany(args: {
    data: Array<{ projectId: number; userId: number; agentId: string }>
    skipDuplicates: boolean
  }): Promise<{ count: number }>
}

type AgentBoardUpdateTransaction = {
  agent: AgentRead
  member: MemberWrite
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
    userId: number
  ) => Promise<AccessibleAgentBoard | null>,
  userId: number,
  input: AgentBoardUpdateInput
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(
        async ({ agent: agentStore, member }) => {
          const agent = await agentStore.findFirst({
            where: { id: input.agentId, userId },
            select: {
              id: true,
              userId: true,
              members: {
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

          const existing = new Map(
            agent.members.map((membership) => [membership.projectId, membership])
          )
          const removeSet = new Set(input.removeProjectIds)
          const toRemove = input.removeProjectIds.filter((id) => existing.has(id))
          const toAdd = input.addProjectIds.filter((id) => !existing.has(id))
          const additions = await Promise.all(
            toAdd.map(async (id) => {
              const project = await getAccessibleBoard(id, userId)
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
              return project
            })
          )

          // Removal-only updates can clean up legacy teamless or mixed-team rows.
          if (additions.length) {
            const finalTeams = [
              ...agent.members
                .filter((membership) => !removeSet.has(membership.projectId))
                .map((membership) => membership.project.teamId),
              ...additions.map((project) => project.teamId),
            ]
            if (finalTeams.includes(null) || new Set(finalTeams).size > 1) {
              throw new AgentBoardUpdateError(
                'Agents can only belong to boards in one team',
                400,
                'add_project_ids'
              )
            }
          }

          if (!toAdd.length && !toRemove.length) {
            return { agentId: agent.id, addedProjects: 0, removedProjects: 0 }
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
