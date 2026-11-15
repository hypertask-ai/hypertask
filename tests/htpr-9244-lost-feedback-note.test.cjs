const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9244-lost-feedback-note'
const lostReport = {
  surface: 'cli',
  tool: 'task-update-pull-request',
  client: 'hypertask-cli',
  category: 'other',
  kind: 'bug',
  note: 'task_update_pull_request failed',
}

function setup({ enabled = true, flagError = false } = {}) {
  const created = [], comments = [], rows = [], state = { enabled }
  const flagEnabled = async (key) => {
    if (flagError) throw new Error('Flag unavailable')
    return key !== flag || state.enabled
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ id: 42, email: 'runner@agents.hypertask.ai', displayName: 'Robin' }) },
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
    '@/lib/flags': { isFeatureEnabled: flagEnabled, featureFlagCandidateUserIds: async key => await flagEnabled(key) ? null : [] },
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

test('a report whose only note cannot be kept opens no ticket and asks for the status', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(lostReport, 42)
  assert.equal(result.success, false)
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'no_evidence')
  assert.match(result.error, /status and error code/)
  assert.equal(f.created.length, 0)
})

test('still filed: a kind report with a note that is kept', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...lostReport, note: 'New repository pull request cannot link to its ticket' }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /New repository pull request cannot link to its ticket/)
})

test('still filed: a kind report with an HTTP status', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...lostReport, note: undefined, status: 500 }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: a kind report with an error code', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...lostReport, note: undefined, errorCode: 'pr_not_found' }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: a report with no kind keeps today behaviour', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...lostReport, kind: undefined }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still counted: a lost-note report that already has an open ticket is tallied', async () => {
  const f = setup({ enabled: false })
  await f.fileAiFeedback(lostReport, 42)
  f.state.enabled = true
  const again = await f.fileAiFeedback(lostReport, 43)
  assert.equal(again.success, true)
  assert.equal(again.deduped, true)
  assert.equal(f.created.length, 1)
})

test('flag off keeps filing the lost-note report', async () => {
  const f = setup({ enabled: false })
  const result = await f.fileAiFeedback(lostReport, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('flag lookup failure keeps filing the lost-note report', async () => {
  const f = setup({ flagError: true })
  const result = await f.fileAiFeedback(lostReport, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})
