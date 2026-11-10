const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

process.env.SESSION_SECRET = 'htpr-8979-fixture-secret'
process.env.JWT_SECRET = 'htpr-8979-fixture-secret'

const STRAIGHT_BOARD_UNVERIFIED = {
  uid: 'email_sb_2f8f0f7c-2a7a-4c3f-9c1c-9d5d2a1b7c40',
  emailVerified: false,
  UserSetting: { isVerified: false },
}
const STRAIGHT_BOARD_VERIFIED = {
  uid: 'email_sb_2f8f0f7c-2a7a-4c3f-9c1c-9d5d2a1b7c40',
  emailVerified: true,
  UserSetting: { isVerified: true },
}
const KNOWN_EMAIL_UNVERIFIED = {
  uid: 'email_2f8f0f7c-2a7a-4c3f-9c1c-9d5d2a1b7c40',
  emailVerified: false,
  UserSetting: { isVerified: false },
}

function prismaWithUser(user) {
  return { user: { findUnique: async () => user } }
}

function notificationFixture(user) {
  const sent = []
  const guard = load('src/lib/auth/unverifiedEmailAccount.ts', {
    '@/lib/prisma': prismaWithUser(user),
  })
  const modules = load('src/utils/controllers/notifications/sendNotification.ts', {
    '@/lib/auth/unverifiedEmailAccount': guard,
    '@/lib/prisma': prismaWithUser(user),
    '@/lib/flags': {
      HTPR_7031_INVITE_EMAIL_FLAG: 'htpr-7031-invite-email',
      isFeatureEnabled: async () => false,
    },
    '@/lib/access/canReadTaskNow': { canReadTaskNow: async () => true },
    './emailTemplates': {
      renderNotificationEmail: () => ({ subject: 'Task moved', html: '<p>moved</p>' }),
    },
    './digest': { enqueueDigest: async () => false },
    '@/lib/email/sendEmail': { sendEmail: async (payload) => { sent.push(payload) } },
    '@/lib/email/unsubscribe': { unsubscribeHeaders: () => ({}) },
    './projectMute': { isTaskProjectMuted: async () => false },
    '@/lib/email/inboundReply': { createNotificationReplyAddress: () => 'reply@hypertask.ai' },
  })
  const shouldNotify = load('src/utils/controllers/notifications/shouldNotify.ts', {
    '@/lib/auth/unverifiedEmailAccount': guard,
    '@/lib/prisma': {
      user: { findUnique: async () => user },
      userSetting: {
        findUnique: async () => ({
          notification: true,
          notificationMatrix: null,
          notificationPreference: 'all',
        }),
      },
    },
  })
  return { ...modules, ...shouldNotify, sent }
}

const mentionBody = (userId) => ({
  sender: 'Runner',
  recipient: 'signup@example.com',
  recipientName: 'signup',
  title: 'A task',
  link: 'https://app.hypertask.ai/detail/project-15/1',
  commentText: 'look here',
  userId,
  taskId: undefined,
})

test('unverified straight-board signup receives no mention email', async () => {
  const fixture = notificationFixture(STRAIGHT_BOARD_UNVERIFIED)

  const handled = await fixture.sendEmailNotification('Mention', mentionBody(6))

  assert.equal(handled, true)
  assert.deepEqual(fixture.sent, [])
})

test('unverified straight-board signup is refused every email and push notification', async () => {
  const fixture = notificationFixture(STRAIGHT_BOARD_UNVERIFIED)

  assert.equal(await fixture.shouldNotify(6, 'Mentioned', 'email'), false)
  assert.equal(await fixture.shouldNotify(6, 'Assigned', 'email'), false)
  assert.equal(await fixture.shouldNotify(6, 'TaskMoved', 'push'), false)
})

test('verified straight-board signup keeps mention email and push', async () => {
  const fixture = notificationFixture(STRAIGHT_BOARD_VERIFIED)

  const handled = await fixture.sendEmailNotification('Mention', mentionBody(6))

  assert.equal(handled, true)
  assert.equal(fixture.sent.length, 1)
  assert.equal(fixture.sent[0].to, 'signup@example.com')
  assert.equal(await fixture.shouldNotify(6, 'Mentioned', 'email'), true)
})

test('a normal account that has not verified its address still gets account mail', async () => {
  const fixture = notificationFixture(KNOWN_EMAIL_UNVERIFIED)

  assert.equal(await fixture.shouldNotify(6, 'Mentioned', 'email'), true)
})

function memoryRedis() {
  const values = new Map()
  return {
    values,
    async set(key, value) {
      values.set(key, value)
      return 'OK'
    },
    async get(key) {
      return values.get(key) ?? null
    },
    async mget(...keys) {
      return keys.map((key) => values.get(key) ?? null)
    },
  }
}

async function atOffset(offsetSeconds, run) {
  const realNow = Date.now
  const realClock = realNow()
  Date.now = () => realClock + offsetSeconds * 1000
  try {
    return await run()
  } finally {
    Date.now = realNow
  }
}

test('confirming the address ends the earlier sign-in and keeps a later one', async () => {
  const redis = memoryRedis()
  const session = load('src/lib/auth/session.ts')
  const revocation = load('src/lib/auth/sessionRevocation.ts', {
    '@/lib/redis': { getRedis: async () => redis },
  })

  const earlierSignIn = await atOffset(-600, async () => session.signSession({ id: 6, email: 'signup@example.com' }))

  assert.equal(await revocation.isSessionTokenRevoked(earlierSignIn, { failClosed: true }), false)
  assert.equal(await revocation.revokeOtherUserSessions(6), true)
  assert.equal(await revocation.isSessionTokenRevoked(earlierSignIn, { failClosed: true }), true)

  const laterSignIn = await atOffset(120, async () => session.signSession({ id: 6, email: 'signup@example.com' }))
  assert.equal(await revocation.isSessionTokenRevoked(laterSignIn, { failClosed: true }), false)
})

test('another account keeps its sign-in when one account confirms', async () => {
  const redis = memoryRedis()
  const session = load('src/lib/auth/session.ts')
  const revocation = load('src/lib/auth/sessionRevocation.ts', {
    '@/lib/redis': { getRedis: async () => redis },
  })

  const otherAccount = await atOffset(-600, async () => session.signSession({ id: 7, email: 'teammate@example.com' }))
  assert.equal(await revocation.revokeOtherUserSessions(6), true)

  assert.equal(await revocation.isSessionTokenRevoked(otherAccount, { failClosed: true }), false)
})

test('ending the earlier sessions reports failure when the store refuses', async () => {
  const revocation = load('src/lib/auth/sessionRevocation.ts', {
    '@/lib/redis': {
      getRedis: async () => ({
        async set() {
          throw new Error('redis unavailable')
        },
        async get() {
          throw new Error('redis unavailable')
        },
        async mget() {
          throw new Error('redis unavailable')
        },
      }),
    },
  })

  assert.equal(await revocation.revokeOtherUserSessions(6), false)
})
