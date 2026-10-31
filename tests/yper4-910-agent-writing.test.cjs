const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { setup } = require('./helpers/comment-routing.cjs')
const { assertAgentWriting, AgentWritingError } = load('src/lib/agents/writing.ts', {})
const long = 'This deliberately long sentence contains far too many words for a brief update that people can scan easily.'

for (const text of [long, 'Next: Wait for checks.', 'Helpers: none', 'Open src/lib/example.ts.', 'Read createTask().', 'Use agent_id here.', 'Commit abc123def is ready.', 'Read `output` first.']) {
  test(`people text refuses ${JSON.stringify(text)}`, () => {
    assert.throws(() => assertAgentWriting('agent', { text }), (error) => error instanceof AgentWritingError && error.field === 'text' && error.status === 400)
    assert.doesNotThrow(() => assertAgentWriting(null, { text }))
  })
}

for (const text of [
  'One two three four five six seven eight nine ten eleven twelve.',
  '<p>Saved views stay unchanged.</p><p>Nothing to decide.</p>',
  '<a href="https://example.com/src/file.ts">Full proof</a>',
  'Valentin said: “This original quote stays unchanged even though it contains more than twelve separate words.”',
  'Änderungen bleiben gespeichert.',
]) {
  test(`short text, links and original quotes remain allowed: ${text}`, () => {
    assert.doesNotThrow(() => assertAgentWriting('agent', { description: text }))
  })
}

test('HTML block boundaries remain separate while every block is checked', async () => {
  const short = 'One two three four five six seven eight nine ten'
  for (const html of [
    `<p>${short}</p><p>${short}</p>`,
    `<h2>${short}</h2><ul><li>${short}</li><li>${short}</li></ul>`,
    `<div>${short}</div><div>${short}</div>`,
    `${short}<br>${short}`,
  ]) {
    const h = setup()
    const response = await h.post({ text: html, kind: 'qa' })
    assert.equal(response.status, 201)
    assert.equal(h.calls.comments.length, 1)
    const invalid = await h.post({ text: `${html}<p>${long}</p>`, kind: 'qa' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.field, 'text')
    assert.equal(h.calls.comments.length, 1)
  }
})

test('edits keep old lines but validate every newly added line', () => {
  const previous = { description: `<p>${long}</p><p>Next: old status.</p>` }
  assert.doesNotThrow(() => assertAgentWriting('agent', { description: `${previous.description}<p>Now saved.</p>` }, previous))
  assert.throws(() => assertAgentWriting('agent', { description: `${previous.description}<p>Helpers: none</p>` }, previous), /Robot status/)
  assert.throws(() => assertAgentWriting('agent', { description: '<p>This deliberately changed long sentence contains far too many words for anyone to scan in one quick glance.</p>' }, previous), /twelve/)
})

for (const kind of ['question', 'qa', 'done']) {
  test(`real comment POST refuses verbose ${kind} before persistence, including dry run`, async () => {
    for (const dry_run of [false, true]) {
      const h = setup()
      const response = await h.post({ text: `<p>${long}</p>`, kind, dry_run })
      assert.equal(response.status, 400)
      assert.equal(response.body.field, 'text')
      assert.equal(response.body.code, 'invalid_field')
      assert.equal(h.calls.comments.length + h.calls.activities.length, 0)
      assert.equal(h.calls.broadcasts.length, 0)
    }
    const h = setup()
    assert.equal((await h.post({ text: 'Saved views stay unchanged.', kind })).status, 201)
    assert.equal(h.calls.comments.length, 1)
  })
}

test('real comment POST leaves human text unrestricted', async () => {
  const h = setup({ human: true })
  const response = await h.post({ text: `<p>${long}</p><p>Next: user text.</p>` })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(h.calls.comments.length, 1)
})

for (const body of [{}, { reply_to_comment_id: 12 }, { reply_to_invocation_id: 12 }, { mentions: [{ user_id: 6, display_name: 'Owner' }] }]) {
  test(`untyped notes remain hidden despite old exceptions: ${JSON.stringify(body)}`, async () => {
    const h = setup({ flag: false })
    const response = await h.post({ ...body, text: `<p>Next: ${long}</p>` })
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'log')
    assert.equal(response.body.visibleToPeople, false)
    assert.equal(h.calls.comments.length + h.calls.broadcasts.length, 0)
    assert.equal(h.calls.activities.length, 1)
  })
}

