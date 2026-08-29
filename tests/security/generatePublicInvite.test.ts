// Assert-based demo because this repository has no Vitest setup.
// Lives outside src/pages/api/ because Next's Pages Router treats every file
// under pages/api/ as a route, and would try to compile this test as one.
// Run after installing dependencies: npx tsx tests/security/generatePublicInvite.test.ts
import assert from 'node:assert/strict'

type Project = {
  id: number
  name: string
  ownerId: number
  project_view: {
    user_project_views: unknown[]
    default_view: null
  }
}

function makeProject(ownerId: number): Project {
  return {
    id: 20,
    name: 'security-board',
    ownerId,
    project_view: {
      user_project_views: [],
      default_view: null,
    },
  }
}

function makeResponse() {
  const response = {
    statusCode: 0,
    jsonBody: undefined as unknown,
    status(code: number) {
      response.statusCode = code
      return {
        json(data: unknown) {
          response.jsonBody = data
          return response
        },
      }
    },
  }

  return response
}

function makeRequest({
  method,
  token,
  query = {},
  body = {},
}: {
  method: 'GET' | 'POST'
  token?: string
  query?: Record<string, unknown>
  body?: Record<string, unknown>
}) {
  return {
    method,
    query,
    body,
    headers: token ? { cookie: `ht_session=${token}` } : {},
  } as any
}

function isMemberAndOwnerQuery(args: Record<string, any>) {
  return Boolean(args.include?.owner && args.include?.members)
}

function assertSessionViewScope(args: Record<string, any>) {
  const projectView = args.include?.project_view
  assert.ok(projectView, 'project query includes caller-scoped views')
  assert.equal(
    projectView.include.user_project_views.where.userId,
    6,
    'user project views use the verified session user'
  )
  assert.equal(
    projectView.include.allViews.where.OR[1].userId,
    6,
    'private views use the verified session user'
  )
  assert.equal(
    projectView.include.allViews.include.ViewLastUsed.where.userId,
    6,
    'last-used views use the verified session user'
  )
}

