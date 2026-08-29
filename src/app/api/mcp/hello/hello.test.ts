// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/hello/hello.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

function makeProject(
  id: number,
  options: {
    name?: string
    title?: string | null
    playbook?: Record<string, unknown> | null
    instructions?: string | null
  } = {}
) {
  return {
    id,
    name: options.name ?? `board-${id}`,
    title: options.title === undefined ? `Board ${id}` : options.title,
    playbook: options.playbook ?? null,
    ai_custom_instructions: options.instructions
      ? [{ customInstruction: options.instructions }]
      : [],
  }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET = 'hello-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'hypertask-hello-test'
  process.env.SESSION_SECRET =
    'hello-test-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { createMcpToken },
    { GET, POST },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/auth'),
    import('./route'),
  ])

  const prismaMock = prisma as any
  const originalProjectFindMany = prismaMock.project.findMany
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalRevokedTokenFindFirst = prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
  const globalWithRedis = globalThis as typeof globalThis & {
    redis?: {
      incr(key: string): Promise<number>
      expire(key: string, seconds: number): Promise<number>
    }
  }
  const hadRedis = Object.prototype.hasOwnProperty.call(globalWithRedis, 'redis')
  const originalRedis = globalWithRedis.redis

  const ctxUser = {
    id: 6,
    email: 'valentin@example.com',
    displayName: 'Valentin',
    mcpTokensRevokedAt: null,
  }
  const expectedProjectScope = {
    teamId: { not: null },
    OR: [
      { ownerId: 6 },
      { members: { some: { userId: 6, agentId: null } } },
    ],
  }
  const token = createMcpToken(ctxUser.id, ctxUser.email)
  const request = (method: 'GET' | 'POST') =>
    new NextRequest('http://localhost/api/mcp/hello', {
      method,
      headers: { Authorization: `Bearer ${token}` },
    })

  let projectRows = [
    makeProject(1, {
      name: 'alpha',
      title: 'Alpha',
      playbook: {
        definition_of_done: ['Tests pass'],
        working_rules: 'Keep changes focused.',
      },
    }),
    makeProject(2, {
      name: 'beta',
      title: null,
      instructions: 'Write concise updates.',
    }),
    makeProject(3, {
      name: 'gamma',
      title: 'Gamma',
    }),
  ]
  const projectQueries: Array<Record<string, any>> = []

  try {
    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    }
    prismaMock.user.findUnique = async () => ctxUser
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.logs.create = async () => ({ id: 1 })
    prismaMock.project.findMany = async (args: Record<string, any>) => {
      projectQueries.push(args)
      return projectRows.slice(0, args.take)
    }

    const happyResponse = await GET(request('GET'))
    const happyBody = await json(happyResponse)

    assert.equal(happyResponse.status, 200)
    assert.equal(happyBody.success, true)
    assert.deepEqual(happyBody.user, {
      id: 6,
      displayName: 'Valentin',
      email: 'valentin@example.com',
    })
    assert.deepEqual(happyBody.boards, [
      {
        id: 1,
        name: 'alpha',
        title: 'Alpha',
        taskUrlTemplate:
          'https://app.hypertask.ai/detail/project-1/{taskNumber}',
      },
      {
        id: 2,
        name: 'beta',
        title: 'beta',
        taskUrlTemplate:
          'https://app.hypertask.ai/detail/project-2/{taskNumber}',
      },
      {
        id: 3,
        name: 'gamma',
        title: 'Gamma',
        taskUrlTemplate:
          'https://app.hypertask.ai/detail/project-3/{taskNumber}',
      },
    ])
    assert.equal(happyBody.boardsTotal, 3)
    assert.equal(happyBody.boardsTruncated, false)
    assert.deepEqual(Object.keys(happyBody.capabilities), [
      'tasks',
      'batch',
      'comments',
      'pages',
      'leases',
      'evidence',
      'sessions',
      'escalate',
      'nextTask',
      'webhooks',
    ])
    assert.deepEqual(
      happyBody.conventions.map(
        (entry: {
          projectId: number
          boardTitle: string
          playbook: unknown
          instructions: string | null
        }) => entry
      ),
      [
        {
          projectId: 1,
          boardTitle: 'Alpha',
          playbook: {
            definition_of_done: ['Tests pass'],
            working_rules: 'Keep changes focused.',
          },
          instructions: null,
        },
        {
          projectId: 2,
          boardTitle: 'beta',
          playbook: null,
          instructions: 'Write concise updates.',
        },
      ]
    )
    assert.equal(happyBody.conventionsTruncated, false)

    assert.deepEqual(projectQueries[0].where, {
      status: 'Normal',
      ...expectedProjectScope,
    })
    assert.deepEqual(projectQueries[0].orderBy, { title: 'asc' })
    assert.equal(projectQueries[0].take, 51)
    assert.deepEqual(projectQueries[0].select.ai_custom_instructions, {
      select: { customInstruction: true },
      take: 1,
    })

    projectRows = Array.from({ length: 60 }, (_, index) =>
      makeProject(index + 1)
    )
    const capResponse = await POST(request('POST'))
    const capBody = await json(capResponse)

    assert.equal(capResponse.status, 200)
    assert.equal(capBody.success, true)
    assert.equal(capBody.boards.length, 50)
    assert.equal(capBody.boardsTotal, 51)
    assert.equal(capBody.boardsTruncated, true)
  } finally {
    prismaMock.project.findMany = originalProjectFindMany
    prismaMock.user.findUnique = originalUserFindUnique
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
  console.log('hello.test.ts: all assertions passed')
})
