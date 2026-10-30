const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-8197-no-evidence-feedback'
const toolOnly = { surface: 'cli', tool: 'comment.add', client: 'hypertask-cli', category: 'call_failed' }

function setup({ enabled = true, flagError = false } = {}) {
  const created = [], comments = [], rows = [], state = { enabled }
  const flagEnabled = async (key) => {
    if (flagError) throw new Error('Flag unavailable')
    return key !== flag || state.enabled
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ displayName: 'Robin' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.description.includes(where.description_.is.content.contains)) ?? null },
    comment: {
      findFirst: async ({ where }) => comments.find(comment => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null,
      update: async ({ where, data }) => Object.assign(comments.find(comment => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async run => run(db),
  }
  const load = loader({
    '@vercel/functions': { waitUntil: work => work },
    '@/lib/prisma': { __esModule: true, default: db },
    './enabled': { aiFeedbackEnabled: async () => true },
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

test('a hand-filed report with only a tool and call_failed opens no ticket and asks for the status', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(toolOnly, 42)
  assert.equal(result.success, false)
  assert.equal(result.filed, false)
  assert.equal(result.reason, 'no_evidence')
  assert.match(result.error, /status and error code/)
  assert.equal(f.created.length, 0)
})

test('still filed: the same report with an HTTP status', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...toolOnly, status: 500 }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: the same report with an error code', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...toolOnly, errorCode: 'connection-reset' }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: another category with only a tool', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...toolOnly, category: 'slow' }, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still filed: an automatic report with only a tool', async () => {
  const f = setup()
  const result = await f.fileAiFeedback({ ...toolOnly, surface: 'mcp' }, 42, { origin: 'automatic' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('still counted: a tool-only report that already has an open ticket is tallied, not refused', async () => {
  const f = setup({ enabled: false })
  await f.fileAiFeedback(toolOnly, 42)
  f.state.enabled = true
  const again = await f.fileAiFeedback(toolOnly, 43)
  assert.equal(again.success, true)
  assert.equal(again.deduped, true)
  assert.equal(f.created.length, 1)
})

test('flag off keeps filing the tool-only report', async () => {
  const f = setup({ enabled: false })
  const result = await f.fileAiFeedback(toolOnly, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})

test('flag lookup failure keeps filing the tool-only report', async () => {
  const f = setup({ flagError: true })
  const result = await f.fileAiFeedback(toolOnly, 42)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
})
