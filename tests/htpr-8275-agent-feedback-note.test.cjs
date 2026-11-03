const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-8275-agent-feedback-note'
const internalAgent = { id: 6, email: 'valentin.yeo@gmail.com', displayName: 'Valentin Yeo' }
const customerAgent = { id: 99, email: 'owner@example.com', displayName: 'Robin' }
const report = { surface: 'mcp', tool: 'hypertask_comments', status: 500, errorCode: 'tool-server-error', category: 'call_failed', kind: 'friction', note: 'Label list ignores --json, so jq fails' }

function setup({ enabled = true, user = internalAgent, flagError = false } = {}) {
  const created = [], comments = [], rows = [], flagReads = []
  const on = async (key) => {
    flagReads.push(key)
    if (flagError) throw new Error('Flag unavailable')
    return key !== flag || enabled
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => user },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.section !== 'Done' && row.description.includes(where.description_.is.content.contains)) ?? null },
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
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: on,
      featureFlagCandidateUserIds: async key => await on(key) ? null : [],
      FEATURE_FLAG_OWNER_USER_ID: 6,
      FEATURE_FLAG_QA_USER_ID: 985,
    },
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
    '@/lib/mcp/operationContext': { getMcpExecutionContext: () => ({ user: { id: user.id }, agentDisplayName: 'Runner 3' }) },
    '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: user.id }, agentDisplayName: 'Runner 3' }) },
    '@/lib/aiFeedback/clientInfo': { getFeedbackClient: async () => undefined },
    '../config/tool-metadata': { TOOL_METADATA: { REPORT_FEEDBACK: { name: 'hypertask_report_feedback' } } },
  })
  return { ...load('src/lib/aiFeedback/report.ts'), load, created, comments, rows, flagReads }
}

test('flag definition is a feature live for Everyone', () => {
  const definition = setup().load(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'feature')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'new')
})

test('our own agent keeps the kind and the cleaned note on the ticket it files', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(report, 6, { origin: 'agent', agentName: 'Runner 3' })
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  const [ticket] = f.created
  assert.equal(ticket.title, 'Agent feedback, friction: Label list ignores --json, so jq fails')
  assert.match(ticket.description, /<p>Kind: friction<\/p>/)
  assert.match(ticket.description, /<p>Note: Label list ignores --json, so jq fails<\/p>/)
  assert.doesNotMatch(ticket.description, /Free text was supplied and not stored/)
})

test('a note carrying a link, email, key or secret is not stored, and nothing of it leaks', async () => {
  const f = setup()
  await f.fileAiFeedback({
    ...report,
    kind: 'bug',
    note: 'Section list fails https://app.hypertask.ai/detail/project-15/8348 owner@example.com vck_9f8e7d6c5b4a ghp_123456AbCdEfGhIjKlMnOpQrStUvWxYz sk-ant-AbCdEf123456 api_ab12cd34ef56gh78 AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfG wJalrXUtnFEMI/KXMDENG/bPxRfiCYEXAMPLEKEY Basic YWRtaW46c2VjcmV0 123456789',
  }, 6, { origin: 'agent' })
  const ticket = f.created[0]
  assert.doesNotMatch(ticket.description, /<p>Note:/)
  for (const secret of ['owner@example.com', 'vck_', 'ghp_', 'sk-ant', 'api_ab12', 'AIzaSy', 'EXAMPLEKEY', 'YWRtaW46', '123456789', 'project-15/8348'])
    assert.equal(`${ticket.title} ${ticket.description}`.includes(secret), false, secret)
  assert.match(ticket.description, /Free text was supplied and not stored, for privacy\./)
})

test('a plain note keeps its words and its punctuation', async () => {
  const f = setup()
  await f.fileAiFeedback({ ...report, kind: 'bug', note: 'Label list ignores --json, so jq fails' }, 6, { origin: 'agent' })
  assert.equal(f.created[0].description.match(/<p>Note: ([^<]*)<\/p>/)[1], 'Label list ignores --json, so jq fails')
})

test('a customer agent keeps today behaviour: no kind, no note, free text dropped', async () => {
  const f = setup({ user: customerAgent })
  await f.fileAiFeedback(report, 99, { origin: 'agent' })
  const [ticket] = f.created
  assert.doesNotMatch(ticket.description, /Kind:|<p>Note:/)
  assert.match(ticket.description, /Free text was supplied and not stored, for privacy\./)
  assert.doesNotMatch(ticket.title, /^Agent feedback,/)
})

