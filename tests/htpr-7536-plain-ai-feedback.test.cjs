const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { loader } = require('./htpr-6927-fixtures.cjs')

const key = 'htpr-7536-plain-ai-feedback'
const now = '2026-10-21T12:00:00.000Z'
const unauthorized = { surface: 'mcp', tool: 'mcp', status: 401, errorCode: 'unauthorized', category: 'auth_failed' }
const serverError = { surface: 'api', status: 500, category: 'call_failed' }
const bare = { surface: 'cli', category: 'call_failed' }

function setup({ mode = null, name = 'Robin', flagError = false } = {}) {
  const created = [], comments = [], rows = [], lookups = [], quotas = [], broadcasts = [], userQueries = []
  const enabled = async (flag, userId) => {
    lookups.push({ flag, userId })
    if (flagError) throw new Error('Flag unavailable')
    return mode === null || mode === 'EVERYONE' || mode === 'OWNER_ONLY' && userId === 6
  }
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async query => { userQueries.push(query); return { displayName: name } } },
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
    '@/lib/prisma': { __esModule: true, default: db },
    './enabled': { aiFeedbackEnabled: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: enabled,
      featureFlagCandidateUserIds: async flag => await enabled(flag) ? null : [],
    },
    './rateLimit': {
      reserveFeedbackAttempt: async () => true,
      reserveFeedbackQuota: async (userId, existing) => { quotas.push({ userId, existing }); return true },
    },
    '@/utils/controllers/tasks/createTaskCore': { createTaskCore: async options => {
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
    '@/lib/realtime/server': { broadcastTaskChange: async id => broadcasts.push(id) },
  })
  return { load, ...load('src/lib/aiFeedback/report.ts'), created, rows, comments, lookups, quotas, broadcasts, userQueries }
}

function legacyDescription(input, fingerprint, name = 'Robin') {
  return [['Surface', input.surface], ['Tool', input.tool], ['HTTP status', input.status], ['Error code', input.errorCode], ['Category', input.category ?? 'other']]
    .filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => `<p>${label}: ${value}</p>`).join('') +
    (input.error !== undefined || input.note !== undefined ? '<p>Free text was supplied and not stored, for privacy.</p>' : '') +
    `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p><p>Last seen: ${now}</p><p>Reporting display names: ${name}</p><p>Clients: ${input.client ?? ''}</p>`
}

test.beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) }))

test('flag has one client-safe improvement definition, Everyone default and telemetry-only risk', () => {
  const f = setup()
  const definition = f.load(`src/lib/flags/definitions/${key}.ts`).default
  assert.equal(definition.key, key)
  assert.equal(definition.kind, 'improvement')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.equal(definition.releaseRisk.highRisk, undefined)
  assert.equal(f.load('src/lib/flags/definitions.ts').FEATURE_FLAG_DEFINITIONS.filter(flag => flag.key === key).length, 1)
})

for (const input of [unauthorized, { ...serverError, tool: 'tasks', errorCode: 'unavailable', client: 'claude', note: 'private note' }, bare]) {
  test(`flag Off preserves exact legacy title, description and success receipt for ${input.surface}`, async () => {
    const f = setup({ mode: 'OFF' })
    const result = await f.fileAiFeedback(input, 42)
    const fingerprint = f.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(input)
    assert.equal(f.created[0].title, `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`)
    assert.equal(f.created[0].description, legacyDescription(input, fingerprint))
    assert.deepEqual(result, { success: true, ticketNumber: 'HTPR-8001', url: 'https://app.hypertask.ai/detail/project-15/8001', deduped: false, count: 1 })
    assert.deepEqual(f.lookups, [{ flag: key, userId: 42 }])
  })
}

test('flag lookup failure falls back to legacy reporting', async () => {
  const f = setup({ flagError: true })
  await f.fileAiFeedback(unauthorized, 42)
  assert.equal(f.created[0].title, 'AI feedback: mcp mcp')
})

test('flag On renders the four plain sections followed by unchanged engineer fields', async () => {
  const f = setup()
  const input = { ...serverError, tool: 'tasks', errorCode: 'server_error', client: 'claude', note: 'customer secret' }
  await f.fileAiFeedback(input, 42)
  const fingerprint = f.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(input)
  const expected = '<p><strong>What happened</strong>: An agent&#39;s API call to tasks failed because Hypertask returned a server error.</p>' +
    '<p><strong>Who hit it</strong>: unknown agent (reporting account: Robin).</p>' +
    '<p><strong>Is it a real bug?</strong> This is likely a Hypertask bug.</p>' +
    '<p><strong>What to do</strong>: An engineer should look.</p><h2>Details for engineers</h2>' + legacyDescription(input, fingerprint)
  assert.equal(f.created[0].title, "An agent's API call to tasks failed because Hypertask returned a server error (21 Oct)")
  assert.equal(f.created[0].description, expected)
  assert.equal(expected.includes('customer secret'), false)
  assert.deepEqual(f.userQueries[0].select, { displayName: true })
})