async function callHandler(
  handler: (req: any, res: any) => Promise<unknown>,
  request: any
) {
  const response = makeResponse()
  await handler(request, response as any)
  return response
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'public-invite-test-session-secret'
  process.env.NEXT_PUBLIC_BASEURL = 'http://localhost:3000'
  delete process.env.BETTER_AUTH_ENABLED

  const [
    { default: prisma },
    { signSession },
    { default: handler },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/auth/session'),
    import('@/pages/api/invite/generatePublicInvite'),
  ])

  const prismaMock = prisma as any
  const originalProjectFindUnique = prismaMock.project.findUnique
  const originalInviteFindFirst = prismaMock.invite.findFirst
  const originalInviteCreate = prismaMock.invite.create
  const originalInviteUpdate = prismaMock.invite.update

  try {
    prismaMock.project.findUnique = async () => {
      assert.fail('unauthenticated requests must not query projects')
    }
    prismaMock.invite.findFirst = async () => {
      assert.fail('unauthenticated requests must not query invites')
    }
    prismaMock.invite.create = async () => {
      assert.fail('unauthenticated requests must not create invites')
    }
    prismaMock.invite.update = async () => {
      assert.fail('unauthenticated requests must not update invites')
    }

    const unauthorizedGet = await callHandler(
      handler,
      makeRequest({
        method: 'GET',
        query: { projectId: '20', userId: '999' },
      })
    )
    assert.equal(unauthorizedGet.statusCode, 401)
    assert.deepEqual(unauthorizedGet.jsonBody, {
      message: 'Unauthorized',
    })

    const unauthorizedPost = await callHandler(
      handler,
      makeRequest({
        method: 'POST',
        body: { projectId: 20, userId: 999 },
      })
    )
    assert.equal(unauthorizedPost.statusCode, 401)
    assert.deepEqual(unauthorizedPost.jsonBody, {
      message: 'Unauthorized',
    })

    const token = signSession({ id: 6 })
    const forbiddenProject = makeProject(1)
    let forbiddenInviteCalls = 0

    prismaMock.project.findUnique = async (args: Record<string, any>) => {
      if (isMemberAndOwnerQuery(args)) {
        return {
          ...forbiddenProject,
          owner: { id: 1 },
          members: [],
        }
      }
      if (args.include?.project_view) {
        assertSessionViewScope(args)
      }
      return forbiddenProject
    }
    prismaMock.invite.findFirst = async () => {
      forbiddenInviteCalls += 1
      return null
    }
    prismaMock.invite.create = async () => {
      forbiddenInviteCalls += 1
      return null
    }
    prismaMock.invite.update = async () => {
      forbiddenInviteCalls += 1
      return null
    }

    const forbiddenGet = await callHandler(
      handler,
      makeRequest({
        method: 'GET',
        token,
        query: { projectId: '20' },
      })
    )
    assert.equal(forbiddenGet.statusCode, 403)
    assert.deepEqual(forbiddenGet.jsonBody, {
      message: 'Forbidden',
    })

    const forbiddenPost = await callHandler(
      handler,
      makeRequest({
        method: 'POST',
        token,
        body: { projectId: 20 },
      })
    )
    assert.equal(forbiddenPost.statusCode, 403)
    assert.deepEqual(forbiddenPost.jsonBody, {
      message: 'Forbidden',
    })
    assert.equal(
      forbiddenInviteCalls,
      0,
      'forbidden requests do not read or mutate invites'
    )

    const allowedProject = makeProject(6)
    let inviteCreateCalls = 0

    prismaMock.project.findUnique = async (args: Record<string, any>) => {
      assert.equal(args.where.id, 20)
      if (isMemberAndOwnerQuery(args)) {
        return {
          ...allowedProject,
          owner: { id: 6 },
          members: [{ userId: 6, user: { id: 6 } }],
        }
      }
      if (args.include?.project_view) {
        assertSessionViewScope(args)
      }
      return allowedProject
    }
    prismaMock.invite.findFirst = async (args: Record<string, any>) => {
      assert.equal(args.where.projectId, 20)
      assert.equal(args.where.key, 'public')
      assert.equal(args.where.expired, false)
      assert.deepEqual(args.where.uses, { lte: 0 })
      return null
    }
    prismaMock.invite.create = async (args: Record<string, any>) => {
      inviteCreateCalls += 1
      assert.equal(args.data.projectId, 20)
      assert.equal(
        args.data.userId,
        6,
        'GET invite attribution cannot use the spoofed query user'
      )
      assert.notEqual(args.data.userId, 999)
      return {
        id: 'invite-get',
        uses: -1,
        project: { name: allowedProject.name },
      }
    }

    const allowedGet = await callHandler(
      handler,
      makeRequest({
        method: 'GET',
        token,
        query: { projectId: '20', userId: '999' },
      })
    )
    assert.equal(allowedGet.statusCode, 200)
    assert.deepEqual(allowedGet.jsonBody, {
      inviteLink:
        'http://localhost:3000/invite?key=invite-get&project=security-board&projectId=20',
      amountUsed: 0,
    })

    prismaMock.invite.findFirst = async (args: Record<string, any>) => {
      assert.equal(args.where.projectId, 20)
      assert.equal(args.where.key, 'public')
      assert.equal(args.where.expired, false)
      assert.equal(args.where.uses, undefined)
      return { id: 'old-post-invite' }
    }
    prismaMock.invite.update = async (args: Record<string, any>) => {
      assert.equal(args.where.id, 'old-post-invite')
      assert.deepEqual(
        {
          uses: args.data.uses,
          expired: args.data.expired,
        },
        {
          uses: 0,
          expired: true,
        }
      )
      assert.ok(args.data.expiresAt instanceof Date)
      return { id: 'old-post-invite' }
    }
    prismaMock.invite.create = async (args: Record<string, any>) => {
      inviteCreateCalls += 1
      assert.equal(args.data.projectId, 20)
      assert.equal(
        args.data.userId,
        6,
        'POST invite attribution cannot use the spoofed body user'
      )
      assert.notEqual(args.data.userId, 999)
      return {
        id: 'invite-post',
        uses: -1,
        project: { name: allowedProject.name },
      }
    }

    const allowedPost = await callHandler(
      handler,
      makeRequest({
        method: 'POST',
        token,
        body: { projectId: 20, userId: 999 },
      })
    )
    assert.equal(allowedPost.statusCode, 200)
    assert.deepEqual(allowedPost.jsonBody, {
      inviteLink:
        'http://localhost:3000/invite?key=invite-post&project=security-board&projectId=20',
      amountUsed: 0,
    })
    assert.equal(inviteCreateCalls, 2)

    let failureModeInviteCalls = 0
    prismaMock.project.findUnique = async (args: Record<string, any>) => {
      if (isMemberAndOwnerQuery(args)) {
        throw new Error('simulated member lookup failure')
      }
      if (args.include?.project_view) {
        assertSessionViewScope(args)
      }
      return forbiddenProject
    }
    prismaMock.invite.findFirst = async () => {
      failureModeInviteCalls += 1
      return null
    }
    prismaMock.invite.create = async () => {
      failureModeInviteCalls += 1
      return null
    }
    prismaMock.invite.update = async () => {
      failureModeInviteCalls += 1
      return null
    }

    const failedMemberLookupGet = await callHandler(
      handler,
      makeRequest({
        method: 'GET',
        token,
        query: { projectId: '20' },
      })
    )
    assert.equal(failedMemberLookupGet.statusCode, 403)
    assert.deepEqual(failedMemberLookupGet.jsonBody, {
      message: 'Forbidden',
    })

    const failedMemberLookupPost = await callHandler(
      handler,
      makeRequest({
        method: 'POST',
        token,
        body: { projectId: 20 },
      })
    )
    assert.equal(failedMemberLookupPost.statusCode, 403)
    assert.deepEqual(failedMemberLookupPost.jsonBody, {
      message: 'Forbidden',
    })
    assert.equal(
      failureModeInviteCalls,
      0,
      'non-array membership results deny before invite access'
    )
  } finally {
    prismaMock.project.findUnique = originalProjectFindUnique
    prismaMock.invite.findFirst = originalInviteFindFirst
    prismaMock.invite.create = originalInviteCreate
    prismaMock.invite.update = originalInviteUpdate
  }
}

void demo().then(() => {
  console.log('generatePublicInvite.test.ts: all assertions passed')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
