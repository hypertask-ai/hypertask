// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/agents/presence.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

function sessionFixture(input: {
  agentId: string | null
  lastSeenAt: Date
  status?: 'Active' | 'Idle' | 'Dead'
  taskId: number
  ticketNumber: string
  uniqueIndex: number
  projectId?: number
}) {
  return {
    agentId: input.agentId,
    lastSeenAt: input.lastSeenAt,
    status: input.status ?? 'Active',
    agent: input.agentId
      ? {
          id: input.agentId,
          displayName: `Agent ${input.agentId}`,
          photoURL: `https://example.com/${input.agentId}.png`,
        }
      : null,
    task: {
      id: input.taskId,
      ticketNumber: input.ticketNumber,
      title: `Task ${input.ticketNumber}`,
      uniqueIndex: input.uniqueIndex,
      projectId: input.projectId ?? 11,
    },
  }
}

function leaseFixture(input: {
  agentId: string | null
  heartbeatAt: Date
  ticketNumber: string | null
  title: string
  uniqueIndex: number
  projectId?: number
}) {
  return {
    agentId: input.agentId,
    heartbeatAt: input.heartbeatAt,
    task: {
      ticketNumber: input.ticketNumber,
      title: input.title,
      uniqueIndex: input.uniqueIndex,
      projectId: input.projectId ?? 11,
    },
  }
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'presence-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'hypertask-presence-test'
  process.env.SESSION_SECRET =
    'presence-test-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { createMcpToken },
    { getTeamAgentPresence },
    { GET },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/auth'),
    import('./presence'),
    import('@/app/api/mcp/agents/presence/route'),
  ])

  const prismaMock = prisma as any
  const originalTeamFindUnique = prismaMock.team.findUnique
  const originalProjectFindMany = prismaMock.project.findMany
  const originalTaskSessionFindMany = prismaMock.taskSession.findMany
  const originalTaskLeaseFindMany = prismaMock.taskLease.findMany
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalMemberTeamFindFirst = prismaMock.member_Team.findFirst
  const originalRevokedTokenFindFirst =
    prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
  const globalWithRedis = globalThis as typeof globalThis & {
    redis?: {
      incr(key: string): Promise<number>
      expire(key: string, seconds: number): Promise<number>
    }
  }
  const hadRedis = Object.prototype.hasOwnProperty.call(
    globalWithRedis,
    'redis'
  )
  const originalRedis = globalWithRedis.redis

  const now = Date.now()
  const rows = [
    sessionFixture({
      agentId: null,
      lastSeenAt: new Date(now),
      taskId: 9999,
      ticketNumber: 'HTPR-9999',
      uniqueIndex: 9999,
    }),
    sessionFixture({
      agentId: 'active-agent',
      lastSeenAt: new Date(now),
      taskId: 9001,
      ticketNumber: 'HTPR-4438',
      uniqueIndex: 4438,
    }),
    sessionFixture({
      agentId: 'idle-agent',
      lastSeenAt: new Date(now - 10 * 60 * 1000),
      status: 'Idle',
      taskId: 9002,
      ticketNumber: 'HTPR-4439',
      uniqueIndex: 4439,
    }),
    sessionFixture({
      agentId: 'no-lease-agent',
      lastSeenAt: new Date(now - 60 * 1000),
      taskId: 9005,
      ticketNumber: 'HTPR-4442',
      uniqueIndex: 4442,
    }),
    sessionFixture({
      agentId: 'offline-agent',
      lastSeenAt: new Date(now - 45 * 60 * 1000),
      taskId: 9003,
      ticketNumber: 'HTPR-4440',
      uniqueIndex: 4440,
    }),
    sessionFixture({
      agentId: 'dead-agent',
      lastSeenAt: new Date(now - 60 * 60 * 1000),
      status: 'Dead',
      taskId: 9004,
      ticketNumber: 'HTPR-4441',
      uniqueIndex: 4441,
    }),
  ]
  const leaseRows = [
    leaseFixture({
      agentId: 'active-agent',
      heartbeatAt: new Date(now),
      ticketNumber: 'HTPR-5001',
      title: 'Lease task for active agent',
      uniqueIndex: 5001,
      projectId: 12,
    }),
    leaseFixture({
      agentId: 'idle-agent',
      heartbeatAt: new Date(now - 10 * 60 * 1000),
      ticketNumber: null,
      title: 'Lease task for idle agent',
      uniqueIndex: 5002,
    }),
  ]
  let taskSessionQueryCount = 0

  try {
    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    }
    prismaMock.team.findUnique = async () => ({
      id: 'team-1',
      googleAccountId: 'team-owner-account',
    })
    prismaMock.project.findMany = async (args: Record<string, any>) => {
      assert.deepEqual(args, {
        where: { teamId: 'team-1', status: 'Normal' },
        select: { id: true },
      })
      return [{ id: 11 }, { id: 12 }]
    }
    prismaMock.taskSession.findMany = async (
      args: Record<string, any>
    ) => {
      taskSessionQueryCount += 1
      assert.deepEqual(args.where, {
        agentId: { not: null },
        task: { projectId: { in: [11, 12] } },
      })
      assert.deepEqual(args.orderBy, { lastSeenAt: 'desc' })
      assert.equal(args.take, 1000)
      assert.deepEqual(args.select, {
        agentId: true,
        lastSeenAt: true,
        agent: {
          select: {
            id: true,
            displayName: true,
            photoURL: true,
          },
        },
      })
      return rows
    }
    prismaMock.taskLease.findMany = async (
      args: Record<string, any>
    ) => {
      assert.deepEqual(args.where.agentId, { not: null })
      assert.ok(args.where.expiresAt.gt instanceof Date)
      assert.ok(args.where.expiresAt.gt.getTime() >= now)
      assert.deepEqual(args.where.task, {
        projectId: { in: [11, 12] },
      })
      assert.deepEqual(args.orderBy, { heartbeatAt: 'desc' })
      assert.equal(args.take, 1000)
      assert.deepEqual(args.select, {
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
      })
      return leaseRows
    }

    const presence = await getTeamAgentPresence('team-1')
    assert.equal(presence.length, 5)
    assert.deepEqual(
      presence.map((entry) => entry.agent.id),
      [
        'active-agent',
        'no-lease-agent',
        'idle-agent',
        'offline-agent',
        'dead-agent',
      ],
      'agents are sorted by newest heartbeat and human sessions are excluded'
    )
    assert.deepEqual(
      presence.map((entry) => entry.status),
      ['active', 'active', 'idle', 'offline', 'offline']
    )

    const active = presence[0]
    assert.deepEqual(active, {
      agent: {
        id: 'active-agent',
        displayName: 'Agent active-agent',
        photoURL: 'https://example.com/active-agent.png',
      },
      status: 'active',
      lastSeenAt: rows[1].lastSeenAt.toISOString(),
      currentTask: {
        ticketNumber: 'HTPR-5001',
        title: 'Lease task for active agent',
        url: 'https://app.hypertask.ai/detail/project-12/5001',
      },
    })
    assert.ok(
      active.currentTask?.ticketNumber !==
        rows[1].task.ticketNumber,
      'currentTask comes from the live lease instead of the session'
    )

    const idle = presence.find(
      (entry) => entry.agent.id === 'idle-agent'
    )
    assert.deepEqual(idle?.currentTask, {
      ticketNumber: '5002',
      title: 'Lease task for idle agent',
      url: 'https://app.hypertask.ai/detail/project-11/5002',
    })

    const noLease = presence.find(
      (entry) => entry.agent.id === 'no-lease-agent'
    )
    assert.ok(noLease)
    assert.equal(
      Object.prototype.hasOwnProperty.call(noLease, 'currentTask'),
      false,
      'an agent with a live session but no live lease omits currentTask'
    )

    const ctxUser = {
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
      mcpTokensRevokedAt: null,
      accountId: 'different-account',
    }
    prismaMock.user.findUnique = async () => ctxUser
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.logs.create = async () => ({ id: 1 })
    prismaMock.member_Team.findFirst = async (
      args: Record<string, any>
    ) => {
      assert.deepEqual(args.where, {
        userId: 6,
        teamId: 'team-1',
        status: 'Accepted',
      })
      return null
    }

    const token = createMcpToken(ctxUser.id, ctxUser.email)
    const deniedResponse = await GET(
      new NextRequest(
        'http://localhost/api/mcp/agents/presence?team_id=team-1',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
    )
    const deniedBody = await json(deniedResponse)

    assert.equal(deniedResponse.status, 403)
    assert.deepEqual(deniedBody, {
      success: false,
      error: 'Forbidden',
      message: 'User cannot view agent presence for this team',
      details: { field: 'team_id', code: 'forbidden' },
    })
    assert.equal(
      taskSessionQueryCount,
      1,
      'the route does not query presence when the caller lacks team access'
    )
  } finally {
    prismaMock.team.findUnique = originalTeamFindUnique
    prismaMock.project.findMany = originalProjectFindMany
    prismaMock.taskSession.findMany = originalTaskSessionFindMany
    prismaMock.taskLease.findMany = originalTaskLeaseFindMany
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.member_Team.findFirst = originalMemberTeamFindFirst
    prismaMock.revokedToken.findFirst = originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    if (hadRedis) {
      globalWithRedis.redis = originalRedis
    } else {
      delete globalWithRedis.redis
    }
  }
}

void demo().then(() => {
  console.log('presence.test.ts: all assertions passed')
})
