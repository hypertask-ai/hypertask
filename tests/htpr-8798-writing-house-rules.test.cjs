const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting, AgentWritingError, AGENT_WRITING_RULES } = load('src/lib/agents/writing.ts', {})

const shaped = `<p><strong>What this is:</strong> a flag that keeps a running chat.</p>
<p>It changes what every customer sees.</p>
<p><strong>Question:</strong> Turn the chat flag on for everyone?</p>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> live QA passed.</p>
<p><strong>Yes:</strong> everyone gets it.</p>
<p><strong>No:</strong> it stays with me and QA.</p>`

const withRisk = `<h2>Problem</h2><p>Search omits reminders.</p><h2>Fix</h2><p>Search reads reminders.</p><h2>Done when</h2><p>Search finds reminders.</p><h2>Risk</h2><p>Low. Undo: revert one change.</p><h2>Decision</h2><p>None.</p>`
const withoutRisk = withRisk.replace('<h2>Risk</h2><p>Low. Undo: revert one change.</p>', '')

const modelTickets = {
  'HTPR-7852': {
    title: 'Our own team uses its saved plan, not a forced Pro',
    description: `<p><strong>Now:</strong> Released behind a flag at Owner + QA. Payment and trial rules are unchanged.</p>
<p><strong>Problem:</strong> our own team is forced onto the Pro plan.</p>
<ul>
<li><p>Its AI always runs through the paid gateway.</p></li>
<li><p>Even when the team has its own key.</p></li>
</ul>
<p><strong>Fix:</strong> remove the forced Pro.</p>
<ul>
<li><p>Our team then uses its saved plan, like every team.</p></li>
<li><p>Its saved plan is already Pro. Nothing changes today.</p></li>
<li><p>Later, per-client AI settings decide: <a href="https://app.hypertask.ai/detail/project-15/7795">https://app.hypertask.ai/detail/project-15/7795</a></p></li>
</ul>
<p><strong>Done when:</strong></p>
<ul>
<li><p>The forced rule is gone.</p></li>
<li><p>A check proves our team reads its plan like others.</p></li>
<li><p>After release, our team still gets AI replies.</p></li>
</ul>
<p><strong>Risk:</strong> a wrong saved plan would cut our team&#x27;s AI. The runner checked: it is Pro. Undo: revert one change.</p>
<p><strong>Decision:</strong> see the marked Question below.</p>`,
  },
  'HTPR-7846': {
    title: 'Agents skip the AI when nothing changed',
    description: `<p><strong>Problem:</strong> agents might pay for AI with nothing new to do.</p>
<ul>
<li><p>Each agent checks its work every 15 minutes.</p></li>
<li><p>A check should not call the AI when nothing changed.</p></li>
</ul>
<p><strong>Fix:</strong> skip the AI call when nothing changed.</p>
<p><strong>Done when:</strong></p>
<ul>
<li><p>A quiet check makes no AI call.</p></li>
<li><p>New work still gets exactly one AI call.</p></li>
<li><p>AI use before and after is compared.</p></li>
</ul>
<p><strong>Result:</strong> done and live.</p>
<ul>
<li><p>Quiet checks already skipped the AI. Nothing was wasted.</p></li>
<li><p>A guard now stops repeat calls too.</p></li>
<li><p>Nothing changes on screen.</p></li>
<li><p>The savings can&#x27;t be measured alone. Background and chat use share one counter.</p></li>
</ul>`,
  },
}

