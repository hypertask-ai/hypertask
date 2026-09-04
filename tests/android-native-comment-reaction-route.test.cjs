const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { createCommentReactionHandler } = jiti(
  path.join(root, 'src/lib/mcp/comments/reactionHandler.ts')
)

function request(body = { emoji: '👍', active: true }) {
  return new NextRequest('https://example.test/api/mcp/comments/7/reactions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function handler(overrides = {}) {
  const calls = { target: [], mutation: [], after: [] }
  const context = { user: { id: 6 }, agentId: null }
  const target = {
    commentId: 7,
    taskId: 42,
    projectId: 15,
    creatorId: 9,
    text: 'Comment',
    taskUniqueIndex: 123,
  }
  const dependencies = {
    checkRateLimit: async () => null,
    validateAuth: async () => context,
    authorizeWrite: async () => null,
    featureEnabled: async () => true,
    actorUserId: () => 6,
    findTarget: async (_context, commentId) => { calls.target.push(commentId); return target },
    setReaction: async (...args) => {
      calls.mutation.push(args)
      return {
        changed: true,
        reaction: { id: 'reaction-1', emoji: args[2], userId: args[1] },
        reactions: [{ id: 'reaction-1', emoji: args[2], userId: args[1] }],
      }
    },
    afterChange: async (...args) => { calls.after.push(args) },
    ...overrides,
  }
  return {
    POST: createCommentReactionHandler(dependencies),
    calls,
    props: { params: Promise.resolve({ comment_id: '7' }) },
  }
}

test('rejects unauthenticated reaction writes before resolving the comment', async () => {
  const { POST, props, calls } = handler({ validateAuth: async () => null })
  const response = await POST(request(), props)
  assert.equal(response.status, 401)
  assert.deepEqual(calls.target, [])
})

test('enforces managed-agent write scope before resolving the comment', async () => {
  const denied = Response.json({ error: 'Insufficient role' }, { status: 403 })
  const { POST, props, calls } = handler({ authorizeWrite: async () => denied })
  const response = await POST(request(), props)
  assert.equal(response.status, 403)
  assert.deepEqual(calls.target, [])
})

test('conceals the endpoint while the feature is disabled before parsing input', async () => {
  const { POST, props, calls } = handler({ featureEnabled: async () => false })
  const response = await POST(request({ emoji: '👍', active: 'yes' }), props)
  assert.equal(response.status, 404)
  assert.deepEqual(calls.target, [])
  assert.deepEqual(calls.mutation, [])
})

test('fails closed when the feature flag cannot be read', async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const { POST, props, calls } = handler({
      featureEnabled: async () => { throw new Error('flag unavailable') },
    })
    assert.equal((await POST(request(), props)).status, 404)
    assert.deepEqual(calls.target, [])
    assert.deepEqual(calls.mutation, [])
  } finally {
    console.error = originalError
  }
})

test('rejects malformed reaction state without mutating', async () => {
  const { POST, props, calls } = handler()
  assert.equal((await POST(request({ emoji: '👍', active: 'yes' }), props)).status, 400)
  assert.deepEqual(calls.mutation, [])
})

test('does not expose inaccessible comments', async () => {
  const { POST, props, calls } = handler({ findTarget: async () => null })
  const response = await POST(request(), props)
  assert.equal(response.status, 404)
  assert.deepEqual(calls.mutation, [])
})

test('applies deterministic active state and returns the canonical reaction list', async () => {
  const { POST, props, calls } = handler()
  const response = await POST(request(), props)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.active, true)
  assert.deepEqual(body.reactions, [{ id: 'reaction-1', emoji: '👍', userId: 6 }])
  assert.deepEqual(calls.target, [7])
  assert.equal(calls.mutation[0][1], 6)
  assert.equal(calls.mutation[0][2], '👍')
  assert.equal(calls.mutation[0][3], true)
  assert.equal(calls.after.length, 1)
})

test('removes a reaction by setting its active state to false', async () => {
  const { POST, props, calls } = handler()
  const response = await POST(request({ emoji: '✅', active: false }), props)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.active, false)
  assert.equal(calls.mutation[0][2], '✅')
  assert.equal(calls.mutation[0][3], false)
})

test('returns the committed reaction when post-commit notification work fails', async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const { POST, props, calls } = handler({
      afterChange: async (...args) => {
        calls.after.push(args)
        throw new Error('notification unavailable')
      },
    })
    const response = await POST(request(), props)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.active, true)
    assert.equal(calls.mutation.length, 1)
    assert.equal(calls.after.length, 1)
  } finally {
    console.error = originalError
  }
})
