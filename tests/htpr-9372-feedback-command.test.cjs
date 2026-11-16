const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const flag = 'htpr-9372-feedback-command'
const tool = 'vcc-task-list-project-2060-labels-triage'
const fingerprint = 'a'.repeat(64)
const internal = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const report = {
  surface: 'cli',
  client: 'hypertask-cli',
  tool,
  category: 'other',
  kind: 'bug',
  note: 'the xox queue never drains',
}

function setup(keep = true) {
  const created = []
  const users = { 6: internal }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async ({ where }) => users[where.id] ?? null },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async () => null },
    comment: { findFirst: async () => null, update: async () => {} },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async run => run(db),
  }
  const loaded = loadModule('src/lib/aiFeedback/report.ts', {
    '@/lib/prisma': { __esModule: true, default: db },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: async (key) => key !== flag || keep,
      featureFlagCandidateUserIds: async (key) => key === flag && !keep ? [6] : null,
      FEATURE_FLAG_OWNER_USER_ID: 6,
      FEATURE_FLAG_QA_USER_ID: 985,
    },
    '@/lib/telemetry/accountCategory': { accountCategory: (user) => user.email === internal.email ? 'internal' : 'customer' },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async (options) => {
      created.push(options)
      return { task: { ...options, id: created.length, ticketNumber: `HTPR-${9372 + created.length}`, uniqueIndex: 9372 + created.length } }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => ({ id: 1 }) },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
  })
  return { ...loaded, created }
}

test('flag definition is a bugfix live for everyone', () => {
  const file = require('./helpers/loadModule.cjs').loadModule(`src/lib/flags/definitions/${flag}.ts`)
  assert.equal(file.default.key, flag)
  assert.equal(file.default.kind, 'bugfix')
  assert.equal(file.default.defaultMode, 'EVERYONE')
  assert.equal(file.HTPR_9372_FEEDBACK_COMMAND_FLAG, flag)
})

test('a long command stays in the title and the problem line', () => {
  const { plainFeedback } = setup()
  const stored = { kind: 'bug' }
  const input = { surface: 'cli', tool, category: 'other', note: 'the xox queue never drains' }
  const hidden = plainFeedback(input, fingerprint, undefined, stored, 'house', false)
  const shown = plainFeedback(input, fingerprint, undefined, stored, 'house', true)
  assert.equal(hidden.title, "Agent feedback, bug: An agent's CLI call to...")
  assert.equal(shown.title, "Agent feedback, bug: An agent's CLI call to vcc-task-list-project-2060-labels-tria...")
  assert.equal(hidden.description.includes(tool), false)
  assert.match(shown.description, new RegExp(`<p>An agent&#39;s CLI call to ${tool} had a problem\\.</p>`))
})

test('a kept note still owns the title while the problem line names the command', () => {
  const { plainFeedback } = setup()
  const stored = { kind: 'bug', note: 'Label list ignores --json, so jq fails' }
  const rendered = plainFeedback({ surface: 'cli', tool, category: 'other' }, fingerprint, undefined, stored, 'house', true)
  assert.equal(rendered.title, 'Agent feedback, bug: Label list ignores --json, so jq fails')
  assert.match(rendered.description, new RegExp(tool))
})

test('filing the report keeps the command when the note cannot be stored', async () => {
  const on = setup(true)
  await on.fileAiFeedback(report, 6, { origin: 'agent', agentName: 'Valentins Claude Code' })
  assert.equal(on.created[0].title, "Agent feedback, bug: An agent's CLI call to vcc-task-list-project-2060-labels-tria...")
  assert.match(on.created[0].description, new RegExp(tool))
  assert.match(on.created[0].description, /Free text was supplied and not stored, for privacy\./)
  const off = setup(false)
  await off.fileAiFeedback(report, 6, { origin: 'agent', agentName: 'Valentins Claude Code' })
  assert.equal(off.created[0].title, "Agent feedback, bug: An agent's CLI call to...")
  assert.equal(off.created[0].description.includes(tool), false)
})
