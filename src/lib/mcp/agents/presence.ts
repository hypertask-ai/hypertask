import prisma from '@/lib/prisma'

export type AgentPresenceStatus = 'active' | 'idle' | 'offline'

export type TeamAgentPresence = {
  agent: {
    id: string
    displayName: string | null
    photoURL: string | null
  }
  status: AgentPresenceStatus
  lastSeenAt: string
  currentTask?: {
    ticketNumber: string
    title: string
    url: string
  }
}

export class TeamAgentPresenceNotFoundError extends Error {
  constructor(teamId: string) {
    super(`Team ${teamId} not found`)
    this.name = 'TeamAgentPresenceNotFoundError'
  }
}

function classifyPresence(lastSeenAt: Date, now: number): AgentPresenceStatus {
  const ageMs = now - lastSeenAt.getTime()

  if (ageMs < 5 * 60 * 1000) return 'active'
  if (ageMs < 30 * 60 * 1000) return 'idle'
  return 'offline'
}

export async function getTeamAgentPresence(
  teamId: string
): Promise<TeamAgentPresence[]> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, googleAccountId: true },
  })

  if (!team) {
    throw new TeamAgentPresenceNotFoundError(teamId)
  }

  const projects = await prisma.project.findMany({
    where: { teamId, status: 'Normal' },
    select: { id: true },
  })
  const projectIds = projects.map((project) => project.id)

  const sessions = await prisma.taskSession.findMany({
    where: {
      agentId: { not: null },
      task: { projectId: { in: projectIds } },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 1000,
    select: {
      agentId: true,
      lastSeenAt: true,
      agent: {
        select: {
          id: true,
          displayName: true,
          photoURL: true,
        },
      },
    },
  })

  type PresenceSession = (typeof sessions)[number]
  const latestByAgent = new Map<string, PresenceSession>()

  for (const session of sessions) {
    if (!session.agentId || !session.agent) continue

    if (!latestByAgent.has(session.agentId)) {
      latestByAgent.set(session.agentId, session)
    }
  }

  const now = Date.now()
  const nowDate = new Date(now)
  const leases = await prisma.taskLease.findMany({
    where: {
      agentId: { not: null },
      expiresAt: { gt: nowDate },
      task: { projectId: { in: projectIds } },
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 1000,
    select: {
      agentId: true,
      heartbeatAt: true,
      task: {
        select: {
          ticketNumber: true,
          title: true,
          uniqueIndex: true,
          projectId: true,
        },
      },
    },
  })

  type PresenceLease = (typeof leases)[number]
  const currentTaskByAgent = new Map<string, PresenceLease>()

  for (const lease of leases) {
    if (!lease.agentId) continue

    if (!currentTaskByAgent.has(lease.agentId)) {
      currentTaskByAgent.set(lease.agentId, lease)
    }
  }

  return [...latestByAgent.entries()]
    .map(([agentId, session]) => {
      const currentTask = currentTaskByAgent.get(agentId)?.task

      return {
        agent: {
          id: session.agent!.id,
          displayName: session.agent!.displayName,
          photoURL: session.agent!.photoURL,
        },
        status: classifyPresence(session.lastSeenAt, now),
        lastSeenAt: session.lastSeenAt.toISOString(),
        ...(currentTask
          ? {
              currentTask: {
                ticketNumber:
                  currentTask.ticketNumber ??
                  String(currentTask.uniqueIndex),
                title: currentTask.title,
                url: `https://app.hypertask.ai/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`,
              },
            }
          : {}),
      }
    })
    .sort(
      (left, right) =>
        new Date(right.lastSeenAt).getTime() -
        new Date(left.lastSeenAt).getTime()
    )
    .slice(0, 100)
}
