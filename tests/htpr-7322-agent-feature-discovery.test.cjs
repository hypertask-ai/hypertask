const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { NextRequest, NextResponse } = require('next/server')
const { load } = require('./task-route-loader.cjs')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const decisionsKey = 'htpr-7092-decisions'
const searchKey = 'htpr-6688-search-autocomplete'
const productKeys = [decisionsKey, 'htpr-7064-inbox-remind-returns', 'htpr-6422-my-tasks-views', 'htpr-6457-my-tasks-scopes', 'htpr-6461-my-tasks-snooze', searchKey]
const definitions = productKeys.map((key) => load(`src/lib/flags/definitions/${key}.ts`, {}).default)
const reader = { user: { id: 47, email: 'reader@example.test' }, agentId: 'read-agent' }

function catalog(availability = {}) {
  const users = []
  const mod = load('src/lib/mcp/featureCatalog.ts', {
    '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [
      ...definitions,
      { key: 'yper4-999-infra', kind: 'feature', description: 'Internal deployment switch' },
      { key: 'htpr-999-internal', kind: 'internal', description: 'Internal probe' },
      { key: 'htpr-998-unmapped-product', kind: 'feature', description: 'No verified destination' },
    ] },
    '@/lib/flags': { featureFlagsForUser: async (userId) => { users.push(userId); return availability } },
  })
  return { ...mod, users }
}

function endpoint(ctx, mod, limited = null) {
  let reads = 0
  const GET = load('src/lib/mcp/operations/features/operation.ts', {
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ctx,
      checkMcpRouteRateLimit: async () => limited,
    },
    '@/lib/mcp/auth': { createUnauthorizedResponse: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
    '@/lib/mcp/featureCatalog': { getFeatureCatalog: async (userId) => { reads++; return mod.getFeatureCatalog(userId) } },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
  }).GET
  return { GET, reads: () => reads }
}

const request = () => new NextRequest('https://app.hypertask.ai/api/mcp/features')

test('catalog hides unavailable, internal, infra and unverified destinations even when switches are enabled', async () => {
  const mod = catalog({ [decisionsKey]: false, [searchKey]: true, 'yper4-999-infra': true, 'htpr-999-internal': true, 'htpr-998-unmapped-product': true })
  const rows = await mod.getFeatureCatalog(reader.user.id)
  assert.deepEqual(rows, [{ key: searchKey, description: definitions.find(({ key }) => key === searchKey).description, available: true, name: 'Search suggestions', url: 'https://app.hypertask.ai/search' }])
  assert.deepEqual(mod.users, [47])
})

test('catalog projects live descriptions and effective caller availability with only verified URLs', async () => {
  const mod = catalog(Object.fromEntries(productKeys.map((key) => [key, true])))
  const rows = await mod.getFeatureCatalog(985)
  assert.equal(rows.length, definitions.length)
  const destinations = new Set(['/inbox', '/inbox?split=Decisions', '/my-tasks', '/search'])
  for (const row of rows) {
    const url = new URL(row.url)
    assert.equal(url.origin, 'https://app.hypertask.ai')
    assert.ok(destinations.has(url.pathname + url.search))
    assert.ok(fs.existsSync(path.join(root, 'src/app', url.pathname, 'page.tsx')))
    assert.equal(row.description, definitions.find(({ key }) => key === row.key).description)
    assert.equal(row.available, true)
  }
  assert.deepEqual(mod.users, [985])
  assert.deepEqual(await catalog({}).getFeatureCatalog(47), [])
})

test('unauthorized catalog reads are now refused without loading feature data', async () => {
  const route = endpoint(null, catalog({ [decisionsKey]: true }))
  assert.equal((await route.GET(request())).status, 401)
  assert.equal(route.reads(), 0)
})

