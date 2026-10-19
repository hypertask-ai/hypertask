const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '../src') }, cache: false })
const { aiFeedbackSchema, scrubFeedbackText, feedbackFingerprint, feedbackClient } = jiti('../src/lib/aiFeedback/input.ts')

test('scrubber removes realistic quoted task, board and comment content, including multiline excerpts', () => {
  const privateText = `update failed for task "Pay Acme invoice\nbefore Friday", board 'Secret acquisition', comment \`password: swordfish\`, title “Launch confidential merger” and note ‘Customer financial forecast’. Contact customer@acme.test at https://acme.test/tasks/7195 with id 7b1446c0-377b-4027-9a30-21da80925e7a and account 1234567890. <strong>HTTP failure</strong>`
  const result = scrubFeedbackText(privateText)
  for (const secret of ['Pay', 'Acme', 'Friday', 'Secret', 'acquisition', 'password', 'swordfish', 'Launch', 'merger', 'Customer', 'forecast', '@', 'https', '7b1446c0', '1234567890', '<strong>']) assert.equal(result.includes(secret), false, secret)
  assert.ok(result.includes('HTTP failure'))
  assert.ok(result.length <= 300)
})

test('scrubber removes escaped quotes, URLs, emails, credentials and unclosed excerpts', () => {
  for (const value of ['Failure &quot;Private task&quot;', 'Failure &#34;Private task&#34;', 'Failure `Private task', 'Failure “Private task', 'Failure "Private task', "Failure 'Private task"]) assert.equal(scrubFeedbackText(value), 'Failure')
  assert.equal(scrubFeedbackText(' failed \n user@example.test www.example.test https://example.test/a <img src="secret"> Bearer htk_supersecret '), 'failed')
  assert.equal(scrubFeedbackText('x'.repeat(600)), 'x'.repeat(300))
  assert.equal(scrubFeedbackText('one\t two\nthree'), 'one two three')
  assert.equal(scrubFeedbackText('Failure vck_secret123 httk_secret123'), 'Failure')
})

test('validation rejects unknown content fields, malformed structured fields and non-HTTP statuses', () => {
  const base = { surface: 'mcp', client: 'claude', tool: 'hypertask_tasks.create', status: 503, errorCode: 'service-unavailable' }
  assert.equal(aiFeedbackSchema.safeParse(base).success, true)
  for (const patch of [{ surface: 'browser' }, { client: 'email@example.test' }, { client: 'a'.repeat(41) }, { tool: '<script>' }, { tool: 'a'.repeat(81) }, { status: 503.5 }, { status: 99 }, { status: 600 }, { errorCode: 'a b' }, { error: 'a'.repeat(5001) }, { note: 42 }, { arguments: { title: 'Private content' } }, { body: 'Private content' }]) assert.equal(aiFeedbackSchema.safeParse({ ...base, ...patch }).success, false, JSON.stringify(patch))
  for (const surface of ['mcp', 'cli', 'api', 'agent']) assert.equal(aiFeedbackSchema.safeParse({ surface }).success, true)
  assert.equal(aiFeedbackSchema.safeParse(null).success, false)
})

test('fingerprints are sha256 of normalized structured failures, not text, client or account', () => {
  const crypto = require('node:crypto')
  const input = { surface: 'mcp', tool: 'Hypertask_TASKS', status: 503, errorCode: 'UPSTREAM' }
  const expected = crypto.createHash('sha256').update('mcp|hypertask_tasks|503|upstream|other').digest('hex')
  assert.equal(feedbackFingerprint(input), expected)
  assert.equal(feedbackFingerprint({ ...input, category: 'other' }), expected)
  assert.equal(feedbackFingerprint({ ...input, tool: 'hypertask_tasks', errorCode: 'upstream', note: 'private', error: 'different', client: 'cursor', userId: 123 }), expected)
  for (const patch of [{ surface: 'cli' }, { tool: 'other' }, { status: 500 }, { errorCode: 'other' }, { category: 'slow' }]) assert.notEqual(feedbackFingerprint({ ...input, ...patch }), expected)
  assert.equal(feedbackFingerprint({ surface: 'api' }), crypto.createHash('sha256').update('api||||other').digest('hex'))
})