for (const refusal of [{ status: 401 }, { status: 403 }, { status: 404 }, { errorCode: 'unauthorized' }, { errorCode: 'forbidden' }, { errorCode: 'not_found' }, { errorCode: 'UNAUTHORIZED' }, { category: 'auth_failed' }]) {
  test(`now refused: ${JSON.stringify(refusal)} files nothing without an open match`, async t => {
    const log = t.mock.method(console, 'info', () => {})
    const f = setup()
    const result = await f.fileAiFeedback({ surface: 'mcp', ...refusal }, 42)
    assert.deepEqual(result, { success: false, filed: false, reason: 'access_refused', error: 'Normal access refusal; no new ticket was filed.' })
    assert.equal(result.ticketNumber, undefined)
    assert.equal(f.created.length, 0)
    assert.equal(f.comments.length, 0)
    assert.equal(f.quotas.length, 0)
    assert.equal(log.mock.calls.length, 1)
    assert.match(log.mock.calls[0].arguments[0], /normal access refusal/)
  })
}

test('still allowed: a 500 files a plain ticket with the existing API success shape', async () => {
  const f = setup()
  const result = await f.fileAiFeedback(serverError, 42)
  assert.deepEqual(result, { success: true, ticketNumber: 'HTPR-8001', url: 'https://app.hypertask.ai/detail/project-15/8001', deduped: false, count: 1 })
  assert.equal(f.created[0].title, "An agent's API call failed because Hypertask returned a server error (21 Oct)")
  assert.equal(f.comments.length, 1)
})

test('401 with an existing legacy ticket bumps the same tally without rewriting the description', async t => {
  const log = t.mock.method(console, 'info', () => {})
  const f = setup()
  const fingerprint = f.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(unauthorized)
  const original = legacyDescription(unauthorized, fingerprint)
  f.rows.push({ id: 88, userId: 7, ticketNumber: 'HTPR-7516', uniqueIndex: 7516, description: original })
  f.comments.push({ id: 91, taskId: 88, text: `<p>AI feedback tally: ai-fb-${fingerprint.slice(0, 12)}</p><p>Seen 4 times</p><p>Reporting display names: Casey</p><p>Clients: cursor</p>` })
  const result = await f.fileAiFeedback({ ...unauthorized, client: 'claude' }, 42)
  assert.deepEqual(result, { success: true, ticketNumber: 'HTPR-7516', url: 'https://app.hypertask.ai/detail/project-15/7516', deduped: true, count: 5 })
  assert.equal(f.created.length, 0)
  assert.equal(f.rows[0].description, original)
  assert.match(f.comments[0].text, /<p>Seen 5 times<\/p>/)
  assert.match(f.comments[0].text, /Reporting display names: Casey, Robin/)
  assert.match(f.comments[0].text, /Clients: cursor, claude/)
  assert.equal(f.comments[0].summary, null)
  assert.deepEqual(f.broadcasts, [88])
  assert.deepEqual(f.quotas, [{ userId: 42, existing: true }])
  assert.equal(log.mock.calls.length, 0)
})

test('closed refusal tickets do not cause new tickets', async t => {
  t.mock.method(console, 'info', () => {})
  const f = setup()
  const fingerprint = f.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(unauthorized)
  f.rows.push({ id: 88, section: 'Done', description: legacyDescription(unauthorized, fingerprint) })
  assert.equal((await f.fileAiFeedback(unauthorized, 42)).filed, false)
  assert.equal(f.created.length, 0)
})

