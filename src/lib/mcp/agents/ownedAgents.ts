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

type WriteCount = { count: number }
type AgentRowForDelete = {
  id: string
  displayName: string
  runtimeGeneration: number
}

type AgentManagementTransaction = {
  agent: {
    findFirst(args: {
      where: { id: string; userId: number }
      select: { id: true; displayName: true; runtimeGeneration: true }
    }): Promise<AgentRowForDelete | null>
    delete(args: { where: { id: string } }): Promise<unknown>
  }
  assignees: {
    deleteMany(args: { where: { agentId: string } }): Promise<WriteCount>
    updateMany(args: {
      where: { agentAssignerId: string }
      data: { agentAssignerId: null }
    }): Promise<WriteCount>
  }
  member: {
    deleteMany(args: { where: { agentId: string } }): Promise<WriteCount>
  }
  follower: {
    deleteMany(args: { where: { agentId: string } }): Promise<WriteCount>
  }
  comment: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null; agentDisplayName: string }
    }): Promise<WriteCount>
  }
  taskLease: {
    deleteMany(args: { where: { agentId: string } }): Promise<WriteCount>
  }
  section: {
    updateMany(args: {
      where: { autoAssignAgentId: string }
      data: { autoAssignAgentId: null }
    }): Promise<WriteCount>
  }
  task: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  page: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  report: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  taskEvidence: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  taskSession: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  decisionRequest: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  description: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  priority: {
    updateMany(args: {
      where: { addedByAgentId: string }
      data: { addedByAgentId: null }
    }): Promise<WriteCount>
  }
  estimate: {
    updateMany(args: {
      where: { addedByAgentId: string }
      data: { addedByAgentId: null }
    }): Promise<WriteCount>
  }
  notification: {
    updateMany(args: {
      where: { agentId: string } | { fromAgentId: string }
      data: { agentId: null } | { fromAgentId: null }
    }): Promise<WriteCount>
  }
  webhookSubscription: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
  // Prisma keeps the OAuth acronym casing: oAuthAuthorizationCode, not oauth…
  oAuthAuthorizationCode: {
    updateMany(args: {
      where: { agent_id: string }
      data: { agent_id: null }
    }): Promise<WriteCount>
  }
  chatSession: {
    updateMany(args: {
      where: { agentId: string }
      data: { agentId: null }
    }): Promise<WriteCount>
  }
}

export type AgentManagementDatabase = AgentManagementTransaction & {
  agent: AgentManagementTransaction['agent'] & {
    findMany(args: {
      where: { userId: number; archivedAt: null }
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
    callback: (transaction: AgentManagementTransaction) => Promise<T>,
    options?: { isolationLevel: 'Serializable' }
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
  comment_tombstones: number
}

export async function listOwnedAgents(
  database: AgentManagementDatabase,
  userId: number
): Promise<OwnedAgent[]> {
  const agents = await database.agent.findMany({
    where: { userId, archivedAt: null },
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

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  )
}

/**
 * Hard-deletes one owned agent in one serializable transaction. Every optional
 * agent reference is detached first; comments retain a display-name tombstone
 * because their author is historical data, not disposable agent state.
 */
export async function deleteOwnedAgent(
  database: AgentManagementDatabase,
  userId: number,
  agentId: string,
  invalidateRuntime?: (agentId: string, fenceGeneration?: number) => Promise<void>
): Promise<DeleteOwnedAgentResult | null> {
  let deleted: (DeleteOwnedAgentResult & { runtime_generation: number }) | null = null

  for (let attempt = 0; ; attempt += 1) {
    try {
      deleted = await database.$transaction(
        async (transaction) => {
          const agent = await transaction.agent.findFirst({
            where: { id: agentId, userId },
            select: { id: true, displayName: true, runtimeGeneration: true },
          })
          if (!agent) return null

          const tombstonedComments = await transaction.comment.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null, agentDisplayName: agent.displayName },
          })
          const deletedAssignments = await transaction.assignees.deleteMany({
            where: { agentId: agent.id },
          })
          // Keep assignments made by this agent when another principal owns the
          // assignment; only the historical assigner link needs clearing.
          await transaction.assignees.updateMany({
            where: { agentAssignerId: agent.id },
            data: { agentAssignerId: null },
          })
          const deletedMemberships = await transaction.member.deleteMany({
            where: { agentId: agent.id },
          })
          await transaction.follower.deleteMany({
            where: { agentId: agent.id },
          })
          // A lease has no FK-backed agent relation, so release it explicitly
          // instead of leaving an operational row pointing at a deleted actor.
          await transaction.taskLease.deleteMany({
            where: { agentId: agent.id },
          })
          await transaction.section.updateMany({
            where: { autoAssignAgentId: agent.id },
            data: { autoAssignAgentId: null },
          })
          await transaction.task.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.page.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.report.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.taskEvidence.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.taskSession.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.decisionRequest.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.description.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.priority.updateMany({
            where: { addedByAgentId: agent.id },
            data: { addedByAgentId: null },
          })
          await transaction.estimate.updateMany({
            where: { addedByAgentId: agent.id },
            data: { addedByAgentId: null },
          })
          await transaction.notification.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.notification.updateMany({
            where: { fromAgentId: agent.id },
            data: { fromAgentId: null },
          })
          await transaction.webhookSubscription.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.oAuthAuthorizationCode.updateMany({
            where: { agent_id: agent.id },
            data: { agent_id: null },
          })
          await transaction.chatSession.updateMany({
            where: { agentId: agent.id },
            data: { agentId: null },
          })
          await transaction.agent.delete({ where: { id: agent.id } })

          return {
            id: agent.id,
            deleted_board_memberships: deletedMemberships.count,
            deleted_task_assignments: deletedAssignments.count,
            comment_tombstones: tombstonedComments.count,
            runtime_generation: agent.runtimeGeneration,
          }
        },
        { isolationLevel: 'Serializable' }
      )
      break
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= 2) throw error
    }
  }

  if (!deleted) return null

  if (invalidateRuntime) {
    try {
      await invalidateRuntime(deleted.id, deleted.runtime_generation + 1)
    } catch (error) {
      // The database is authoritative after deletion. A stale Redis snapshot is
      // inaccessible and expires; do not report a failed delete after commit.
      console.warn('[Agent runtime] Snapshot invalidation failed:', error)
    }
  }

  const { runtime_generation: _runtimeGeneration, ...result } = deleted
  return result
}