const board15 = [
  {
    source: 'HTPR-8555',
    rule: 'dashed-code-name',
    fields: { title: 'Remove feature flag htpr-7273-column-events' },
  },
  {
    source: 'HTPR-7727',
    rule: 'plain-valentin-quote',
    fields: { text: '<p>Valentin, 2026-10-24: &quot;no a yes MUST count as well!!! change that that makes no sense to force a thumbs up&quot;.</p>' },
  },
  {
    source: 'HTPR-7852 comment 328438',
    rule: 'question-shape',
    fields: { text: `<p>Question: <strong>Remove the forced Pro rule for our own team?</strong></p>
<p>Yes: the runner removes it. Our team keeps Pro from its saved plan.</p>
<p>No: nothing changes. The forced rule stays.</p>
<p>My recommendation: Yes.</p>
<p>Why: the saved plan is already Pro, so we lose nothing. It clears the way for per-client AI settings.</p>` },
  },
  {
    source: 'HTPR-7852 comment 329124',
    rule: 'question-shape',
    fields: { text: `<p>Question: <strong>Remove the hidden rule and keep comped Pro?</strong>
My recommendation: Yes.
Why: nothing changes for you, and it unblocks per-client AI settings.
Yes: the hidden rule goes. You stay on comped Pro.
No: both stay. Nothing changes.</p>` },
  },
  {
    source: 'HTPR-8705',
    rule: 'ticket-parts',
    create: true,
    fields: { description: `<p><strong>Why.</strong> Repo style guide is stale. Runners obey it. AI review obeys it. Review now fails correct 4px work.</p>
<p><strong>Done when.</strong></p>
<ul><li><p>One small PR. Rollback is one revert.</p></li></ul>` },
  },
]

function refusal(fields, context) {
  try {
    assertAgentWriting('agent', fields, {}, { houseRules: true, ...context })
  } catch (error) {
    return error
  }
  throw new Error('the text was accepted')
}

test('one rule list feeds every writing refusal', () => {
  assert.deepEqual(AGENT_WRITING_RULES.map((rule) => rule.id), [
    'robot-status', 'technical-detail', 'dashed-code-name', 'plain-valentin-quote', 'sentence-length', 'question-shape', 'ticket-parts',
  ])
  for (const rule of AGENT_WRITING_RULES) assert.ok(rule.fix.trim())
})

for (const example of board15) {
  test(`board 15 ${example.source} is refused by ${example.rule}`, () => {
    const error = refusal(example.fields, example.create ? { create: true } : {})
    assert.ok(error instanceof AgentWritingError)
    assert.equal(error.rule, example.rule)
    const rule = AGENT_WRITING_RULES.find((item) => item.id === example.rule)
    assert.match(error.message, new RegExp(rule.name))
    assert.match(error.message, new RegExp(rule.fix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
}

test('a quote block of Valentin still passes', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent', {
    text: '<p>Valentin, 2026-10-24:</p><blockquote><p>no a yes MUST count as well!!! change that that makes no sense to force a thumbs up</p></blockquote>',
  }, {}, { houseRules: true }))
})

test('a Question in the house shape still passes', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent', { text: shaped }, {}, { houseRules: true }))
})

test('a Question split by line breaks still passes', () => {
  const text = shaped
    .replace('</p>\n<p><strong>My recommendation:</strong>', '<br><strong>My recommendation:</strong>')
    .replace('</p>\n<p><strong>Why:</strong>', '<br><strong>Why:</strong>')
    .replace('</p>\n<p><strong>Yes:</strong>', '<br><strong>Yes:</strong>')
    .replace('</p>\n<p><strong>No:</strong>', '<br><strong>No:</strong>')
  assert.doesNotThrow(() => assertAgentWriting('agent', { text }, {}, { houseRules: true }))
})

test('a ticket heading with a non-breaking space still passes', () => {
  const description = withRisk.replace('<h2>Done when</h2>', '<p><strong>Done&nbsp;when:</strong></p>')
  assert.doesNotThrow(() => assertAgentWriting('agent', { description }, {}, { create: true, houseRules: true }))
})

test('a Question with four context points is refused', () => {
  const error = refusal({
    text: shaped.replace('<p><strong>Question:</strong>', '<ul><li><p>One.</p></li><li><p>Two.</p></li><li><p>Three.</p></li><li><p>Four.</p></li></ul><p><strong>Question:</strong>'),
  })
  assert.equal(error.rule, 'question-shape')
  assert.match(error.message, /three points/)
})

