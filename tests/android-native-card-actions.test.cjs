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
const taskRouteSource = require('node:fs').readFileSync(
  path.join(root, 'src/app/api/mcp/tasks/route.ts'),
  'utf8',
)
const taskContextRouteSource = require('node:fs').readFileSync(
  path.join(root, 'src/app/api/mcp/tasks/context/route.ts'),
  'utf8',
)
const handlerSource = require('node:fs').readFileSync(
  path.join(root, 'src/lib/mcp/tasks/cardActionHandler.ts'),
  'utf8',
)
const lockSource = require('node:fs').readFileSync(
  path.join(root, 'src/lib/taskCardActions/writeLocks.ts'),
  'utf8',
)
const inboxStateSource = require('node:fs').readFileSync(
  path.join(root, 'src/lib/taskCardActions/inboxState.ts'),
  'utf8',
)
const webInboxSource = require('node:fs').readFileSync(
  path.join(root, 'src/pages/api/notifications/moveTaskToInbox.ts'),
  'utf8',
)
const webStarSource = require('node:fs').readFileSync(
  path.join(root, 'src/pages/api/savedContent/toggleSaved.ts'),
  'utf8',
)
const reminderSource = require('node:fs').readFileSync(
  path.join(root, 'src/utils/controllers/reminders/invokeReminder.ts'),
  'utf8',
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
  assert.match(taskRouteSource, /userId: ctx\.agentId \? -1 : user\.id/)
  assert.match(taskContextRouteSource, /userId: ctx\.agentId \? -1 : ctx\.user\.id/)
})

test('board task snapshots include only human caller task stars', () => {
  assert.match(
    taskRouteSource,
    /savedContent:\s*\{\s*where:\s*\{ userId: ctx\.agentId \? -1 : user\.id, commentId: null, type: 'Private' \}/,
  )
  assert.match(taskRouteSource, /savedContent: task\.savedContent/)
  assert.match(taskContextRouteSource, /savedContent: mappedTask\.savedContent/)
})

test('native and web mutations share locks and isolate manual Inbox items', () => {
  assert.equal((lockSource.match(/pg_advisory_xact_lock/g) ?? []).length, 1)
  assert.match(handlerSource, /withTaskStarWriteLock/)
  assert.match(handlerSource, /FOR UPDATE/)
  assert.match(handlerSource, /setTaskMovedToInboxState/)
  assert.match(inboxStateSource, /FOR UPDATE/)
  assert.match(inboxStateSource, /Task changed boards before Inbox reconciliation/)
  assert.match(inboxStateSource, /type: 'TaskMovedToInbox'/)
  assert.match(inboxStateSource, /checkReminderAndCreateNotification/)
  assert.match(inboxStateSource, /tx\.reminder\.updateMany/)
  assert.match(reminderSource, /TASK_INBOX_REMINDER_LOCK_CLASS/)
  assert.match(webInboxSource, /ensureTaskMovedToInbox/)
  assert.match(webStarSource, /withTaskStarWriteLock/)
})
