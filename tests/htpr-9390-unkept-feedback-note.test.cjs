const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const flag = 'htpr-9390-unkept-feedback-note'
const internalAgent = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const customerAgent = { id: 99, email: 'owner@example.com', displayName: 'Robin' }
const ticketReport = {
  surface: 'cli',
  client: 'hypertask-cli',
  tool: 'hypertask-task-list-/-task-get',
  category: 'other',
  kind: 'missing',
  note: 'task list and task get miss the savedContent field',
}

function setup({ enabled = true, user = internalAgent } = {}) {
  const created = [], comments = [], rows = []
  const on = async (key) => key !== flag || enabled
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => user },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.description.includes(where.description_.is.content.contains)) ?? null },
    comment: {
      findFirst: async ({ where }) => {
        if (where.task) {
          const comment = comments.find(item => item.text.includes(where.text.contains))
          const task = comment && rows.find(row => row.id === comment.taskId)
          return task ? { task: { id: task.id, userId: task.userId, ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, createdAt: task.createdAt } } : null
        }
        return comments.find(item => item.taskId === where.taskId && item.text.includes(where.text.contains)) ?? null
      },
      update: async ({ where, data }) => Object.assign(comments.find(item => item.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async run => run(db),
  }
  const exports = loadModule('src/lib/aiFeedback/report.ts', {
    '@/lib/prisma': { __esModule: true, default: db },
    '@/lib/flags': {
      isFeatureEnabled: on,
      featureFlagCandidateUserIds: async key => await on(key) ? null : [],
      FEATURE_FLAG_OWNER_USER_ID: 6,
      FEATURE_FLAG_QA_USER_ID: 985,
    },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async options => {
      created.push(options)
      const task = { ...options, id: created.length, ticketNumber: `HTPR-${8000 + created.length}`, uniqueIndex: 8000 + created.length }
      rows.push(task)
      return { task }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async options => {
      const comment = { ...options, id: comments.length + 1 }
      comments.push(comment)
      return comment
    } },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
  })
  return { ...exports, created, rows }
}

test('flag definition is a bugfix, live for everyone', () => {
  const { default: definition } = loadModule(`src/lib/flags/definitions/${flag}.ts`)
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'small')
})

test('a report whose only words were dropped opens no ticket and asks for plain words', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(ticketReport, 6, { origin: 'agent', agentName: 'SF Ratstack Page' })
  assert.equal(result.success, false)
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'no_evidence')
  assert.match(result.error, /report again in plain words/i)
  assert.equal(f.created.length, 0)
})

test('the same report with a note that can be kept still opens a ticket and shows the note', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...ticketReport, note: 'task list and task get miss saved content' }, 6, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /<p>Note: task list and task get miss saved content<\/p>/)
})

test('the same report with a status still opens a ticket', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...ticketReport, status: 500 }, 6, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('the same report with an error code still opens a ticket', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...ticketReport, errorCode: 'empty-tools-list' }, 6, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('flag off keeps today behaviour and files the empty ticket', async () => {
  const f = setup({ enabled: false })
  const result = await f.fileAiFeedback(ticketReport, 6, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /Free text was supplied and not stored, for privacy\./)
})

test('a customer agent report is not refused by this rule', async () => {
  const f = setup({ user: customerAgent })
  const result = await f.fileAiFeedback({ ...ticketReport, kind: undefined }, 99, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('an automatic report is not refused by this rule', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...ticketReport, note: undefined }, 6, { origin: 'automatic' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})