for (const [ticket, body] of Object.entries(modelTickets)) {
  test(`model ticket ${ticket} still passes`, () => {
    assert.doesNotThrow(() => assertAgentWriting('agent', body, {}, { houseRules: true }))
  })
}

test('model ticket HTPR-7852 still passes on create', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent', modelTickets['HTPR-7852'], {}, { create: true, houseRules: true }))
})

function taskRoutes() {
  const ctx = { user: { id: 6 }, agentId: 'agent', teamScope: null }
  const calls = { writes: 0 }
  const auth = { validateMcpAuth: async () => ctx, checkMcpRateLimit: async () => null }
  const stubs = {
    'next/server': { NextResponse: Response },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (fn) => fn, validateMcpRouteAuth: auth.validateMcpAuth, checkMcpRouteRateLimit: auth.checkMcpRateLimit, readMcpRouteJsonBody: async (request) => ({ ok: true, body: await request.json() }) },
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
    '@/lib/mcp/tasks/services': {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: 'QA', teamId: null } }),
      getSectionForTask: async () => ({ section: { id: 1, section_title: 'Todo' } }),
      validateParentTask: async () => ({}),
      createTask: async (data) => { calls.writes++; return { id: 42, ...data } },
    },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
    '@/lib/mcp/tasks/mappers': { mapTaskToDetail: (task) => task },
    '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, write) => write(), IdempotencyAccessError: class extends Error {}, IdempotencyInProgressError: class extends Error {} },
    '@/lib/prisma': { default: { task: { findMany: async () => [] }, user: { findUnique: async () => ({ id: 6, email: 'qa@example.com' }) }, label: { findMany: async () => [] } } },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'yper4-910-agent-writing' || key === 'htpr-8798-writing-house-rules' },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (text) => text },
    '@/lib/planLimits': { isPlanLimitReachedError: () => false, planLimitResponse: () => null },
    '@/lib/mcp/operationContext': { getMcpOperationContext: async () => ({}) },
    '@/lib/mcp/tasks/validators': { validateCreateTaskBody: (body) => ({ valid: true, data: body }) },
    '@/lib/mcp/tasks/types': {},
    '@/lib/mcp/fieldError': { buildFieldError: (code, field, message) => ({ code, field, message }) },
    '@/lib/flags/definitions/htpr-7121-mcp-not-found-detail': { HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG: 'htpr-7121' },
    '@/lib/flags/definitions/htpr-8471-board-refusal-next-step': { HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG: 'htpr-8471' },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => { throw error } },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: async (_db, _actor, execute) => execute() },
    '@/lib/pullRequests/taskPullRequests': {},
    '@/lib/auth/session': { SESSION_COOKIE: 'session', signSession: () => 'test-session' },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (user) => user },
  }
  const create = load('src/lib/mcp/operations/tasks/create/operation.ts', stubs).POST
  const request = (body) => new Request('https://app.hypertask.ai/api/mcp/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { calls, create: (body) => create(request({ project_id: 15, title: 'Short title', ...body })) }
}

test('a ticket without Risk is refused on create', async () => {
  const h = taskRoutes()
  const response = await h.create({ description: withoutRisk, dry_run: true })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.field, 'description')
  assert.match(body.error, /Rule Ticket parts: Risk is missing/)
  assert.match(body.error, /what can go wrong and how to undo/)
  assert.equal(h.calls.writes, 0)
  assert.equal((await h.create({ description: withRisk, dry_run: true })).status, 200)
})

test('the agent task boundary refuses oversized text before writes and still accepts normal tickets', async () => {
  const h = taskRoutes()
  const response = await h.create({ description: '<blockquote '.repeat(90_000), dry_run: true })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.field, 'description')
  assert.match(body.error, /100000 characters/)
  assert.equal(h.calls.writes, 0)
  assert.equal((await h.create({ description: withRisk, dry_run: true })).status, 200)
  assert.equal(h.calls.writes, 0)
})
