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

function loadUnlink() {
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
      assertAgentAssignmentChangeAllowed: async () => {},
      cancelAgentMutationLeaseForHumanOverride: async () => {},
    },
  }).unlinkTaskPullRequests
}

function fakeDb({ authorized = true, removed = 2 } = {}) {
  const calls = { deletes: [], updates: [], access: [] }
  const db = {
    calls,
    task: {
      findFirst: async (args) => {
        calls.access.push(args)
        return authorized ? { id: 42 } : null
      },
      update: async (args) => {
        calls.updates.push(args)
        return { id: 42 }
      },
    },
    taskPullRequest: {
      deleteMany: async (args) => {
        calls.deletes.push(args)
        return { count: removed }
      },
    },
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
  const unlinkTaskPullRequests = loadUnlink()
  assert.deepEqual(
    await unlinkTaskPullRequests({ taskId: 42, userId: 6, agentId: null, db }),
    { removed: 2 },
  )
  assert.equal(db.calls.access.length, 1)
  assert.equal(db.calls.access[0].where.id, 42)
  assert.deepEqual(db.calls.deletes, [{ where: { taskId: 42 } }])
  assert.equal(db.calls.updates.length, 1)
  assert.equal(db.calls.updates[0].where.id, 42)
})

test('unlinking keeps the links when the caller cannot write to the task', async () => {
  const db = fakeDb({ authorized: false })
  const unlinkTaskPullRequests = loadUnlink()
  await assert.rejects(
    () => unlinkTaskPullRequests({ taskId: 42, userId: 9, agentId: null, db }),
    (error) => error.status === 404 && error.code === 'task_not_found',
  )
  assert.equal(db.calls.access.length, 1)
  assert.deepEqual(db.calls.deletes, [])
  assert.deepEqual(db.calls.updates, [])
})

test('unlinking a task that has no pull request link leaves the task unchanged', async () => {
  const db = fakeDb({ removed: 0 })
  const unlinkTaskPullRequests = loadUnlink()
  assert.deepEqual(
    await unlinkTaskPullRequests({ taskId: 42, userId: 6, agentId: null, db }),
    { removed: 0 },
  )
  assert.deepEqual(db.calls.deletes, [{ where: { taskId: 42 } }])
  assert.deepEqual(db.calls.updates, [])
})
