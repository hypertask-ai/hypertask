const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9389-no-evidence-other'
const internalAgent = { id: 6, email: 'runner@hypertask.ai', displayName: 'Runner 3' }
const otherToolOnly = { surface: 'cli', tool: 'tasks-create-project-15', client: 'hypertask-cli', category: 'other', kind: 'friction', note: 'https://app.hypertask.ai/detail/project-15/9389' }

function setup({ enabled = true } = {}) {
  const created = [], comments = [], rows = [], flagReads = []
  const on = async (key) => {
    flagReads.push(key)
    return key !== flag || enabled
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => internalAgent },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.section !== 'Done' && row.description.includes(where.description_.is.content.contains)) ?? null },
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
    '@/lib/flags': { isFeatureEnabled: on, featureFlagCandidateUserIds: async key => await on(key) ? null : [] },
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
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, flagReads, setEnabled: (value) => { enabled = value } }
}

test('flag definition is a bugfix, live for Everyone at once', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'small')
})

test('a hand-filed other report with only a tool and a dropped note opens no ticket', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(otherToolOnly, 6)
  assert.equal(result.success, false)
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'no_evidence')
  assert.match(result.error, /status and error code/)
  assert.equal(f.created.length, 0)
})

test('the default category alone is enough for the refusal', async () => {
  const f = setup()
  const { category, ...noCategory } = otherToolOnly
  const result = await f.fileAiFeedback(noCategory, 6)
  assert.equal(result.reason, 'no_evidence')
  assert.equal(f.created.length, 0)
})

test('flag off keeps filing the other category report', async () => {
  const f = setup({ enabled: false })
  const result = await f.fileAiFeedback(otherToolOnly, 6)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('a kept note is evidence, so the other report still files', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...otherToolOnly, note: 'Label list ignores json so jq fails' }, 6)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /label list ignores json so jq fails/i)
})

test('still filed: another category with only a tool', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...otherToolOnly, category: 'slow' }, 6)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: an automatic report in the other category', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(otherToolOnly, 6, { origin: 'automatic' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still counted: an open ticket for the same report is tallied, not refused', async () => {
  const f = setup({ enabled: false })
  await f.fileAiFeedback(otherToolOnly, 6)
  f.setEnabled(true)
  const again = await f.fileAiFeedback(otherToolOnly, 6)
  assert.equal(again.success, true)
  assert.equal(again.deduped, true)
  assert.equal(f.created.length, 1)
})
