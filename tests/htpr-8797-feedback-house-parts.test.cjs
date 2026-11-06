const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-8797-feedback-house-parts'
const report = { surface: 'mcp', tool: 'hypertask_tasks', status: 400, errorCode: 'invalid_field', field: 'description', category: 'call_failed' }

function setup({ enabled = true } = {}) {
  const created = [], comments = [], rows = []
  let houseOn = enabled
  const on = async (key) => key !== flag || houseOn
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ displayName: 'Robin' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => {
      const marker = where.description_?.is?.content?.contains
      if (!marker) return null
      return rows.find(row => row.section !== 'Done' && row.description.includes(marker)) ?? null
    } },
    comment: {
      findFirst: async ({ where }) => {
        if (!where.task) return comments.find(comment => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null
        const comment = comments.find(comment => comment.text.includes(where.text.contains))
        const task = comment && rows.find(row => row.id === comment.taskId && row.section !== 'Done')
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
      const task = { ...options, id: created.length + 1, ticketNumber: `HTPR-${8800 + created.length}`, uniqueIndex: 8800 + created.length }
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
    load, created, comments,
    setEnabled(value) { houseOn = value },
  }
}

test('flag is a bug fix on for everyone', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('a new feedback ticket has the house parts and no error code in the description', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  assert.equal(result.success, true)
  assert.equal(result.deduped, false)
  const description = f.created[0].description
  for (const heading of ['Problem', 'Fix', 'Done when', 'Risk', 'Decision']) {
    assert.match(description, new RegExp(`<h2>${heading}</h2>`))
  }
  assert.doesNotMatch(description, /Error code:|Fingerprint:|HTTP status:|invalid_field|ai-fb-/)
  assert.match(f.comments[0].text, /Error code: invalid_field/)
  assert.match(f.comments[0].text, /Fingerprint: ai-fb-/)
  assert.equal(f.comments[0].activity.type, 'AiFeedbackLog')
  assert.match(f.comments[0].activity.data.text, /invalid_field/)
})

test('a repeat report adds to the old ticket', async () => {
  const f = setup()
  const first = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  const second = await f.fileAiFeedback({ ...report, client: 'cursor' }, 43, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
  assert.equal(second.ticketNumber, first.ticketNumber)
  assert.equal(second.count, 2)
  assert.match(f.comments[0].text, /Seen 2 times/)
})

test('turning the flag off still joins the same ticket and refreshes the tally', async () => {
  const f = setup()
  const first = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  f.setEnabled(false)
  const second = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
  assert.equal(second.ticketNumber, first.ticketNumber)
  assert.match(f.comments[0].text, /Fingerprint: ai-fb-/)
  assert.match(f.comments[0].text, /Error code: invalid_field/)
  assert.match(f.comments[0].text, /HTTP status: 400/)
  assert.match(f.comments[0].text, /Seen 2 times/)
  assert.match(f.comments[0].activity.data.text, /Seen 2 times/)
  assert.match(f.comments[0].activity.data.text, /invalid_field/)
  const third = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(third.deduped, true)
  assert.equal(third.count, 3)
})

test('flag off keeps the error code in the description', async () => {
  const f = setup({ enabled: false })
  await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  assert.match(f.created[0].description, /Error code: invalid_field/)
  assert.match(f.created[0].description, /Fingerprint: ai-fb-/)
  const second = await f.fileAiFeedback(report, 42, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
})
