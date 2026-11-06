const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const internal = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const fingerprint = 'a'.repeat(64)

function setup() {
  const created = []
  const users = { 6: internal, 99: { id: 99, email: 'owner@example.com', displayName: 'Robin' } }
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
  const report = loadModule('src/lib/aiFeedback/report.ts', {
    '@/lib/prisma': { __esModule: true, default: db },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: async () => true,
      featureFlagCandidateUserIds: async () => null,
      FEATURE_FLAG_OWNER_USER_ID: 6,
      FEATURE_FLAG_QA_USER_ID: 985,
    },
    '@/lib/telemetry/accountCategory': { accountCategory: user => user.email === internal.email ? 'internal' : 'customer' },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async options => {
      created.push(options)
      return { task: { ...options, id: created.length, ticketNumber: `HTPR-${8600 + created.length}`, uniqueIndex: 8600 + created.length } }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => ({ id: 1 }) },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
  })
  return { ...report, created }
}

test('a missing-kind report names the command the agent already tried', async () => {
  const f = setup()
  await f.fileAiFeedback({
    surface: 'mcp', kind: 'missing', tool: 'hypertask_comments', category: 'empty_result',
    note: 'There is no verb for editing a comment',
  }, 6, { origin: 'agent', agentName: 'Runner 3' })
  assert.equal(f.created[0].title, 'Agent feedback, missing: There is no verb for editing a comment (hypertask_comments)')
})

test('a note that already names the command is not named twice', () => {
  const { plainFeedback } = setup()
  const title = plainFeedback(
    { surface: 'mcp', tool: 'hypertask_comments', category: 'empty_result' },
    fingerprint,
    undefined,
    { kind: 'missing', note: 'Hypertask_comments has no edit verb' },
  ).title
  assert.equal(title, 'Agent feedback, missing: Hypertask_comments has no edit verb')
})

test('a missing-kind report with no note still names the command once', () => {
  const { plainFeedback } = setup()
  const title = plainFeedback(
    { surface: 'mcp', tool: 'hypertask_comments', category: 'empty_result' },
    fingerprint,
    undefined,
    { kind: 'missing' },
  ).title
  assert.equal(title, "Agent feedback, missing: An agent's MCP call to hypertask_comments returned nothing")
})

test('other kinds keep their title exactly as before', () => {
  const { plainFeedback } = setup()
  const input = { surface: 'mcp', tool: 'hypertask_comments', status: 500, errorCode: 'tool-server-error', category: 'call_failed' }
  assert.equal(
    plainFeedback(input, fingerprint, undefined, { kind: 'friction', note: 'Label list ignores --json, so jq fails' }).title,
    'Agent feedback, friction: Label list ignores --json, so jq fails',
  )
  assert.equal(
    plainFeedback(input, fingerprint, undefined, { kind: 'bug', note: 'Label list ignores --json, so jq fails' }).title,
    'Agent feedback, bug: Label list ignores --json, so jq fails',
  )
})

test('a customer agent report keeps its plain title without a kind', async () => {
  const f = setup()
  await f.fileAiFeedback({ surface: 'cli', kind: 'missing', tool: 'comment.update', status: 400, category: 'call_failed' }, 99, { origin: 'agent' })
  assert.doesNotMatch(f.created[0].title, /^Agent feedback, missing:/)
  assert.match(f.created[0].title, /call to comment\.update failed \(/)
})