test('with the flag off our own agent keeps today behaviour too', async () => {
  const f = setup({ enabled: false })
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  assert.doesNotMatch(f.created[0].description, /Kind:|<p>Note:/)
  assert.match(f.created[0].description, /Free text was supplied and not stored, for privacy\./)
})

test('with the flag off the MCP door still passes the note through, so the privacy notice stays', async () => {
  const f = setup({ enabled: false })
  const { reportFeedbackTool } = f.load('src/lib/mcp-server/tools/report-feedback.tool.ts')
  await reportFeedbackTool.execute({ status: 500, kind: 'bug', note: 'kept for presence only' }, 'fixture')
  assert.doesNotMatch(f.created[0].description, /<p>Note:/)
  assert.match(f.created[0].description, /Free text was supplied and not stored, for privacy\./)
})

test('a note with anything that is not plain words is not stored', async () => {
  const f = setup()
  await f.fileAiFeedback({ ...report, kind: 'bug', note: 'board filters ignore AbCdEfGhIjKl12345MnOpQrStUvWx again' }, 6, { origin: 'agent' })
  assert.doesNotMatch(f.created[0].description, /<p>Note:/)
  assert.doesNotMatch(f.created[0].description, /AbCdEfGhIjKl|MnOpQrStUvWx/)
  assert.match(f.created[0].description, /Free text was supplied and not stored, for privacy\./)
})

test('a note that still looks credential-shaped is not stored at all', async () => {
  const f = setup()
  await f.fileAiFeedback({ ...report, kind: 'bug', note: 'the xox queue never drains' }, 6, { origin: 'agent' })
  assert.doesNotMatch(f.created[0].description, /<p>Note:/)
  assert.match(f.created[0].description, /Free text was supplied and not stored, for privacy\./)
})

test('a note keeps ordinary words, contractions and short identifiers', async () => {
  const f = setup()
  await f.fileAiFeedback({ ...report, kind: 'bug', note: "Label picker doesn't open for project-15" }, 6, { origin: 'agent' })
  const note = f.created[0].description.match(/<p>Note: ([^<]*)<\/p>/)[1]
  assert.equal(note, "Label picker doesn&#39;t open for project-15")
})

test('stored kind and note keep their own place and their case in the fingerprint', () => {
  const f = setup()
  const { feedbackFingerprint: fingerprint } = f.load('src/lib/aiFeedback/input.ts')
  const base = { surface: 'mcp', tool: 'hypertask_comments', status: 500 }
  assert.notEqual(fingerprint(base, { kind: 'bug' }), fingerprint(base, { note: 'bug' }))
  assert.equal(fingerprint(base, { kind: 'bug' }), fingerprint(base, { kind: 'bug' }))
  assert.notEqual(fingerprint(base, { note: 'The --json flag fails' }), fingerprint(base, { note: 'The --JSON flag fails' }))
})

test('a report that keeps nothing hashes exactly as it did before this ticket', () => {
  const f = setup()
  const { feedbackFingerprint: fingerprint } = f.load('src/lib/aiFeedback/input.ts')
  const legacy = require('node:crypto').createHash('sha256').update('mcp|hypertask_comments|500||other').digest('hex')
  assert.equal(fingerprint({ surface: 'mcp', tool: 'hypertask_comments', status: 500 }), legacy)
})

test('a flag read that throws drops the note instead of filing without it', async () => {
  const f = setup({ flagError: true })
  const result = await f.fileAiFeedback(report, 6, { origin: 'agent' })
  assert.equal(result.success, true)
  assert.doesNotMatch(f.created[0].description, /<p>Note:/)
})

test('the same kind, tool and note bumps one ticket; a different note opens its own', async () => {
  const f = setup()
  await f.fileAiFeedback(report, 6, { origin: 'agent' })
  const second = await f.fileAiFeedback(report, 6, { origin: 'agent' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
  assert.equal(second.count, 2)
  await f.fileAiFeedback({ ...report, note: 'Board column list names the wrong field' }, 6, { origin: 'agent' })
  assert.equal(f.created.length, 2)
})

test('a customer report with a note still dedupes on the report alone', async () => {
  const f = setup({ user: customerAgent })
  await f.fileAiFeedback({ ...report, note: 'first words' }, 99, { origin: 'agent' })
  const second = await f.fileAiFeedback({ ...report, note: 'other words entirely' }, 99, { origin: 'agent' })
  assert.equal(f.created.length, 1)
  assert.equal(second.deduped, true)
})