for (const options of [{ runtime: false }, { noRun: true }, { noActivity: true }]) {
  test(`unavailable agent log never leaks a note to people: ${JSON.stringify(options)}`, async () => {
    const h = setup(options)
    const response = await h.post({ text: 'Next: release checks.' })
    assert.equal(response.status, 503)
    assert.equal(response.body.success, false)
    assert.equal(h.calls.comments.length + h.calls.broadcasts.length, 0)
  })
}

for (const body of [{ has_attachments: true }, { images: ['https://example.com/image.png'] }]) {
  test(`untyped files require an explicit people kind before writes: ${JSON.stringify(body)}`, async () => {
    const h = setup()
    const response = await h.post(body)
    assert.equal(response.status, 400)
    assert.equal(response.body.field, 'kind')
    assert.equal(h.calls.comments.length + h.calls.activities.length + h.calls.runs.length, 0)
    assert.equal((await h.post({ ...body, kind: 'qa', text: 'Proof attached.' })).status, 201)
  })
}

function taskRoutes({ human = false, previous = {} } = {}) {
  const ctx = { user: { id: 6 }, agentId: human ? null : 'agent', teamScope: null }
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
    '@/lib/prisma': { default: { task: { findMany: async () => [{ title: 'Original', description: '', ...previous }] }, user: { findUnique: async () => ({ id: 6, email: 'qa@example.com' }) } } },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'yper4-910-agent-writing' },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (request, error) => { throw error } },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: async (_db, _actor, execute) => execute() },
    '@/lib/pullRequests/taskPullRequests': {},
    './fields/findTasks': { findTasksByIdentifier: async () => [{ id: 42, status: 'Normal' }] },
    './fields/persist': { persistTaskUpdates: async () => { calls.writes++; return { success: true, tasks: [{ id: 42 }] } } },
    '@/lib/auth/session': { SESSION_COOKIE: 'session', signSession: () => 'test-session' },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (user) => user },
  }
  const create = load('src/lib/mcp/operations/tasks/create/operation.ts', stubs).POST
  const update = load('src/lib/mcp/operations/tasks/update/operation.ts', stubs).POST
  const request = (body) => new Request('https://app.hypertask.ai/api/mcp/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { calls, create: (body) => create(request({ project_id: 15, title: 'Short title', ...body })), update: (body) => update(request({ task_id: 42, ...body })) }
}

for (const field of ['title', 'description']) {
  test(`real task create and update routes refuse verbose ${field}, including dry runs`, async () => {
    for (const action of ['create', 'update']) {
      for (const dry_run of [false, true]) {
        const h = taskRoutes()
        const response = await h[action]({ [field]: long, dry_run })
        assert.equal(response.status, 400, await response.clone().text())
        assert.equal((await response.json()).field, field)
        assert.equal(h.calls.writes, 0)
      }
      const h = taskRoutes({ human: true })
      assert.equal((await h[action]({ [field]: long, dry_run: true })).status, 200)
      assert.equal(h.calls.writes, 0)
    }
  })
}

test('task update permits preserved legacy lines and short agent changes', async () => {
  const h = taskRoutes({ previous: { description_: { content: `<p>${long}</p>` } } })
  assert.equal((await h.update({ description: `<p>${long}</p><p>Now saved.</p>`, dry_run: true })).status, 200)
  assert.equal((await h.create({ title: 'Saved views stay put.', dry_run: true })).status, 200)
  assert.equal(h.calls.writes, 0)
})


