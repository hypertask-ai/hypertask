// Assert-based demo because this repository has no Vitest setup.
// Lives outside src/pages/api/ because Next's Pages Router treats every file
// under pages/api/ as a route, and would try to compile this test as one.
// Run after installing dependencies: npx tsx tests/security/getCount.test.ts
import assert from 'node:assert/strict'

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

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'get-count-test-session-secret'
  delete process.env.BETTER_AUTH_ENABLED

  const [
    { default: prisma },
    { signSession },
    { default: handler },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/auth/session'),
    import('@/pages/api/notifications/getCount'),
  ])

  const prismaMock = prisma as any
  const originalNotificationFindMany = prismaMock.notification.findMany

  try {
    let findManyCalls = 0
    prismaMock.notification.findMany = async () => {
      findManyCalls += 1
      return []
    }

    const unauthorizedResponse = makeResponse()
    await handler(
      {
        method: 'GET',
        query: {},
        body: {},
        headers: {},
      } as any,
      unauthorizedResponse as any
    )

    assert.equal(unauthorizedResponse.statusCode, 401)
    assert.deepEqual(unauthorizedResponse.jsonBody, {
      message: 'Unauthorized',
    })
    assert.equal(findManyCalls, 0, 'unauthenticated requests do not query Prisma')

    const token = signSession({ id: 6 })
    const notifications = [
      { seen: true },
      { seen: false },
      { seen: true },
    ]

    prismaMock.notification.findMany = async (
      args: Record<string, any>
    ) => {
      findManyCalls += 1
      assert.equal(
        args.where.userId,
        6,
        'notification count uses the verified session user'
      )
      assert.notEqual(
        args.where.userId,
        999,
        'notification count ignores the spoofed query user'
      )
      // HTPR-5683: a reminder returned onto an archived task must still be
      // counted, mirroring visibleUserInboxWhere's archive exception.
      assert.deepEqual(
        args.where.AND[0].OR,
        [
          { task: { status: 'Normal' } },
          { task: { status: 'Archive' }, returnedFromReminders: true },
        ],
        'unread count keeps the returned-reminder exception in step with the inbox'
      )
      return notifications
    }

    const authenticatedResponse = makeResponse()
    await handler(
      {
        method: 'GET',
        query: { userId: '999' },
        body: {},
        headers: { cookie: `ht_session=${token}` },
      } as any,
      authenticatedResponse as any
    )

    assert.equal(authenticatedResponse.statusCode, 200)
    assert.deepEqual(authenticatedResponse.jsonBody, {
      all: 3,
      unseen: 1,
    })
    assert.equal(findManyCalls, 1)
  } finally {
    prismaMock.notification.findMany = originalNotificationFindMany
  }
}

void demo().then(() => {
  console.log('getCount.test.ts: all assertions passed')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
