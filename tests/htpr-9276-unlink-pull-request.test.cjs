const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadModule } = require('./helpers/loadModule.cjs')

const FLAG_KEY = 'htpr-9276-unlink-pull-request'
const canonicalUrl = 'https://github.com/hypertask-ai/hypertask/pull/110'
const definition = loadModule('src/lib/flags/definitions/htpr-9276-unlink-pull-request.ts')

class NextResponse {
  constructor(body, init = {}) {
    this.body = body
    this.status = init.status
  }

  static json(body, init = {}) {
    return new NextResponse(body, init)
  }
}

function loadValidation(flagEnabled, flagReads = []) {
  return loadModule('src/lib/mcp/tasks/fields/validateFields.ts', {
    'next/server': { NextResponse },
    '@/lib/flags': {
      isFeatureEnabled: async (key, userId) => {
        flagReads.push([key, userId])
        return flagEnabled
      },
    },
    [`@/lib/flags/definitions/${FLAG_KEY}`]: definition,
    '@/lib/mcp/tasks/validators': {
      CONTENT_TYPE_ALLOWED_VALUES: ['html', 'markdown'],
      parseAssigneeIds: () => ({ ok: true, ids: [] }),
    },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (input) => input },
    '@/utils/helperFunctions/markdownToHtml': { formatRichTextInput: (input) => input },
  }).validateTaskUpdateFields
}

function loadPullRequestField() {
  return loadModule('src/lib/mcp/tasks/fields/pullRequest.ts')
}

const linkedPullRequests = [
  {
    repositoryOwner: 'hypertask-ai',
    repositoryName: 'hypertask',
    number: 110,
    url: 'https://github.com/hypertask-ai/hypertask/pull/110',
    title: 'Mistaken link',
    lifecycle: 'open',
    checkState: 'pending',
  },
  {
    repositoryOwner: 'hypertask-ai',
    repositoryName: 'cli',
    number: 7,
    url: 'https://github.com/hypertask-ai/cli/pull/7',
    title: 'Other link',
    lifecycle: 'open',
    checkState: 'passing',
  },
]

