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
const { createTaskCardActionHandler } = jiti(
  path.join(root, 'src/lib/mcp/tasks/cardActionHandler.ts'),
)
function request(body) {
  return new NextRequest('https://example.test/api/mcp/tasks/card-actions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function handler(overrides = {}) {
  const calls = { task: [], star: [], inbox: [] }
  const ctx = { user: { id: 6, email: 'owner@example.test' }, agentId: null }
  const POST = createTaskCardActionHandler({
    checkRateLimit: async () => null,
    validateAuth: async () => ctx,
    findTask: async (_ctx, taskId) => {
      calls.task.push(taskId)
      return { id: taskId, projectId: 15 }
    },
    setStarred: async (...args) => {
      calls.star.push(args)
      return { active: args[3], saved_content: args[3] ? [{ id: 'saved-1', type: 'Private' }] : [] }
    },
    setInbox: async (...args) => {
      calls.inbox.push(args)
      return { active: args[3] }
    },
    ...overrides,
  })
  return { POST, calls, ctx }
}

test('requires authentication before resolving a task', async () => {
  const { POST, calls } = handler({ validateAuth: async () => null })
  const response = await POST(request({ task_id: 42, project_id: 15, action: 'star', active: true }))
  assert.equal(response.status, 401)
  assert.deepEqual(calls.task, [])
})

test('rejects invalid action shapes before task access', async () => {
  const { POST, calls } = handler()
  for (const body of [null, [], {}, { task_id: 42, project_id: 15, action: 'pin', active: true }]) {
    assert.equal((await POST(request(body))).status, 400)
  }
  assert.deepEqual(calls.task, [])
})

test('rejects an inaccessible or mismatched project task', async () => {
  const { POST, calls } = handler({
    findTask: async (_ctx, taskId) => {
      calls.task.push(taskId)
      return { id: taskId, projectId: 99 }
    },
  })
  const response = await POST(request({ task_id: 42, project_id: 15, action: 'star', active: true }))
  assert.equal(response.status, 404)
  assert.deepEqual(calls.star, [])
})

test('sets explicit star state idempotently and returns reconciliation state', async () => {
  const { POST, calls } = handler()
  const response = await POST(request({ task_id: 42, project_id: 15, action: 'star', active: true }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), {
    success: true,
    action: 'star',
    active: true,
    saved_content: [{ id: 'saved-1', type: 'Private' }],
  })
  assert.deepEqual(calls.star, [[6, 42, 15, true]])
  assert.deepEqual(calls.inbox, [])
})

test('sets explicit Inbox state for the authenticated identity', async () => {
  const { POST, calls, ctx } = handler()
  const response = await POST(request({ task_id: 42, project_id: 15, action: 'inbox', active: false }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, action: 'inbox', active: false })
  assert.deepEqual(calls.inbox, [[ctx, 42, 15, false]])
  assert.deepEqual(calls.star, [])
})

test('managed agents cannot read or mutate human private stars', async () => {
  const { POST, calls } = handler({
    validateAuth: async () => ({
      user: { id: 6, email: 'owner@example.test' },
      agentId: 'managed-agent',
    }),
  })
  const response = await POST(request({ task_id: 42, project_id: 15, action: 'star', active: true }))
  assert.equal(response.status, 403)
  assert.deepEqual(calls.task, [])
  assert.deepEqual(calls.star, [])
})
