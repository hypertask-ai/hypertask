const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9366-automatic-auth-refusal'
const refused = { surface: 'mcp', tool: 'mcp', status: 401, errorCode: 'unauthorized', category: 'auth_failed' }
const previousAgentUser = process.env.AI_FEEDBACK_AGENT_USER_ID
process.env.AI_FEEDBACK_AGENT_USER_ID = '42'
test.after(() => {
  if (previousAgentUser === undefined) delete process.env.AI_FEEDBACK_AGENT_USER_ID
  else process.env.AI_FEEDBACK_AGENT_USER_ID = previousAgentUser
})

function setup({ off = [] } = {}) {
  const created = [], comments = [], rows = [], lookups = []
  const disabled = new Set(off)
  const on = async (key, userId) => {
    lookups.push({ flag: key, userId })
    return !disabled.has(key)
  }
  const db = {
    description: {
      update: async ({ where, data }) => {
        const row = rows.find((row) => row.id === where.taskId)
        if (!row) throw new Error('missing description')
        row.description = data.content
        return { taskId: where.taskId, content: data.content }
      },
    },
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ displayName: 'Robin' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => {
      const marker = where.description_?.is?.content?.contains
      if (!marker) return null
      return rows.find(row => row.description.includes(marker)) ?? null
    } },
    comment: {
      findFirst: async ({ where }) => {
        if (!where.task) return comments.find(comment => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null
        const comment = comments.find(comment => comment.text.includes(where.text.contains))
        const task = comment && rows.find(row => row.id === comment.taskId)
        return task ? { task } : null
      },
      update: async ({ where, data }) => Object.assign(comments.find(comment => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async (run) => run(db),
  }
  const load = loader({
    '@/lib/prisma': { __esModule: true, default: db },
    './enabled': { aiFeedbackEnabled: async () => true },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': { isFeatureEnabled: on, featureFlagCandidateUserIds: async (key) => await on(key) ? null : [] },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async (options) => {
      const task = { ...options, id: created.length + 1, ticketNumber: `HTPR-${8900 + created.length}`, uniqueIndex: 8900 + created.length }
      created.push(task)
      rows.push(task)
      return { task }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (options) => {
      const comment = { ...options, id: comments.length + 1 }
      comments.push(comment)
      return comment
    } },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
  })
  return {
    ...load('src/lib/aiFeedback/report.ts'),
    load, created, comments, lookups,
    enable(key) { disabled.delete(key) },
  }
}

test('flag is a bug fix on for everyone', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('a self-reported sign-in refusal reads as a key problem, not as a Hypertask bug', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  assert.equal(result.success, true)
  const description = f.created[0].description
  assert.equal(f.created.length, 1)
  assert.match(description, /An agent was refused when it signed in through MCP/)
  assert.match(description, /wrong or expired key, not a Hypertask bug/)
  assert.match(description, /check its key and board permissions/)
  assert.doesNotMatch(description, /An engineer should look|does not show whether this is a Hypertask bug/)
})

test('the error code stays in the agent log while the ticket is filed once', async () => {
  const f = setup()
  await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  const second = await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
  assert.equal(second.count, 2)
  assert.match(f.comments[0].text, /Error code: unauthorized/)
  assert.match(f.comments[0].text, /Seen 2 times/)
  assert.doesNotMatch(f.created[0].description, /Error code: unauthorized/)
})

test('flag off keeps the old wording and still files the ticket', async () => {
  const f = setup({ off: [flag] })
  await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /An engineer should look/)
  assert.doesNotMatch(f.created[0].description, /wrong or expired key/)
})

test('a self-reported server error still reads as a likely Hypertask bug', async () => {
  const f = setup()
  await f.fileAiFeedback({ surface: 'api', status: 500, category: 'call_failed' }, undefined, { origin: 'automatic' })
  assert.match(f.created[0].description, /failed on the server/)
  assert.match(f.created[0].description, /likely a Hypertask bug/)
  assert.doesNotMatch(f.created[0].description, /wrong or expired key/)
})

test('an agent report keeps the refusal reading with the flag off', async () => {
  const f = setup({ off: [flag] })
  const text = f.plainFeedback(refused, 'fingerprint', { origin: 'agent' }, undefined, 'plain', false)
  assert.match(text.description, /wrong or expired key, not a Hypertask bug/)
  assert.doesNotMatch(text.description, /An engineer should look/)
  const result = await f.fileAiFeedback(refused, 42, { origin: 'agent' })
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'access_refused')
  assert.equal(f.created.length, 0)
})

test('a repeat report rewrites an open refusal that still says an engineer should look', async () => {
  const f = setup({ off: [flag] })
  await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  assert.match(f.created[0].description, /An engineer should look/)
  f.enable(flag)
  const second = await f.fileAiFeedback(refused, undefined, { origin: 'automatic' })
  assert.equal(second.deduped, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /wrong or expired key, not a Hypertask bug/)
  assert.match(f.created[0].description, /check its key and board permissions/)
  assert.doesNotMatch(f.created[0].description, /An engineer should look/)
})
