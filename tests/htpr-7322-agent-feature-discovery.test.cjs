const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { NextRequest, NextResponse } = require('next/server')
const { load } = require('./task-route-loader.cjs')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const { DECISIONS_GUIDANCE } = load('src/lib/mcp/decisionsGuidance.ts', {})
const decisionsKey = 'htpr-7092-decisions'
const searchKey = 'htpr-6688-search-autocomplete'
const definitionKeys = [decisionsKey, 'htpr-7064-inbox-remind-returns', 'htpr-6422-my-tasks-views', 'htpr-6457-my-tasks-scopes', 'htpr-6461-my-tasks-snooze', searchKey]
const definitions = definitionKeys.map((key) => load(`src/lib/flags/definitions/${key}.ts`, {}).default)
const reader = { user: { id: 47, email: 'reader@example.test' }, agentId: 'read-agent' }

function catalog(availability = {}, registryDefinitions = definitions) {
  const users = []
  const mod = load('src/lib/mcp/featureCatalog.ts', {
    '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [
      ...registryDefinitions,
      { key: 'htpr-999-improvement', kind: 'improvement', description: 'An improvement', shippedOn: '2026-10-10' },
      { key: 'htpr-998-unmapped-product', kind: 'feature', description: 'No verified destination', shippedOn: '2026-10-11' },
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

test('catalog includes every enabled feature kind without requiring a destination and excludes off and non-feature kinds', async () => {
  const mod = catalog({ [decisionsKey]: false, [searchKey]: true, 'htpr-7064-inbox-remind-returns': true, 'htpr-999-improvement': true, 'htpr-998-unmapped-product': true })
  const rows = await mod.getFeatureCatalog(reader.user.id)
  assert.deepEqual(rows.filter(({ key }) => !key.startsWith('core-')), [
    { key: searchKey, description: definitions.find(({ key }) => key === searchKey).description, shippedOn: definitions.find(({ key }) => key === searchKey).shippedOn, available: true, name: 'Search suggestions', url: 'https://app.hypertask.ai/search' },
    { key: 'htpr-998-unmapped-product', name: 'unmapped product', description: 'No verified destination', shippedOn: '2026-10-11', available: true },
  ])
  for (const key of [decisionsKey, 'htpr-7064-inbox-remind-returns', 'htpr-999-improvement', 'core-decisions']) {
    assert.equal(rows.some((row) => row.key === key), false)
  }
  assert.ok(rows.every(({ name }) => typeof name === 'string' && name.trim().length > 0))
  assert.deepEqual(mod.users, [47])
})

test('catalog projects live feature descriptions and shipped dates with optional verified destinations', async () => {
  const mod = catalog(Object.fromEntries(definitionKeys.map((key) => [key, true])))
  const rows = await mod.getFeatureCatalog(985)
  assert.ok(rows.every(({ name }) => typeof name === 'string' && name.trim().length > 0))
  assert.equal(rows.filter(({ name }) => name === 'Decisions').length, 1)
  assert.equal(rows.filter(({ url }) => url === 'https://app.hypertask.ai/inbox?split=Decisions').length, 1)
  assert.equal(rows.some(({ key }) => key === 'core-decisions'), false)
  const features = rows.filter(({ key }) => !key.startsWith('core-'))
  assert.equal(features.length, definitions.filter(({ kind }) => kind === 'feature').length)
  for (const row of features) {
    const definition = definitions.find(({ key }) => key === row.key)
    assert.equal(definition.kind, 'feature')
    assert.equal(row.description, definition.description)
    assert.equal(row.shippedOn, definition.shippedOn)
    assert.equal(row.available, true)
  }
  for (const row of rows.filter(({ url }) => url)) {
    const url = new URL(row.url)
    assert.equal(url.origin, 'https://app.hypertask.ai')
    assert.ok(new Set(['/inbox', '/inbox?split=Decisions', '/my-tasks', '/search', '/report']).has(url.pathname + url.search))
    assert.ok(fs.existsSync(path.join(root, 'src/app', url.pathname, 'page.tsx')))
  }
  assert.deepEqual(mod.users, [985])
})

test('core destinations survive removed definitions and Decisions remains gated on effective availability', async () => {
  const expected = [
    ['Inbox', 'https://app.hypertask.ai/inbox'],
    ['Decisions', 'https://app.hypertask.ai/inbox?split=Decisions'],
    ['My Tasks', 'https://app.hypertask.ai/my-tasks'],
    ['Search', 'https://app.hypertask.ai/search'],
    ['Reports', 'https://app.hypertask.ai/report'],
  ]
  const rows = await catalog({ [decisionsKey]: true }, []).getFeatureCatalog(47)
  assert.deepEqual(rows.map(({ name, url }) => [name, url]), expected)
  for (const row of rows) {
    assert.equal(row.available, true)
    assert.ok(row.name)
    assert.ok(row.description)
  }
  assert.deepEqual((await catalog({}).getFeatureCatalog(47)).map(({ name, url }) => [name, url]), expected.filter(([name]) => name !== 'Decisions'))
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
  const mod = catalog({ [decisionsKey]: true, 'htpr-998-unmapped-product': true })
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
  assert.deepEqual(concise.data.features, features)
  assert.match(read('src/lib/mcp-server/tools/index.ts'), /  listFeaturesTool,/)
  const context = JSON.parse(read('src/lib/mcp-server/config/descriptions/user_context.json'))
  assert.deepEqual(context.actions.features, { tool: 'hypertask_list_features', read_only: true, permission: 'data' })
})

test('MCP catalog formatting retains unmapped descriptions and dates without paging up to 300 entries', () => {
  const { formatToolResponse } = load('src/lib/mcp-server/tool-response.ts', {})
  const features = Array.from({ length: 300 }, (_, index) => ({ key: `feature-${index}`, description: `Feature ${index}`, shippedOn: '2026-10-11', available: true }))
  for (const format of ['concise', 'detailed']) {
    const result = JSON.parse(formatToolResponse(JSON.stringify({ features }), format, true, 20, 0, false))
    assert.deepEqual(result.data.features, features)
    assert.equal(result.pagination.has_more, false)
  }
  const large = JSON.parse(formatToolResponse(JSON.stringify({ features: [...features, features[0]] }), 'concise', true, 20, 0, false))
  assert.deepEqual(large.data.features, features.slice(0, 20))
  assert.equal(large.pagination.has_more, true)
  const tasks = Array.from({ length: 21 }, (_, id) => ({ id }))
  const other = JSON.parse(formatToolResponse(JSON.stringify({ tasks }), 'concise', true, 20, 0, false))
  assert.deepEqual(other.data.tasks, tasks.slice(0, 20))
  assert.equal(other.pagination.has_more, true)
})

test('Decisions guidance stays lightweight and hello does not eagerly load the feature catalog', () => {
  assert.doesNotMatch(read('src/lib/mcp/decisionsGuidance.ts'), /\b(?:import|require)\b/)
  assert.doesNotMatch(read('src/lib/mcp/hello/getHelloPayload.ts'), /from ['"]@\/lib\/mcp\/featureCatalog['"]/)
})

test('hello and tool guidance explain the actual Decisions workflow, not structured records', async () => {
  const hello = load('src/lib/mcp/hello/getHelloPayload.ts', {
    '@/lib/prisma': { default: { project: { findMany: async () => [] } } },
    '@/lib/mcp/auth': {},
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { getProjectListingWhere: () => ({}) },
  })
  const { capabilities } = await hello.getHelloPayload(reader)
  assert.equal(capabilities.decisions, DECISIONS_GUIDANCE)
  assert.equal(hello.HTPR_7122_HELLO_CAPABILITIES.decisions, DECISIONS_GUIDANCE)
  const descriptionMocks = Object.fromEntries(
    fs.readdirSync(path.join(root, 'src/lib/mcp-server/config/descriptions'))
      .filter((file) => file.endsWith('.json'))
      .map((file) => [`./descriptions/${file}`, { default: JSON.parse(read(`src/lib/mcp-server/config/descriptions/${file}`)) }]),
  )
  const { CONSOLIDATED_TOOL_DESCRIPTIONS } = load('src/lib/mcp-server/config/consolidated-descriptions.ts', descriptionMocks)
  const descriptions = CONSOLIDATED_TOOL_DESCRIPTIONS.filter(({ name }) => ['hypertask_comments', 'hypertask_decisions'].includes(name))
  for (const text of [capabilities.decisions, ...descriptions.map((description) => Object.values(description).filter((value) => typeof value === 'string').join(' '))]) {
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
  for (const title of ['Inbox', '  dEcIsIoNs  ', 'Decision', 'Decision inbox', 'Valentin decisions dashboard', 'Team inbox overview', 'My   Tasks', 'My Tasks page', 'Team my tasks page', 'Search', 'Search page', 'New search page', 'Dashboard', 'Team dashboard', 'Dashboard for engineering', 'Reports', 'Weekly reports', 'Reports for the team', 'Reports page']) {
    const route = pageEndpoint('write-agent')
    const response = await route.post(title, 'repeat-key')
    assert.equal(response.status, 200)
    const receipt = await response.json()
    assert.equal(receipt.warnings[0].code, 'existing_feature')
    if (/decision/i.test(title)) {
      assert.ok(receipt.warnings[0].message.endsWith(DECISIONS_GUIDANCE))
      assert.equal(receipt.warnings[0].url, 'https://app.hypertask.ai/inbox?split=Decisions')
    } else {
      assert.equal(receipt.warnings[0].message.includes(DECISIONS_GUIDANCE), false)
      assert.doesNotMatch(receipt.warnings[0].message, /Question:|@mention|split=Decisions/)
    }
    assert.deepEqual(receipt.page, { publicId: 'fixture-page', id: 3, title, version: 1, url: 'https://app.hypertask.ai/page/fixture-page' })
    assert.deepEqual(await (await route.post(title, 'repeat-key')).json(), receipt)
    assert.equal(route.creates(), 1)
  }
})

test('human callers and unrelated titles or partial words have no warnings', async () => {
  const human = pageEndpoint(null, { getFeaturePageWarnings: () => { throw new Error('Human must not call warning lookup') } })
  for (const title of ['Decisions', 'Decision inbox', 'Valentin decisions dashboard']) {
    assert.deepEqual(Object.keys(await (await human.post(title)).json()), ['page'])
  }
  for (const title of ['Sprint 12 notes', 'Dashboard design notes', 'Team dashboard overview', 'Reports design notes', 'Weekly my tasks overview', 'My Tasks planning notes', 'My Tasks page notes', 'Search design notes', 'Search page notes', 'QA report', 'Release notes', 'Decisionmaking notes', 'inboxes', 'dashboards', 'my tasksmith', 'search pages', 'Search research', '', 'report']) {
    const route = pageEndpoint('write-agent')
    assert.deepEqual(Object.keys(await (await route.post(title)).json()), ['page'])
    assert.equal(route.creates(), 1)
  }
})

test('unavailable Decisions falls back to the Inbox warning without Decisions guidance', async () => {
  const route = pageEndpoint('write-agent', catalog({}))
  const response = await route.post('Decision inbox')
  assert.equal(response.status, 200)
  const receipt = await response.json()
  assert.equal(receipt.warnings[0].url, 'https://app.hypertask.ai/inbox')
  assert.doesNotMatch(receipt.warnings[0].message, /Question:|@mention|split=Decisions/)
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