test('a valid read-role agent is still allowed through the same catalog boundary', async () => {
  const mod = catalog({ [decisionsKey]: true })
  const route = endpoint(reader, mod)
  const response = await route.GET(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const body = await response.json()
  assert.equal(body.success, true)
  assert.deepEqual(body.features, await mod.getFeatureCatalog(47))
  assert.match(body.scope, /not a mentioned recipient/)
})

test('human and OAuth-style user contexts can read, and rate limiting stops catalog reads', async () => {
  const route = endpoint({ ...reader, agentId: null }, catalog({ [searchKey]: true }))
  assert.equal((await route.GET(request())).status, 200)
  const limited = endpoint(reader, catalog(), NextResponse.json({ error: 'Rate limited' }, { status: 429 }))
  assert.equal((await limited.GET(request())).status, 429)
  assert.equal(limited.reads(), 0)
})

test('HTTP route and in-process GET operation share the authenticated implementation', async () => {
  assert.match(read('src/app/api/mcp/features/route.ts'), /import \{ GET as executeGET \} from '@\/lib\/mcp\/operations\/features\/operation'/)
  const mod = catalog({ [decisionsKey]: true })
  const route = endpoint(reader, mod)
  const { executeMcpOperation } = load('src/lib/mcp/operations/index.ts', {
    './features/operation': route,
    '@/lib/mcp-server/utils/errors': { ApiError: class extends Error {} },
  })
  const response = await executeMcpOperation(new NextRequest('http://mcp.internal/mcp/features'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).features[0].key, decisionsKey)
})

test('MCP feature tool calls the shared operation and concise output retains descriptions', async () => {
  const mod = catalog({ [decisionsKey]: true })
  const features = await mod.getFeatureCatalog(47)
  let called
  const { listFeaturesTool } = load('src/lib/mcp-server/tools/list-features.tool.ts', {
    '../config/tool-metadata': { TOOL_METADATA: { LIST_FEATURES: { name: 'hypertask_list_features', description: 'Returns available features' } } },
    '../utils/executeWithService': {
      executeWithService: async (token, Service, method, args) => {
        assert.equal(token, 'fixture-bearer')
        return JSON.stringify(await method(new Service({ makeRequest: async (url, options) => { called = { url, options }; return { success: true, features } } }), args))
      },
    },
    '../../utils/logger': { logger: {} },
  })
  const text = await listFeaturesTool.execute({}, 'fixture-bearer')
  assert.deepEqual(called, { url: '/mcp/features', options: { method: 'GET' } })
  const { formatToolResponse } = load('src/lib/mcp-server/tool-response.ts', {})
  const concise = JSON.parse(formatToolResponse(text, 'concise', true, 20, 0, false))
  assert.equal(concise.data.features[0].description, features[0].description)
  assert.match(read('src/lib/mcp-server/tools/index.ts'), /  listFeaturesTool,/)
  const context = JSON.parse(read('src/lib/mcp-server/config/descriptions/user_context.json'))
  assert.deepEqual(context.actions.features, { tool: 'hypertask_list_features', read_only: true, permission: 'data' })
})

test('hello and tool guidance explain the actual Decisions workflow, not structured records', async () => {
  const mod = catalog()
  const hello = load('src/lib/mcp/hello/getHelloPayload.ts', {
    '@/lib/mcp/featureCatalog': mod,
    '@/lib/prisma': { default: { project: { findMany: async () => [] } } },
    '@/lib/mcp/auth': {},
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { getProjectListingWhere: () => ({}) },
  })
  const { capabilities } = await hello.getHelloPayload(reader)
  assert.equal(capabilities.decisions, mod.DECISIONS_GUIDANCE)
  assert.equal(hello.HTPR_7122_HELLO_CAPABILITIES.decisions, mod.DECISIONS_GUIDANCE)
  for (const text of [capabilities.decisions, ...['comments', 'decisions'].map((name) => Object.values(JSON.parse(read(`src/lib/mcp-server/config/descriptions/${name}.json`))).filter((value) => typeof value === 'string').join(' '))]) {
    assert.match(text, /Question:/)
    assert.match(text, /@mention/)
    assert.match(text, /https:\/\/app.hypertask.ai\/inbox\?split=Decisions/)
    assert.match(text, /enabled/)
    assert.match(text, /later non-agent comment/)
    assert.match(text, /[Ss]tructured/)
  }
  assert.match(capabilities.features, /GET \/api\/mcp\/features/)
})

test('Question lines qualify; ordinary mentions and questions answered later by the viewer do not', () => {
  const { pickDecisionTaskIds } = load('src/lib/inboxDecisions.ts', {})
  const comment = { taskId: 1, text: '<p>Question: ship it? @Reader</p>', commentText: null, createdAt: new Date(1000) }
  assert.deepEqual([...pickDecisionTaskIds([comment], [])], [1])
  assert.deepEqual([...pickDecisionTaskIds([{ ...comment, text: '<p>FYI @Reader</p>' }], [])], [])
  assert.deepEqual([...pickDecisionTaskIds([comment], [{ taskId: 1, createdAt: new Date(2000) }])], [])
})

function pageEndpoint(agentId, warningModule = catalog({ [decisionsKey]: true })) {
  let creates = 0
  let receipt
  const mocks = {
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (handler) => handler },
    '@/lib/mcp/auth': { validateMcpAuth: async () => ({ ...reader, agentId }), checkMcpRateLimit: async () => null },
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/featureCatalog': warningModule,
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/idempotency/idempotencyStore': {
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: (key) => key,
      withIdempotency: async (_operation, _userId, key, _body, create) => {
        if (key && receipt) return receipt
        receipt = await create()
        return receipt
      },
    },
    '@/lib/mcp/tasks/resolveTask': { validateTaskIdentifier: () => ({ valid: true }), findTaskByIdentifier: async () => ({ id: 1, projectId: 15 }), taskIdentifierErrorResponse: () => null },
    '@/lib/mcp/operations/pages/helpers': {
      canAccessProject: async () => true,
      getPageUrl: (publicId) => `https://app.hypertask.ai/page/${publicId}`,
      isRequestBody: (body) => body && typeof body === 'object',
      parsePositiveInteger: (value) => Number.isInteger(value) && value > 0 ? value : null,
    },
    '@/utils/controllers/pages/pageService': { createPage: async ({ title = '' }) => { creates++; return { publicId: 'fixture-page', id: 3, title, version: 1 } } },
  }
  const { POST } = load('src/lib/mcp/operations/pages/create/operation.ts', mocks)
  return {
    creates: () => creates,
    post: (title, key) => POST(new NextRequest('https://app.hypertask.ai/api/mcp/pages/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify({ task_id: 1, title, content: 'A legitimate page' }) })),
  }
}

test('agent feature-title warnings are nonblocking and idempotent receipts retain the page shape', async () => {
  for (const title of ['Inbox', '  dEcIsIoNs  ', 'My   Tasks', 'Search', 'Dashboard', 'Reports']) {
    const route = pageEndpoint('write-agent')
    const response = await route.post(title, 'repeat-key')
    assert.equal(response.status, 200)
    const receipt = await response.json()
    assert.equal(receipt.warnings[0].code, 'existing_feature')
    assert.deepEqual(receipt.page, { publicId: 'fixture-page', id: 3, title, version: 1, url: 'https://app.hypertask.ai/page/fixture-page' })
    assert.deepEqual(await (await route.post(title, 'repeat-key')).json(), receipt)
    assert.equal(route.creates(), 1)
  }
})

test('human callers and normal report, QA and feature-containing titles have no warnings', async () => {
  const human = pageEndpoint(null, { getFeaturePageWarnings: () => { throw new Error('Human must not call warning lookup') } })
  assert.deepEqual(Object.keys(await (await human.post('Decisions')).json()), ['page'])
  for (const title of ['QA report', 'Decisions research', 'Inbox migration report', 'Release notes', '', 'report']) {
    const route = pageEndpoint('write-agent')
    assert.deepEqual(Object.keys(await (await route.post(title)).json()), ['page'])
    assert.equal(route.creates(), 1)
  }
})

test('unavailable Decisions and failed advisory lookups never prevent agent page creation', async () => {
  for (const mod of [catalog({}), { getFeaturePageWarnings: async () => { throw new Error('Flag lookup unavailable') } }]) {
    const route = pageEndpoint('write-agent', mod)
    const response = await route.post('Decisions')
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(await response.json()), ['page'])
    assert.equal(route.creates(), 1)
  }
})
