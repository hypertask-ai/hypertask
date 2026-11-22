const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

function clauseHolds(comment, clause) {
  if (clause?.NOT?.text?.contains) return !comment.text.includes(clause.NOT.text.contains)
  if (clause?.text?.contains) return comment.text.includes(clause.text.contains)
  return false
}

function commentMatches(comment, where) {
  if (where?.text?.contains) return comment.text.includes(where.text.contains)
  const clauses = where?.AND ?? []
  return clauses.length > 0 && clauses.every((clause) => clauseHolds(comment, clause))
}

function setup({ repeatJoin = true } = {}) {
  const created = []
  const comments = []
  const rows = []
  const locks = []
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
        const matches = (comment) => commentMatches(comment, where)
        if (where.task) {
          const comment = comments.find((comment) => matches(comment))
          const task = comment && rows.find((row) => row.id === comment.taskId && row.section !== 'Done')
          return task ? { task: { id: task.id, userId: task.userId, ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, createdAt: task.createdAt } } : null
        }
        return comments.find((comment) => comment.taskId === where.taskId && matches(comment)) ?? null
      },
      update: async ({ where, data }) => Object.assign(comments.find((comment) => comment.id === where.id), data),
    },
    $queryRaw: async (_query, value) => {
      locks.push(value)
      return [{ locked: true }]
    },
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
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, comments, rows, locks }
}

test('flag is a bug fix on for everyone', () => {
  const file = path.join(__dirname, '..', 'src/lib/flags/definitions', `${flag}.ts`)
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  assert.match(source, new RegExp(`["']${flag}["']`))
  assert.match(source, /kind:\s*["']bugfix["']/)
  assert.match(source, /defaultMode:\s*["']EVERYONE["']/)
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
  assert.equal(f.locks.length, 6)
  assert.notEqual(f.locks[0], f.locks[2])
  assert.equal(f.locks[1], f.locks[3])
  assert.equal(f.locks[1], f.locks[5])
})

test('a report that leaves out the tool or the kind does not join a ticket that named it', async () => {
  const withTool = setup()
  await withTool.fileAiFeedback(report, 6, { origin: 'agent' })
  const { tool, ...withoutTool } = report
  const otherTool = await withTool.fileAiFeedback({
    ...withoutTool,
    note: note.replace('1188', '1200'),
  }, 6, { origin: 'agent' })
  assert.equal(otherTool.deduped, false)
  assert.equal(withTool.created.length, 2)

  const withKind = setup()
  await withKind.fileAiFeedback(report, 6, { origin: 'agent' })
  const { kind, ...withoutKind } = report
  const otherKind = await withKind.fileAiFeedback({
    ...withoutKind,
    note: note.replace('1188', '1200'),
  }, 6, { origin: 'agent' })
  assert.equal(otherKind.deduped, false)
  assert.equal(withKind.created.length, 2)
})

test('two reports that both leave the tool out still join on the same sentence', async () => {
  const f = setup()
  const { tool, ...withoutTool } = report
  await f.fileAiFeedback(withoutTool, 6, { origin: 'agent' })
  const second = await f.fileAiFeedback({
    ...withoutTool,
    note: note.replace('1188', '1200'),
  }, 6, { origin: 'agent' })
  assert.equal(second.deduped, true)
  assert.equal(f.created.length, 1)
  assert.equal(f.locks[1], f.locks[3])
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
  assert.equal(f.locks.length, 2)
})