test('bare call_failed fingerprint is sha256(cli||||call_failed) and all reporters share one open ticket', async () => {
  const f = setup({ name: '' })
  const { feedbackFingerprint } = f.load('src/lib/aiFeedback/input.ts')
  const expected = createHash('sha256').update('cli||||call_failed').digest('hex')
  assert.equal(feedbackFingerprint(bare), expected)
  assert.equal(feedbackFingerprint({ ...bare, client: 'claude' }), expected)
  await f.fileAiFeedback(bare, 42)
  const result = await f.fileAiFeedback({ ...bare, client: 'cursor' }, 43)
  assert.equal(f.created.length, 1)
  assert.equal(result.deduped, true)
  assert.equal(result.count, 2)
  assert.equal(f.created[0].title, "An agent's CLI call failed with no details (21 Oct)")
  assert.match(f.created[0].description, /Who hit it<\/strong>: unknown agent\./)
  assert.match(f.created[0].description, /There are no details, so we can&#39;t tell/)
  assert.match(f.created[0].description, /Nothing for now/)
})

test('plain tickets retain parsable fingerprint and tally markers across repeat reports', async () => {
  const f = setup()
  await f.fileAiFeedback({ ...serverError, client: 'claude' }, 42)
  const original = f.created[0].description
  const result = await f.fileAiFeedback({ ...serverError, client: 'cursor' }, 43)
  assert.equal(result.count, 2)
  assert.equal(f.created.length, 1)
  assert.equal(f.created[0].description, original)
  assert.match(original, /<p>Fingerprint: ai-fb-[a-f0-9]{12}<\/p>/)
  assert.match(f.comments[0].text, /<p>AI feedback tally: ai-fb-[a-f0-9]{12}<\/p><p>Seen 2 times<\/p>/)
  assert.match(f.comments[0].text, /<p>Last seen: 2026-10-21T12:00:00.000Z<\/p>/)
  assert.match(f.comments[0].text, /<p>Clients: claude, cursor<\/p>/)
})

test('plain summaries distinguish scope, categories and supplied free text without storing it', () => {
  const { plainFeedback } = setup()
  assert.match(plainFeedback(unauthorized, 'a'.repeat(64)).title, /refused when it signed in through MCP/)
  assert.match(plainFeedback({ surface: 'mcp', status: 403 }, 'a'.repeat(64)).description, /board or action it is not allowed/)
  assert.match(plainFeedback({ surface: 'mcp', category: 'empty_result', tool: 'search' }, 'a'.repeat(64)).title, /call to search returned nothing/)
  assert.match(plainFeedback({ surface: 'agent', category: 'slow' }, 'a'.repeat(64)).title, /was slow/)
  const rendered = plainFeedback({ ...bare, error: 'private' }, 'a'.repeat(64)).description
  assert.equal(rendered.includes('with no details'), false)
  assert.equal(rendered.includes('private'), false)
  assert.match(rendered, /Free text was supplied and not stored/)
})

for (const [mode, expectedPlain] of [['EVERYONE', true], ['OFF', false]]) {
  test(`anonymous automatic reports use global flag mode ${mode}`, async () => {
    const previous = process.env.AI_FEEDBACK_AGENT_USER_ID
    process.env.AI_FEEDBACK_AGENT_USER_ID = '42'
    try {
      const f = setup({ mode })
      await f.fileAiFeedback(serverError)
      assert.equal(f.created[0].title.startsWith('AI feedback:'), !expectedPlain)
      assert.deepEqual(f.lookups, [{ flag: key, userId: undefined }])
    } finally {
      if (previous === undefined) delete process.env.AI_FEEDBACK_AGENT_USER_ID
      else process.env.AI_FEEDBACK_AGENT_USER_ID = previous
    }
  })
}

test('three rendered examples match the exact plain title and description', t => {
  const f = setup()
  const { feedbackFingerprint } = f.load('src/lib/aiFeedback/input.ts')
  const examples = [
    [unauthorized, 'An agent was refused when it signed in through MCP', 'This usually means the agent used a wrong or expired key, not a Hypertask bug.', "Tell the agent's owner to check its key and board permissions."],
    [bare, "An agent's CLI call failed with no details", "There are no details, so we can't tell whether this is a Hypertask bug.", 'Nothing for now; wait for a report with details.'],
    [serverError, "An agent's API call failed because Hypertask returned a server error", 'This is likely a Hypertask bug.', 'An engineer should look.'],
  ]
  const escape = f.load('src/utils/htmlEscape.ts').escapeHtml
  for (const [input, happened, reading, action] of examples) {
    const fingerprint = feedbackFingerprint(input)
    const rendered = f.plainFeedback(input, fingerprint)
    assert.deepEqual(rendered, {
      title: `${happened} (21 Oct)`,
      description: `<p><strong>What happened</strong>: ${escape(happened)}.</p>` +
        '<p><strong>Who hit it</strong>: unknown agent.</p>' +
        `<p><strong>Is it a real bug?</strong> ${escape(reading)}</p>` +
        `<p><strong>What to do</strong>: ${escape(action)}</p><h2>Details for engineers</h2>` + legacyDescription(input, fingerprint, ''),
    })
    const text = rendered.description.replace(/<\/(?:p|h2)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&#39;/g, "'")
    t.diagnostic(`${rendered.title}\n${text}`)
  }
})
