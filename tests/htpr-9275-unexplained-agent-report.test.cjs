const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9275-unexplained-agent-report'
const internalAgent = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const unexplained = { surface: 'cli', tool: 'fleet/pick', kind: 'bug', category: 'other', note: 'fleet/pick fell over again' }

function setup({ enabled = true, flagError = false } = {}) {
  const created = [], comments = [], rows = [], state = { enabled }
  const on = async (key) => {
    if (flagError) throw new Error('Flag unavailable')
    return key !== flag || state.enabled
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => internalAgent },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.description.includes(where.description_.is.content.contains)) ?? null },
    comment: {
      findFirst: async ({ where }) => {
        if (where.task) {
          const comment = comments.find(comment => comment.text.includes(where.text.contains))
          const task = comment && rows.find(row => row.id === comment.taskId && row.section !== 'Done')
          return task ? { task: { id: task.id, userId: task.userId, ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, createdAt: task.createdAt } } : null
        }
        return comments.find(comment => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null
      },
      update: async ({ where, data }) => Object.assign(comments.find(comment => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async run => run(db),
  }
  const load = loader({
    '@vercel/functions': { waitUntil: work => work },
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
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, comments, state }
}

test('flag definition is a bugfix, live for Everyone at once', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('a report that says something had a problem files no ticket and asks for details', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(unexplained, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, false)
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'no_evidence')
  assert.match(result.error, /status and error code/)
  assert.equal(f.created.length, 0)
})

test('still filed: the same report with a kept note', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...unexplained, note: 'Label list ignores the json flag' }, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].title, /^Agent feedback, bug: Label list ignores the json flag$/)
})

test('still filed: the same report with an HTTP status', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...unexplained, status: 500 }, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: the same report with an error code', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...unexplained, errorCode: 'connection-reset' }, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: an automatic report that says something had a problem', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(unexplained, 6, { origin: 'automatic' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('flag off files the report as before', async () => {
  const f = setup({ enabled: false })
  const result = await f.fileAiFeedback(unexplained, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('flag lookup failure files the report as before', async () => {
  const f = setup({ flagError: true })
  const result = await f.fileAiFeedback(unexplained, 6, { origin: 'agent', agentName: 'Runner 6' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})