test('failed logging releases the idempotency claim so the same request can recover', async () => {
  const options = { noActivity: true }
  const h = setup(options)
  assert.equal((await h.post({ text: 'Next: release checks.' }, 'recoverable-note')).status, 503)
  options.noActivity = false
  const recovered = await h.post({ text: 'Next: release checks.' }, 'recoverable-note')
  assert.equal(recovered.status, 201)
  assert.equal(recovered.body.routedTo, 'log')
  assert.equal(h.calls.comments.length, 0)
  assert.equal(h.calls.activities.length, 2)
})


test('untyped embedded images require a people kind instead of losing their source', async () => {
  const h = setup({ formattedText: '<p>Evidence</p><img src="https://example.com/proof.png">' })
  const response = await h.post()
  assert.equal(response.status, 400)
  assert.equal(response.body.field, 'kind')
  assert.equal(h.calls.comments.length + h.calls.activities.length, 0)
})

test('legacy comment edit passes the authenticated agent identity to the shared writer', async () => {
  for (const human of [false, true]) {
    let passed
    const writing = load('src/lib/agents/writing.ts', {})
    const route = load('src/pages/api/comments/updateComment.ts', {
      '@/lib/agents/writing': writing,
      '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6, agentId: human ? null : 'agent', teamScope: null }) },
      '@/lib/storage/linkTaskAttachment': { TaskAttachmentLinkError: class extends Error {} },
      '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
      '@/utils/controllers/comments/updateCommentService': { updateCommentService: async (params) => {
        passed = params
        writing.assertAgentWriting(params.agentId, { text: params.text })
        return { id: 42, taskId: 99, text: params.text }
      } },
      '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    }).default
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(body) { this.body = body; return this } }
    await route({ method: 'PUT', headers: {}, body: { commentId: 42, taskId: 99, creatorId: 6, text: long } }, response)
    assert.equal(passed.agentId, human ? null : 'agent')
    assert.equal(response.statusCode, human ? 200 : 400)
  }
})


test('legacy comment creation refuses invalid agent kinds without publishing', async () => {
  for (const [human, kind, expected] of [[false, 'progress', 400], [false, 'qa', 200], [true, 'progress', 200]]) {
    let writes = 0
    const route = load('src/pages/api/comments/create.ts', {
      '@/lib/auth/agentScope': { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} },
      '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
      '@/lib/prisma': { default: { user: { findUnique: async () => ({ id: 6 }) } } },
      '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
      '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { writes++; return { id: 42 } } },
      '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    }).default
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(body) { this.body = body; return this } }
    await route({ method: 'POST', headers: {}, body: { text: 'Proof attached.', creatorId: 6, ownerId: 6, taskId: 99, agentId: human ? null : 'agent', kind } }, response)
    assert.equal(response.statusCode, expected)
    assert.equal(writes, expected === 200 ? 1 : 0)
    if (expected === 400) assert.equal(response.body.field, 'kind')
  }
})


test('description persistence keeps pre-write legacy lines but rejects newly invalid text', async () => {
  const legacy = `<p>${long}</p>`
  for (const existing of [null, { content: legacy }]) {
    for (const human of [false, true]) {
      let writes = 0
      const tx = {
        $executeRaw: async () => {},
        description: {
          findUnique: async () => existing,
          upsert: async ({ update }) => { writes++; return update },
        },
        docVersion: { count: async () => 0, create: async () => {} },
      }
      const upsert = load('src/utils/controllers/description/common-description-create.ts', {
        '@/lib/prisma': { default: {} },
        '@/lib/mcp/tasks/agentMutationFence': { assertAgentAssignmentChangeAllowed: async () => {} },
      }).default
      const params = { taskId: 42, creatorId: 6, actingUserId: 6, agentId: human ? null : 'agent', previousContent: legacy }
      const content = `${legacy}<p>Now saved.</p>`
      assert.equal((await upsert({ ...params, content }, tx)).content, content)
      assert.equal(writes, 1)
      const invalid = `${content}<p>Next: hidden status.</p>`
      if (human) {
        assert.equal((await upsert({ ...params, content: invalid }, tx)).content, invalid)
        assert.equal(writes, 2)
      } else {
        await assert.rejects(upsert({ ...params, content: invalid }, tx), /Robot status/)
        assert.equal(writes, 1)
      }
    }
  }
})
