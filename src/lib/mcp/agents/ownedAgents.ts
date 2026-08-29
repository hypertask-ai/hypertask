export type OwnedAgentRow = {
  id: string
  displayName: string
  revokedAt: Date | null
  createdAt: Date
  members: Array<{
    project: {
      id: number
      name: string
      title: string | null
    }
  }>
}

type DeleteCount = { count: number }

export type AgentManagementTransaction = {
  agent: {
    findFirst(args: {
      where: { id: string; userId: number }
      select: { id: true }
    }): Promise<{ id: string } | null>
    delete(args: { where: { id: string } }): Promise<unknown>
  }
  assignees: {
    deleteMany(args: { where: { agentId: string } }): Promise<DeleteCount>
  }
  member: {
    deleteMany(args: { where: { agentId: string } }): Promise<DeleteCount>
  }
}

export type AgentManagementDatabase = AgentManagementTransaction & {
  agent: AgentManagementTransaction['agent'] & {
    findMany(args: {
      where: { userId: number }
      orderBy: { createdAt: 'desc' }
      select: {
        id: true
        displayName: true
        revokedAt: true
        createdAt: true
        members: {
          orderBy: { id: 'asc' }
          select: {
            project: {
              select: { id: true; name: true; title: true }
            }
          }
        }
      }
    }): Promise<OwnedAgentRow[]>
  }
  $transaction<T>(
    callback: (transaction: AgentManagementTransaction) => Promise<T>
  ): Promise<T>
}

export type OwnedAgent = {
  id: string
  display_name: string
  revoked: boolean
  created_at: string
  boards: Array<{ id: number; name: string }>
}

export type DeleteOwnedAgentResult = {
  id: string
  deleted_board_memberships: number
  deleted_task_assignments: number
}

export async function listOwnedAgents(
  database: AgentManagementDatabase,
  userId: number
): Promise<OwnedAgent[]> {
  const agents = await database.agent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      displayName: true,
      revokedAt: true,
      createdAt: true,
      members: {
        orderBy: { id: 'asc' },
        select: {
          project: {
            select: { id: true, name: true, title: true },
          },
        },
      },
    },
  })

  return agents.map((agent) => ({
    id: agent.id,
    display_name: agent.displayName,
    revoked: agent.revokedAt !== null,
    created_at: agent.createdAt.toISOString(),
    boards: Array.from(
      new Map(
        agent.members.map(({ project }) => [
          project.id,
          { id: project.id, name: project.title ?? project.name },
        ])
      ).values()
    ),
  }))
}

export async function deleteOwnedAgent(
  database: AgentManagementDatabase,
  userId: number,
  agentId: string
): Promise<DeleteOwnedAgentResult | null> {
  return database.$transaction(async (transaction) => {
    const agent = await transaction.agent.findFirst({
      where: { id: agentId, userId },
      select: { id: true },
    })
    if (!agent) return null

    const deletedAssignments = await transaction.assignees.deleteMany({
      where: { agentId: agent.id },
    })
    const deletedMemberships = await transaction.member.deleteMany({
      where: { agentId: agent.id },
    })
    await transaction.agent.delete({ where: { id: agent.id } })

    return {
      id: agent.id,
      deleted_board_memberships: deletedMemberships.count,
      deleted_task_assignments: deletedAssignments.count,
    }
  })
}
