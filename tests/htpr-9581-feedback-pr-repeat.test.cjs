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

function descriptionMatches(row, where) {
  return (where?.AND ?? []).every((clause) => {
    const present = clause.description_?.is?.content?.contains
    const missing = clause.NOT?.description_?.is?.content?.contains
    if (present) return row.description.includes(present)
    if (missing) return !row.description.includes(missing)
    return true
  })
}

function commentMatches(comment, where) {
  if (where?.text?.contains) return comment.text.includes(where.text.contains)
  const clauses = where?.AND ?? []
  return clauses.length > 0 && clauses.every((clause) => clauseHolds(comment, clause))
}

function setup({ repeatJoin = true, house = true } = {}) {
  const created = []
  const comments = []
  const rows = []
  const locks = []
  const options = { repeatJoin, house }
  const on = async (key) => {
    if (!options.house && (key === 'htpr-8797-feedback-house-parts' || key === 'htpr-7536-plain-ai-feedback')) return false
    return key !== flag || options.repeatJoin
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => internal },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: {
      findFirst: async ({ where }) => {
        const marker = where.description_?.is?.content?.contains
        if (!marker) return null
        return rows.find((row) => row.section !== 'Done' && row.description.includes(marker)) ?? null
      },
      findMany: async ({ where, skip = 0, take }) => rows
        .filter((row) => row.section !== 'Done' && descriptionMatches(row, where))
        .sort((a, b) => a.id - b.id)
        .slice(skip, take ? skip + take : undefined)
        .map((row) => ({ id: row.id, userId: row.userId, ticketNumber: row.ticketNumber, uniqueIndex: row.uniqueIndex, description_: { content: row.description } })),
    },
    comment: {
      findMany: async ({ where, skip = 0, take }) => comments
        .filter((comment) => commentMatches(comment, where))
        .sort((a, b) => a.id - b.id)
        .slice(skip, take ? skip + take : undefined)
        .flatMap((comment) => {
          const task = rows.find((row) => row.id === comment.taskId && row.section !== 'Done')
          return task ? [{ text: comment.text, task: { id: task.id, userId: task.userId, ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, createdAt: task.createdAt } }] : []
        }),
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
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, comments, rows, locks, options }
}

test('flag is a bug fix on for everyone', () => {
  const file = path.join(__dirname, '..', 'src/lib/flags/definitions', `${flag}.ts`)
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  assert.match(source, new RegExp(`["']${flag}["']`))
  assert.match(source, /kind:\s*["']bugfix["']/)
  assert.match(source, /defaultMode:\s*["']EVERYONE["']/)
})

const documentedBody = {
  surface: 'cli',
  tool: 'git-commit',
  errorCode: 'co-authored-by-injected',
  category: 'other',
  note: 'Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1188.',
}

test('the documented repro body is a surface the schema allows and the second call joins', async () => {
  const f = setup()
  const { aiFeedbackSchema } = f.load('src/lib/aiFeedback/input.ts')
  assert.equal(aiFeedbackSchema.safeParse({ ...documentedBody, surface: 'board' }).success, false)
  const first = await f.fileAiFeedback(aiFeedbackSchema.parse(documentedBody), 6, { origin: 'agent', agentName: 'Runner' })
  const second = await f.fileAiFeedback(aiFeedbackSchema.parse({ ...documentedBody, note: documentedBody.note.replace('1188', '1200') }), 6, { origin: 'agent', agentName: 'Runner' })
  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(second.deduped, true)
  assert.equal(second.ticketNumber, first.ticketNumber)
  assert.equal(f.created.length, 1)
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

test('three pull request joins keep every fingerprint, so the off switch still finds the first report', async () => {
  const f = setup()
  const pulls = [1188, 1200, 1300]
  const filed = []
  for (const pull of pulls) {
    filed.push(await f.fileAiFeedback({ ...report, note: note.replace('1188', String(pull)) }, 6, { origin: 'agent' }))
  }
  assert.equal(f.created.length, 1)
  const markers = f.comments[0].text.match(/<p>Fingerprint: ai-fb-[0-9a-f]{12}<\/p>/g) ?? []
  assert.equal(new Set(markers).size, 3)
  f.options.repeatJoin = false
  for (const pull of pulls) {
    const again = await f.fileAiFeedback({ ...report, note: note.replace('1188', String(pull)) }, 6, { origin: 'agent' })
    assert.equal(again.deduped, true)
    assert.equal(again.ticketNumber, filed[0].ticketNumber)
  }
  assert.equal(f.created.length, 1)
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

test('a different status or category does not join', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const status = await f.fileAiFeedback({ ...report, status: 500, note: note.replace('1188', '1200') }, 6, { origin: 'agent' })
  const category = await f.fileAiFeedback({ ...report, category: 'call_failed', note: note.replace('1188', '1300') }, 6, { origin: 'agent' })
  assert.equal(status.deduped, false)
  assert.equal(category.deduped, false)
  assert.equal(f.created.length, 3)
})

test('text after the pull request number has to match', async () => {
  const stem = 'Cursor session appended Co-authored-by trailer to bot commits on PR '
  const f = setup()
  await f.fileAiFeedback({ ...report, note: `${stem}1188 failed validation.` }, 6, { origin: 'agent' })
  const other = await f.fileAiFeedback({ ...report, note: `${stem}1200 deleted production.` }, 6, { origin: 'agent' })
  assert.equal(other.deduped, false)
  const same = await f.fileAiFeedback({ ...report, note: `${stem}1300 failed validation.` }, 6, { origin: 'agent' })
  assert.equal(same.deduped, true)
  assert.equal(f.created.length, 2)
  assert.equal(f.locks[1], f.locks[5])
})

test('with the house log off, a repeat still joins the ticket description', async () => {
  const f = setup({ house: false })
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const second = await f.fileAiFeedback({ ...report, note: note.replace('1188', '1200') }, 6, { origin: 'agent' })
  assert.equal(second.deduped, true)
  assert.equal(f.created.length, 1)
  assert.doesNotMatch(f.comments[0].text, /Error code:/)
  assert.match(f.created[0].description, /<p>Note: .*PR 1188\./)
})

test('a matching note past the first page still joins', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const real = f.comments[0]
  const decoys = Array.from({ length: 50 }, (_, index) => ({
    ...real,
    id: index + 1,
    text: real.text.replace('PR 1188.', 'PR 1 extra ending.'),
  }))
  real.id = decoys.length + 1
  f.comments.splice(0, f.comments.length, ...decoys, real)
  const second = await f.fileAiFeedback({ ...report, note: note.replace('1188', '1200') }, 6, { origin: 'agent' })
  assert.equal(second.deduped, true)
  assert.equal(f.created.length, 1)
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
