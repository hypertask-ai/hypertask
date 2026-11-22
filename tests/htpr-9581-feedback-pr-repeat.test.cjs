const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9581-feedback-pr-repeat'
const internal = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const note = 'Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1188.'
const report = {
  surface: 'cli',
  tool: 'git-commit',
  errorCode: 'co-authored-by-injected',
  category: 'other',
  kind: 'friction',
  note,
  client: 'hypertask-cli',
}

function needles(where) {
  if (where?.text?.contains) return [where.text.contains]
  return (where?.AND ?? []).map((item) => item.text?.contains).filter(Boolean)
}

function setup({ repeatJoin = true } = {}) {
  const created = []
  const comments = []
  const rows = []
  const on = async (key) => key !== flag || repeatJoin
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => internal },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => {
      const marker = where.description_?.is?.content?.contains
      if (!marker) return null
      return rows.find((row) => row.section !== 'Done' && row.description.includes(marker)) ?? null
    } },
    comment: {
      findFirst: async ({ where }) => {
        const wanted = needles(where)
        const matches = (comment) => wanted.every((needle) => comment.text.includes(needle))
        if (where.task) {
          const comment = comments.find((comment) => matches(comment))
          const task = comment && rows.find((row) => row.id === comment.taskId && row.section !== 'Done')
          return task ? { task: { id: task.id, userId: task.userId, ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, createdAt: task.createdAt } } : null
        }
        return comments.find((comment) => comment.taskId === where.taskId && matches(comment)) ?? null
      },
      update: async ({ where, data }) => Object.assign(comments.find((comment) => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async (run) => run(db),
  }
  const load = loader({
    '@/lib/prisma': { __esModule: true, default: db },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: on,
      featureFlagCandidateUserIds: async (key) => await on(key) ? null : [],
      FEATURE_FLAG_OWNER_USER_ID: 6,
      FEATURE_FLAG_QA_USER_ID: 985,
    },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async (options) => {
      const task = { ...options, id: created.length + 1, ticketNumber: `HTPR-${9581 + created.length}`, uniqueIndex: 9581 + created.length, section: 'Bugs' }
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
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, comments, rows }
}

test('flag is a bug fix on for everyone', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('a repeat that names another pull request joins the open ticket and the description still has no error code', async () => {
  const f = setup()
  const first = await f.fileAiFeedback(report, 6, { origin: 'agent', agentName: 'Runner' })
  const second = await f.fileAiFeedback({
    ...report,
    note: 'Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1200.',
  }, 6, { origin: 'agent', agentName: 'Runner' })
  assert.equal(first.success, true)
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
  assert.equal(second.ticketNumber, first.ticketNumber)
  assert.equal(second.count, 2)
  assert.match(f.created[0].description, /PR 1188/)
  assert.doesNotMatch(f.created[0].description, /Error code:|co-authored-by-injected|Fingerprint:/)
  assert.match(f.created[0].description, /A repeat report joins this same ticket/)
  assert.match(f.comments[0].text, /Seen 2 times/)
  assert.match(f.comments[0].text, /Error code: co-authored-by-injected/)
  assert.match(f.comments[0].text, /PR 1200/)
  const again = await f.fileAiFeedback(report, 6, { origin: 'agent', agentName: 'Runner' })
  assert.equal(f.created.length, 1)
  assert.equal(again.deduped, true)
  assert.equal(again.count, 3)
})

test('a short note that only shares the pull request words still opens its own ticket', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const other = await f.fileAiFeedback({
    ...report,
    note: 'Build failed on PR 9.',
  }, 6, { origin: 'agent' })
  assert.equal(other.deduped, false)
  assert.equal(f.created.length, 2)
})

test('the same failure with a different sentence still opens its own ticket', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const other = await f.fileAiFeedback({
    ...report,
    note: 'A different command wrote the trailer on PR 44.',
  }, 6, { origin: 'agent' })
  assert.equal(other.deduped, false)
  assert.equal(f.created.length, 2)
})

test('the same sentence with a different error code opens its own ticket', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const other = await f.fileAiFeedback({
    ...report,
    errorCode: 'other-code',
    note: 'Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1200.',
  }, 6, { origin: 'agent' })
  assert.equal(other.deduped, false)
  assert.equal(f.created.length, 2)
})

test('turning the flag off opens a second ticket when the pull request number changes', async () => {
  const f = setup({ repeatJoin: false })
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const second = await f.fileAiFeedback({
    ...report,
    note: 'Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1200.',
  }, 6, { origin: 'agent' })
  assert.equal(second.deduped, false)
  assert.equal(f.created.length, 2)
})