test('MCP clientInfo produces a validated bounded slug', () => {
  assert.equal(feedbackClient('Claude Desktop'), 'claude-desktop')
  assert.equal(feedbackClient('---'), undefined)
  assert.equal(feedbackClient(null), undefined)
  assert.equal(feedbackClient('a'.repeat(90)), undefined)
})


test('ticket flag defaults to Everyone as a feature, supports Off and permits anonymous filing only in Everyone', async () => {
  const { load } = require('./task-route-loader.cjs')
  const { default: definition, HTPR_7195_AI_FEEDBACK_FLAG: key } = jiti('../src/lib/flags/definitions/htpr-7195-ai-feedback.ts')
  assert.equal(key, 'htpr-7195-ai-feedback')
  assert.equal(definition.kind, 'feature')
  assert.equal(definition.defaultMode, undefined)
  assert.ok(definition.releaseRisk.reason)
  let mode = null
  const db = {
    featureFlag: { findUnique: async () => mode ? { mode } : null },
    user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? 'valentin.yeo@gmail.com' : where.id === 985 ? 'valentin@hypertask.ai' : 'member@example.test' }) },
  }
  const flags = load('src/lib/flags.ts', { '@/lib/prisma': { default: {} } })
  assert.equal(flags.defaultFeatureFlagMode(key), 'EVERYONE')
  assert.equal(await flags.isFeatureEnabled(key, 6, db), true)
  assert.equal(await flags.isFeatureEnabled(key, 985, db), true)
  assert.equal(await flags.isFeatureEnabled(key, 42, db), true)
  assert.equal(await flags.featureFlagCandidateUserIds(key, db), null)
  mode = 'OFF'
  assert.equal(await flags.isFeatureEnabled(key, 985, db), false)
  assert.deepEqual(await flags.featureFlagCandidateUserIds(key, db), [])
  mode = 'EVERYONE'
  assert.equal(await flags.isFeatureEnabled(key, 42, db), true)
  assert.equal(await flags.featureFlagCandidateUserIds(key, db), null)
})


test('structured fields reject token prefixes, JWTs, long runs and numeric identifiers while legitimate slugs still work', () => {
  const secrets = ['vck_secret123', 'httk_secret123', 'abc_x7Yz9QwE', 'abc_x7.Yz9QwE', 'abcdef_x7Yz9QwE', 'ab_x7Yz9QwE', 'tool-abc_x7Yz9QwE', 'htk_secret123', 'htmk_' + 'secret123', 'eyJ' + 'hbGciOiJIUzI1NiJ9.payload', 'sk-secret', 'sk_secret', 'ghp_secret', 'gho_secret', 'github_pat_secret', 'xoxb-secret', 'Bearer-secret', 'error-123456', 'aB7cD9eF2g' + 'H4jK6mN8pQ', 'tool-htk_secret123', 'tool-sk_secret']
  for (const field of ['tool', 'client', 'errorCode']) {
    for (const value of secrets) {
      assert.equal(aiFeedbackSchema.safeParse({ surface: 'mcp', [field]: value }).success, false, `${field}: ${value}`)
    }
    for (const value of ['hypertask_tasks', 'hypertask_list_tasks', 'service-unavailable', '12345', 'a'.repeat(19)]) {
      assert.equal(aiFeedbackSchema.safeParse({ surface: 'mcp', [field]: value }).success, true, `${field}: ${value}`)
    }
  }
  for (const value of secrets) assert.equal(feedbackClient(value), undefined, value)
  assert.equal(aiFeedbackSchema.safeParse({ surface: 'mcp', tool: '/api/mcp/projects/:projectId/members' }).success, true)
})

test('category defaults to other and accepts only the documented categories, retaining free-text compatibility', () => {
  assert.equal(aiFeedbackSchema.parse({ surface: 'cli', note: 'private', error: 'private' }).category, 'other')
  for (const category of ['call_failed', 'empty_result', 'unexpected_result', 'auth_failed', 'slow', 'user_reported_broken', 'other']) {
    assert.equal(aiFeedbackSchema.parse({ surface: 'api', category }).category, category)
  }
  assert.equal(aiFeedbackSchema.safeParse({ surface: 'api', category: 'private' }).success, false)
})