function loadUnlink(fence = {}) {
  return loadModule('src/lib/pullRequests/taskPullRequests.ts', {
    '@prisma/client': {
      Prisma: {
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    '@/lib/prisma': { default: {} },
    '@/lib/agents/publicAgent': { sanitizeAgentCredentials: (value) => value },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: () => ({}) },
    '@/lib/mcp/tasks/agentMutationFence': {
      assertAgentAssignmentChangeAllowed: async (...args) => {
        fence.asserts?.push(args)
        if (fence.assertError) throw fence.assertError
      },
      cancelAgentMutationLeaseForHumanOverride: async (...args) => {
        fence.cancels?.push(args)
      },
    },
  }).unlinkTaskPullRequests
}

function fakeDb({
  authorized = true,
  links = linkedPullRequests,
  updatedByUserIds = [],
  user = { id: 6, displayName: 'Valentin Yeo', photoURL: null, email: 'owner@example.test' },
  agent = null,
} = {}) {
  const calls = { deletes: [], updates: [], access: [], activities: [] }
  const db = {
    calls,
    task: {
      findFirst: async (args) => {
        calls.access.push(args)
        return authorized ? { id: 42, updatedByUserIds } : null
      },
      update: async (args) => {
        calls.updates.push(args)
        return { id: 42 }
      },
    },
    user: { findUnique: async () => user },
    agent: { findFirst: async () => agent },
    taskPullRequest: {
      findMany: async () => links,
      deleteMany: async (args) => {
        calls.deletes.push(args)
        return { count: links.length }
      },
    },
    comment: {
      create: async (args) => {
        calls.activities.push(args)
        return args
      },
    },
    $queryRaw: async () => [],
    $transaction: async (run) => run(db),
  }
  return db
}

test('the ticket flag is a bugfix released to everyone', () => {
  assert.equal(definition.HTPR_9276_UNLINK_PULL_REQUEST_FLAG, FLAG_KEY)
  assert.equal(definition.default.key, FLAG_KEY)
  assert.equal(definition.default.kind, 'bugfix')
  assert.equal(definition.default.defaultMode, 'EVERYONE')
  assert.ok(definition.default.description.length > 0)
  assert.ok(definition.default.releaseRisk.reason.length > 0)
})

test('a task update with no pull request URL clears the attachment when the flag is on', async () => {
  const flagReads = []
  const validate = loadValidation(true, flagReads)
  const fields = await validate({ task_id: 1, pull_request_url: null }, false, 6)
  assert.equal(fields.clearPullRequest, true)
  assert.equal(fields.parsedPullRequest, null)
  assert.deepEqual(flagReads, [[FLAG_KEY, 6]])
})

test('a blank pull request URL clears the attachment too', async () => {
  const validate = loadValidation(true)
  const fields = await validate({ task_id: 1, pull_request_url: '   ' }, false, 6)
  assert.equal(fields.clearPullRequest, true)
  assert.equal(fields.parsedPullRequest, null)
})

test('the flag off keeps refusing a task update with no pull request URL', async () => {
  const validate = loadValidation(false)
  const response = await validate({ task_id: 1, pull_request_url: null }, false, 6)
  assert.equal(response.status, 400)
  assert.equal(response.body.field, 'pull_request_url')
})

test('a real pull request URL still links and reads no flag', async () => {
  const flagReads = []
  const validate = loadValidation(true, flagReads)
  const fields = await validate(
    { task_id: 1, pull_request_url: 'https://github.com/Hypertask-AI/Hypertask/pull/110/' },
    false,
    6,
  )
  assert.equal(fields.parsedPullRequest.url, canonicalUrl)
  assert.equal(fields.clearPullRequest, false)
  assert.deepEqual(flagReads, [])
})

test('the update unlinks instead of linking when the attachment is cleared', async () => {
  const calls = []
  const { updateTaskPullRequest } = loadPullRequestField()
  await updateTaskPullRequest(
    {
      parsedPullRequest: null,
      clearPullRequest: true,
      linkPullRequest: async (input) => calls.push(['link', input]),
      unlinkPullRequest: async (input) => calls.push(['unlink', input]),
      user: { id: 6 },
      ctx: { agentId: null, teamScope: null },
    },
    { id: 42 },
  )
  assert.deepEqual(calls, [
    ['unlink', { taskId: 42, userId: 6, agentId: null, teamScope: null }],
  ])
})

test('the update still links when a pull request URL is parsed', async () => {
  const calls = []
  const { updateTaskPullRequest } = loadPullRequestField()
  await updateTaskPullRequest(
    {
      parsedPullRequest: { url: canonicalUrl },
      clearPullRequest: false,
      linkPullRequest: async (input) => calls.push(['link', input]),
      unlinkPullRequest: async (input) => calls.push(['unlink', input]),
      user: { id: 6 },
      ctx: { agentId: null, teamScope: null },
    },
    { id: 42 },
  )
  assert.deepEqual(calls, [
    ['link', { taskId: 42, userId: 6, agentId: null, teamScope: null, url: canonicalUrl }],
  ])
})

test('unlinking removes every pull request link on a task the caller can write to', async () => {
  const db = fakeDb()
  const fence = { asserts: [], cancels: [] }
  const unlinkTaskPullRequests = loadUnlink(fence)
  assert.deepEqual(
    await unlinkTaskPullRequests({ taskId: 42, userId: 6, agentId: null, db }),
    { removed: 2 },
  )
  assert.equal(db.calls.access.length, 1)
  assert.equal(db.calls.access[0].where.id, 42)
  assert.deepEqual(db.calls.deletes, [{ where: { taskId: 42 } }])
  assert.deepEqual(
    db.calls.activities.map((entry) => entry.data.activity.data.action),
    ['unlinked', 'unlinked'],
  )
  assert.deepEqual(
    db.calls.activities.map((entry) => entry.data.activity.data.pullRequest.repository),
    ['hypertask-ai/hypertask', 'hypertask-ai/cli'],
  )
  assert.equal(db.calls.updates.length, 1)
  assert.equal(db.calls.updates[0].where.id, 42)
  assert.deepEqual(db.calls.updates[0].data.updatedByUserIds, { push: 6 })
  assert.equal(fence.asserts.length, 1)
  assert.equal(fence.asserts[0][4].allowHumanOverride, true)
  assert.deepEqual(fence.cancels, [[db, 42, 6]])
})

test('unlinking records a caller who already edited the task without adding them twice', async () => {
  const db = fakeDb({ updatedByUserIds: [6] })
  await loadUnlink()({ taskId: 42, userId: 6, agentId: null, db })
  assert.equal(db.calls.updates[0].data.updatedByUserIds, undefined)
  assert.ok(db.calls.updates[0].data.updatedAt instanceof Date)
})

test('an agent unlink keeps the active lease and still removes the links', async () => {
  const db = fakeDb({ agent: { id: 'agent-6', userId: 6, displayName: 'Runner 6', photoURL: null } })
  const fence = { asserts: [], cancels: [] }
  const removed = await loadUnlink(fence)({ taskId: 42, userId: 6, agentId: 'agent-6', db })
  assert.deepEqual(removed, { removed: 2 })
  assert.equal(fence.asserts[0][4].allowHumanOverride, false)
  assert.deepEqual(fence.cancels, [])
})

test('an active agent lease blocks the unlink before any link is removed', async () => {
  const db = fakeDb()
  const fence = { asserts: [], cancels: [], assertError: Object.assign(new Error('lease'), { status: 409 }) }
  await assert.rejects(
    () => loadUnlink(fence)({ taskId: 42, userId: 6, agentId: null, db }),
    (error) => error.status === 409,
  )
  assert.deepEqual(db.calls.deletes, [])
  assert.deepEqual(db.calls.activities, [])
  assert.deepEqual(db.calls.updates, [])
  assert.deepEqual(fence.cancels, [])
})

test('unlinking keeps the links when the caller cannot write to the task', async () => {
  const db = fakeDb({ authorized: false })
  const fence = { asserts: [], cancels: [] }
  const unlinkTaskPullRequests = loadUnlink(fence)
  await assert.rejects(
    () => unlinkTaskPullRequests({ taskId: 42, userId: 9, agentId: null, db }),
    (error) => error.status === 404 && error.code === 'task_not_found',
  )
  assert.equal(db.calls.access.length, 1)
  assert.deepEqual(db.calls.deletes, [])
  assert.deepEqual(db.calls.activities, [])
  assert.deepEqual(db.calls.updates, [])
  assert.deepEqual(fence.asserts, [])
  assert.deepEqual(fence.cancels, [])
})

test('unlinking a task that has no pull request link leaves the task unchanged', async () => {
  const db = fakeDb({ links: [] })
  const fence = { asserts: [], cancels: [] }
  const unlinkTaskPullRequests = loadUnlink(fence)
  assert.deepEqual(
    await unlinkTaskPullRequests({ taskId: 42, userId: 6, agentId: null, db }),
    { removed: 0 },
  )
  assert.equal(fence.asserts.length, 1)
  assert.deepEqual(fence.cancels, [])
  assert.deepEqual(db.calls.deletes, [])
  assert.deepEqual(db.calls.activities, [])
  assert.deepEqual(db.calls.updates, [])
})

function loadDelete(comment) {
  const calls = { deletes: [] }
  const db = {
    comment: {
      findUnique: async () => comment,
      deleteMany: async (args) => {
        calls.deletes.push(args)
        return { count: 1 }
      },
    },
    notification: { updateMany: async () => ({ count: 0 }) },
    attachment: { deleteMany: async () => ({ count: 0 }) },
    task: { update: async () => ({}) },
  }
  const { deleteCommentService } = loadModule('src/utils/controllers/comments/deleteCommentService.ts', {
    '@/lib/prisma': { default: db },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { deleteCommentInTurbopuffer: async () => {} },
  })
  return { deleteCommentService, calls }
}

test('a pull request removal activity cannot be deleted', async () => {
  const { deleteCommentService, calls } = loadDelete({
    id: 8,
    taskId: 42,
    creatorId: 6,
    activity: {
      type: 'TaskPullRequest',
      data: { action: 'unlinked', pullRequest: { number: 110, repository: 'hypertask-ai/hypertask' } },
    },
  })
  await assert.rejects(
    () => deleteCommentService({ commentId: 8, userId: 6 }),
    (error) => error.message === 'Comment cannot be deleted',
  )
  assert.deepEqual(calls.deletes, [])
})

test('a normal comment can still be deleted', async () => {
  const { deleteCommentService, calls } = loadDelete({
    id: 9,
    taskId: 42,
    creatorId: 6,
    activity: null,
  })
  assert.deepEqual(await deleteCommentService({ commentId: 9, userId: 6 }), { deleted: true })
  assert.deepEqual(calls.deletes, [{ where: { id: 9 } }])
})
