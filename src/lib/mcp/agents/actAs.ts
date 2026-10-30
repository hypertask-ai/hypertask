import type { McpAuthContext } from '@/lib/mcp/auth'
import type { AgentScopes } from '@/lib/mcp/agents/scopes'

export class ActAsAgentError extends Error {
  readonly status = 403
  readonly code = 'act_as_agent_refused'

  constructor(message: string) {
    super(message)
    this.name = 'ActAsAgentError'
  }
}

type ActAsAgentRow = {
  id: string
  runtimeGeneration: number
  permissions: unknown
  members: Array<{ projectId: number }>
}

export type ActAsAgentDatabase = {
  agent: {
    findFirst(args: {
      where: { id: string; userId: number; revokedAt: null; archivedAt: null; credentialTeamId: null }
      select: {
        id: true
        runtimeGeneration: true
        permissions: true
        members: { where: { status: 'Accepted' }; select: { projectId: true } }
      }
    }): Promise<ActAsAgentRow | null>
  }
}

export type ActAsAgentRequest = {
  agentId: string
  projectIds: readonly number[]
  write: boolean
  requireBoard: boolean
}

export async function actAsAgentContext(
  database: ActAsAgentDatabase,
  auth: McpAuthContext,
  request: ActAsAgentRequest
): Promise<McpAuthContext> {
  if (auth.agentId) {
    throw new ActAsAgentError('An agent credential cannot act as another agent; use as_agent from a signed-in person\'s connection.')
  }
  if (auth.management) {
    throw new ActAsAgentError('as_agent needs a signed-in person\'s connection, not a management key.')
  }
  const agent = await database.agent.findFirst({
    where: { id: request.agentId, userId: auth.user.id, revokedAt: null, archivedAt: null, credentialTeamId: null },
    select: {
      id: true,
      runtimeGeneration: true,
      permissions: true,
      members: { where: { status: 'Accepted' }, select: { projectId: true } },
    },
  })
  if (!agent) {
    throw new ActAsAgentError(`Agent ${request.agentId} is not an active agent you own.`)
  }
  if (request.write && (agent.permissions as AgentScopes | null)?.role === 'read') {
    throw new ActAsAgentError(`Agent ${agent.id} has the read role and cannot write.`)
  }
  if (request.requireBoard && request.projectIds.length === 0) {
    throw new ActAsAgentError('as_agent needs a ticket or board in input so the agent\'s board access can be checked.')
  }
  const boards = new Set(agent.members.map((member) => member.projectId))
  const missing = request.projectIds.find((projectId) => !boards.has(projectId))
  if (missing !== undefined) {
    throw new ActAsAgentError(`Agent ${agent.id} is not a member of board ${missing}. Add it with hypertask_agents ensure.`)
  }
  return {
    user: auth.user,
    teamScope: null,
    agentId: agent.id,
    agentRuntimeGeneration: agent.runtimeGeneration,
  }
}
