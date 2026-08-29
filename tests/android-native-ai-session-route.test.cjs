const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const {
  createAiSessionsCollectionHandlers,
  createAiSessionItemHandlers,
} = jiti(path.join(root, 'src/lib/mcp/ai/sessionHandler.ts'))

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
let dependencyEntry = 0

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

function loadProductionDependencies(prisma) {
  const stubbedModules = [
    'src/app/api/mcp/ai/sessions/_dependencies.ts',
    'src/lib/prisma.ts',
    'src/lib/mcp/auth.ts',
    'src/lib/mcp/agents/scopes.ts',
    'src/lib/mcp/tasks/services.ts',
    'src/utils/controllers/projects/getAllIncludes.ts',
    'src/lib/storage/uploadTaskAttachmentToS3.ts',
  ]
  const originalCache = new Map(Object.entries(require.cache))
  stubbedModules.forEach((relativePath) => delete require.cache[path.join(root, relativePath)])
  stubModule('src/lib/prisma.ts', { default: prisma })
  stubModule('src/lib/mcp/auth.ts', {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => null,
  })
  stubModule('src/lib/mcp/agents/scopes.ts', { requireRole: async () => null })
  stubModule('src/lib/mcp/tasks/services.ts', {
    validateProjectAccess: async () => ({ error: null }),
  })
  stubModule('src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: () => ({}) })
  stubModule('src/lib/storage/uploadTaskAttachmentToS3.ts', {
    deleteTaskAttachmentFromS3: async () => {},
  })

  const restore = () => {
    for (const filename of Object.keys(require.cache)) {
      if (!originalCache.has(filename)) delete require.cache[filename]
    }
    for (const [filename, cachedModule] of originalCache) require.cache[filename] = cachedModule
  }

  try {
    const loadDependencies = require('jiti')(
      path.join(root, `tests/android-ai-session-dependencies-${++dependencyEntry}.cjs`),
      { interopDefault: true, alias: { '@': path.join(root, 'src') }, cache: false },
    )
    const loaded = loadDependencies(path.join(root, 'src/app/api/mcp/ai/sessions/_dependencies.ts'))
    return { dependencies: loaded.aiSessionDependencies, restore }
  } catch (error) {
    restore()
    throw error
  }
}

function collectionRequest(method = 'GET', body, search = '') {
  return new NextRequest(`https://example.test/api/mcp/ai/sessions${search}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

function itemRequest(method, body) {
  return new NextRequest(`https://example.test/api/mcp/ai/sessions/${SESSION_ID}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

function fixture(overrides = {}) {
  const calls = { list: [], messages: [], create: [], rename: [], remove: [], project: [] }
  const context = { user: { id: 6 }, agentId: null }
  const session = { id: SESSION_ID, title: 'Synced chat', messages: [] }
  const dependencies = {
    checkRateLimit: async () => null,
    validateAuth: async () => context,
    authorizeRead: async () => null,
    authorizeWrite: async () => null,
    actorUserId: (ctx) => ctx.user.id,
    actorAgentId: (ctx) => ctx.agentId,
    validateProject: async (...args) => { calls.project.push(args); return null },
    list: async (...args) => { calls.list.push(args); return { sessions: [session], total: 1 } },
    messages: async (...args) => { calls.messages.push(args); return { session, total: 0 } },
    create: async (input) => { calls.create.push(input); return session },
    rename: async (...args) => { calls.rename.push(args); return { ...session, title: args[2] } },
    remove: async (...args) => { calls.remove.push(args) },
    ...overrides,
  }
  return {
    collection: createAiSessionsCollectionHandlers(dependencies),
    item: createAiSessionItemHandlers(dependencies),
    props: { params: Promise.resolve({ sessionId: SESSION_ID }) },
    calls,
  }
}

test('rejects unauthenticated history reads before querying sessions', async () => {
  const { collection, calls } = fixture({ validateAuth: async () => null })
  const response = await collection.GET(collectionRequest())
  assert.equal(response.status, 401)
  assert.deepEqual(calls.list, [])
})

test('enforces agent read scope before listing personal history', async () => {
  const denied = Response.json({ error: 'Insufficient role' }, { status: 403 })
  const { collection, calls } = fixture({ authorizeRead: async () => denied })
  assert.equal((await collection.GET(collectionRequest())).status, 403)
  assert.deepEqual(calls.list, [])
})

test('lists a bounded account-scoped session snapshot', async () => {
  const { collection, calls } = fixture()
  const response = await collection.GET(collectionRequest('GET', undefined, '?limit=25&offset=5'))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.total, 1)
  assert.equal(body.sessions[0].id, SESSION_ID)
  assert.deepEqual(calls.list, [[{ user: { id: 6 }, agentId: null }, 25, 5]])
  assert.equal((await collection.GET(collectionRequest('GET', undefined, '?limit=101'))).status, 400)
})

test('paginates one authorized session message history', async () => {
  const { collection, calls } = fixture()
  const response = await collection.GET(collectionRequest(
    'GET', undefined, `?session_id=${SESSION_ID}&limit=40&offset=80`,
  ))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.message_total, 0)
  assert.equal(body.message_limit, 40)
  assert.deepEqual(calls.messages, [[{ user: { id: 6 }, agentId: null }, SESSION_ID, 40, 80]])
  assert.deepEqual(calls.list, [])
})

test('reads session history without requiring a database transaction', async () => {
  const calls = { transactions: 0, sessionFindMany: [], sessionFindFirst: [], messageFindMany: [] }
  const session = {
    id: SESSION_ID,
    projectId: 15,
    taskId: 33349,
    title: 'Synced chat',
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
    updatedAt: new Date('2026-08-26T12:30:00.000Z'),
  }
  const message = {
    id: 'message-1',
    role: 'user',
    content: 'Show my history',
    createdAt: new Date('2026-08-26T12:15:00.000Z'),
    attachments: [],
  }
  const prisma = {
    $transaction: async () => {
      calls.transactions += 1
      const error = new Error('Unable to start a transaction in the given time')
      error.code = 'P2028'
      throw error
    },
    chatSession: {
      findMany: async (args) => { calls.sessionFindMany.push(args); return [session] },
      count: async () => 1,
      findFirst: async (args) => { calls.sessionFindFirst.push(args); return session },
    },
    chatMessage: {
      findMany: async (args) => { calls.messageFindMany.push(args); return [message] },
      count: async () => 1,
    },
  }
  const { dependencies, restore } = loadProductionDependencies(prisma)

  try {
    const context = { user: { id: 6 }, agentId: null }
    const listed = await dependencies.list(context, 25, 5)
    const history = await dependencies.messages(context, SESSION_ID, 40, 80)

    assert.equal(calls.transactions, 0)
    assert.deepEqual(listed, {
      sessions: [{
        id: SESSION_ID,
        project_id: 15,
        task_id: 33349,
        title: 'Synced chat',
        created_at: '2026-08-26T12:00:00.000Z',
        updated_at: '2026-08-26T12:30:00.000Z',
      }],
      total: 1,
    })
    assert.equal(history.total, 1)
    assert.equal(history.session.id, SESSION_ID)
    assert.equal(history.session.messages[0].content, 'Show my history')
    assert.deepEqual(calls.sessionFindMany[0].where, { userId: 6 })
    assert.deepEqual(calls.sessionFindFirst[0].where, { userId: 6, id: SESSION_ID })
    assert.equal(calls.messageFindMany[0].take, 40)
    assert.equal(calls.messageFindMany[0].skip, 80)
    assert.deepEqual(calls.messageFindMany[0].where, {
      sessionId: SESSION_ID,
      session: { userId: 6, id: SESSION_ID },
    })
  } finally {
    restore()
  }
})

test('creates a deterministic session only after validating board access', async () => {
  const { collection, calls } = fixture()
  const response = await collection.POST(collectionRequest('POST', {
    id: SESSION_ID,
    project_id: 2467,
    title: 'Offline draft',
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls.project, [[6, null, 2467]])
  assert.deepEqual(calls.create, [{
    context: { user: { id: 6 }, agentId: null },
    userId: 6,
    agentId: null,
    id: SESSION_ID,
    projectId: 2467,
    title: 'Offline draft',
  }])
})

test('does not expose a colliding session identifier from another account', async () => {
  const { collection } = fixture({ create: async () => null })
  const response = await collection.POST(collectionRequest('POST', { id: SESSION_ID }))
  assert.equal(response.status, 409)
})

test('rejects valid JSON values that are not request objects', async () => {
  const { collection, item, props } = fixture()
  assert.equal((await collection.POST(collectionRequest('POST', null))).status, 400)
  assert.equal((await item.PATCH(itemRequest('PATCH', []), props)).status, 400)
})

test('persists the caller agent identity for an unscoped managed-agent session', async () => {
  const agentContext = { user: { id: 6 }, agentId: 'agent-android' }
  const { collection, calls } = fixture({ validateAuth: async () => agentContext })
  const response = await collection.POST(collectionRequest('POST', { id: SESSION_ID }))

  assert.equal(response.status, 200)
  assert.deepEqual(calls.create, [{
    context: agentContext,
    userId: 6,
    agentId: 'agent-android',
    id: SESSION_ID,
    projectId: null,
    title: 'New AI Chat',
  }])
})

test('renames only the authenticated account session', async () => {
  const { item, props, calls } = fixture()
  const response = await item.PATCH(itemRequest('PATCH', { title: '  Release plan  ' }), props)
  assert.equal(response.status, 200)
  assert.deepEqual(calls.rename, [[{ user: { id: 6 }, agentId: null }, SESSION_ID, 'Release plan']])
})

test('delete is retry-safe and account-scoped', async () => {
  const { item, props, calls } = fixture()
  const response = await item.DELETE(itemRequest('DELETE'), props)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.deleted, true)
  assert.deepEqual(calls.remove, [[{ user: { id: 6 }, agentId: null }, SESSION_ID]])
})
