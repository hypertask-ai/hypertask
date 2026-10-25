const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { NextRequest } = require('next/server')
const { z } = require('zod')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let plainMode = 'OFF', mode = 'OWNER_AND_QA', userId = 985, authorized = true, files = [], pending = [], clientNames = new Map(), quotaCount = 0, attemptCount = 0
let registeredTools = [], coreBlock, coreThrow = false, catalogEnabled = false, lockBlock, transactionError, onLockAttempt
const enabledFor = (id) => mode === 'EVERYONE' || mode === 'OWNER_AND_QA' && [6, 985].includes(id)
const auth = () => authorized ? { user: { id: userId, displayName: 'QA', email: 'private@example.test' }, agentId: 'board-agent' } : null
stub('src/lib/prisma.ts', { default: {
  $transaction: async (callback, options) => {
    assert.equal(options.timeout, 30000)
    assert.ok(options.maxWait > 0 && options.maxWait <= 30000)
    if (transactionError) throw transactionError
    return callback({
      $queryRaw: async (strings, key) => {
        assert.equal(strings.join('?'), 'SELECT pg_try_advisory_xact_lock(?) AS locked')
        assert.equal(typeof key, 'bigint')
        if (onLockAttempt) onLockAttempt()
        return [{ locked: !lockBlock }]
      },
      task: { findFirst: async () => null },
    })
  },
  project: { findFirst: async () => ({ ownerId: 6, uniqueIdentifier: 'HTPR', section: [{ id: 111, section_title: 'Bugs' }] }), findMany: async () => [] },
  user: { findUnique: async () => ({ displayName: 'QA' }) },
  section: { findMany: async () => [] },
  task: { findFirst: async () => null, findMany: async () => [] },
  label: { findFirst: async () => ({ id: 'ai-feedback' }) },
} })
stub('src/lib/flags.ts', {
  isFeatureEnabled: async (key, id) => key === 'htpr-7536-plain-ai-feedback' ? plainMode === 'EVERYONE' : key === 'htpr-6804-mcp-tools' ? catalogEnabled : key === 'htpr-7195-ai-feedback' && enabledFor(id),
  featureFlagCandidateUserIds: async (key) => {
    const selected = key === 'htpr-7536-plain-ai-feedback' ? plainMode : key === 'htpr-7195-ai-feedback' ? mode : 'OFF'
    return selected === 'EVERYONE' ? null : selected === 'OFF' ? [] : [6, 985]
  },
})
stub('src/lib/redis.ts', { getRedis: async () => ({
  set: async (key, value) => { if (key.includes(':client:')) clientNames.set(key, value); return 'OK' },
  get: async (key) => clientNames.get(key),
  eval: async (script) => script.includes("redis.call('INCR'") ? ++attemptCount : script.includes('ZCARD') ? ++quotaCount <= 10 ? 1 : 0 : 1,
}) })
stub('src/utils/controllers/tasks/createTaskCore.ts', { createProvisionedTaskCore: async (options) => { if (coreBlock) await coreBlock; if (coreThrow) throw new Error('storage failed'); files.push(options); return { task: { ticketNumber: 'HTPR-7196', uniqueIndex: 7196 } } } })
stub('src/utils/controllers/comments/createCommentService.ts', { createCommentService: async () => {} })
stub('src/lib/realtime/server.ts', { broadcastTaskChange: async () => {} })
stub('src/lib/mcp/auth.ts', {
  extractBearerToken: (header) => header?.replace(/^Bearer /, ''),
  validateMcpAuth: async () => auth(),
  mcpUnauthorizedResponse: async () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  checkMcpRateLimit: async () => null,
})
stub('src/lib/mcp/directOperationClient.ts', { createDirectOperationClient: () => ({}) })
stub('src/lib/mcp/mcpV2.ts', { isMcpV2Enabled: async () => false })
stub('src/lib/telemetry/mcpSseAnalytics.ts', { recordLegacyMcpRequest: () => {} })
stub('src/lib/mcp-server/legacy-sse.ts', { isLegacySseRequest: () => false })
const vercelPath = require.resolve('@vercel/functions')
require.cache[vercelPath] = { id: vercelPath, filename: vercelPath, loaded: true, exports: { waitUntil: (promise) => pending.push(promise) } }
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { reportFeedbackTool } = jiti('../src/lib/mcp-server/tools/report-feedback.tool.ts')
registeredTools.push(reportFeedbackTool)
stub('src/lib/mcp-server/tools/index.ts', { MCP_TOOLS: registeredTools })
const { POST } = jiti('../src/app/api/mcp/feedback/route.ts')
const { mcpHandler } = jiti('../src/lib/mcp-server/handler.ts')
const { observeFeedbackTools, queueRestFailure, feedbackRouteTemplate, queueAiFeedback } = jiti('../src/lib/aiFeedback/automatic.ts')
const { wrapMcpRoute } = jiti('../src/lib/mcp/routeWrapper.ts')
const { handleStatelessMcpRequest } = jiti('../src/lib/mcp-server/stateless-http.ts')
const restRequest = (body) => new NextRequest('https://app.hypertask.ai/api/mcp/feedback', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const rpcRequest = (method, params) => new Request('https://mcp.hypertask.ai/mcp', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
async function drain() { while (pending.length) { const batch = pending.splice(0); await Promise.all(batch) } }

test.beforeEach(() => { plainMode = 'OFF'; mode = 'OWNER_AND_QA'; userId = 985; authorized = true; files = []; pending = []; clientNames = new Map(); quotaCount = 0; attemptCount = 0; registeredTools.splice(0, registeredTools.length, reportFeedbackTool); coreBlock = undefined; coreThrow = false; catalogEnabled = false; lockBlock = undefined; transactionError = undefined; onLockAttempt = undefined; delete process.env.AI_FEEDBACK_AGENT_USER_ID })
test.afterEach(drain)

test('REST accepts legitimate agent caller and returns the exact contract without private account fields', async () => {
  const response = await POST(restRequest({ surface: 'agent', client: 'cursor', tool: 'hypertask_tasks', status: 503, note: 'Failed "Private task"' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, ticketNumber: 'HTPR-7196', url: 'https://app.hypertask.ai/detail/project-15/7196', deduped: false, count: 1 })
  assert.equal(files[0].description.includes('Private task'), false)
  assert.match(files[0].description, /Category: other/)
  assert.match(files[0].description, /Free text was supplied and not stored, for privacy\./)
  assert.equal(files[0].description.includes('private@example.test'), false)
})

test('REST invalid fields, content arguments and malformed JSON return clear 400 messages, with no filing', async () => {
  for (const [body, message] of [[{ surface: 'other' }, 'surface'], [{ surface: 'mcp', status: 600 }, 'status'], [{ surface: 'mcp', tool: '<private>' }, 'tool'], [{ surface: 'mcp', arguments: {} }, 'Unrecognized'], ['{', 'body']]) {
    const response = await POST(restRequest(body))
    assert.equal(response.status, 400)
    assert.ok((await response.json()).error.includes(message))
  }
  assert.equal(files.length, 0)
})

test('REST requires authentication, returns 404 when disabled or outside flag audience, and 429 without filing over quota', async () => {
  authorized = false
  assert.equal((await POST(restRequest({ surface: 'api' }))).status, 401)
  authorized = true
  mode = 'OFF'
  assert.equal((await POST(restRequest({ surface: 'api' }))).status, 404)
  mode = 'OWNER_AND_QA'; userId = 42
  assert.equal((await POST(restRequest({ surface: 'api' }))).status, 404)
  mode = 'EVERYONE'
  assert.equal((await POST(restRequest({ surface: 'api' }))).status, 200)
  quotaCount = 10
  assert.equal((await POST(restRequest({ surface: 'api' }))).status, 429)
  assert.equal(files.length, 1)
})

test('MCP tool is listed and callable only for enabled users, and instructs autonomous private reporting', async () => {
  for (const consolidated of [false, true]) {
    catalogEnabled = consolidated
    for (const [state, id, expected] of [['OFF', 985, false], ['OWNER_AND_QA', 42, false], ['OWNER_AND_QA', 985, true], ['EVERYONE', 42, true]]) {
      mode = state; userId = id
      const listed = await (await mcpHandler(rpcRequest('tools/list'))).json()
      assert.equal(listed.result.tools.some((tool) => tool.name === 'hypertask_report_feedback'), expected)
      const result = await (await mcpHandler(rpcRequest('tools/call', { name: 'hypertask_report_feedback', arguments: { tool: 'hypertask_tasks', status: 500 } }))).json()
      assert.equal(Boolean(result.result && !result.result.isError), expected)
    }
  }
  assert.match(reportFeedbackTool.description, /ON YOUR OWN, without being asked/)
  assert.match(reportFeedbackTool.description, /empty tools list/)
  assert.match(reportFeedbackTool.description, /Never include task, board or comment content/)
  assert.equal(reportFeedbackTool.annotations.readOnlyHint, false)
})

test('MCP clientInfo is captured across requests and used instead of arbitrary caller client or surface', async () => {
  await mcpHandler(rpcRequest('initialize', { clientInfo: { name: 'Claude Desktop', version: '1' } }))
  await drain()
  const result = await (await mcpHandler(rpcRequest('tools/call', { name: 'hypertask_report_feedback', arguments: { tool: 'hypertask_tasks', category: 'unexpected_result', note: 'unexpected empty result' } }))).json()
  assert.equal(result.result.isError, undefined)
  assert.match(files[0].description, /Surface: mcp/)
  assert.match(files[0].description, /Clients: claude-desktop/)
  assert.match(files[0].description, /Category: unexpected_result/)
  assert.equal(files[0].description.includes('unexpected empty result'), false)
  await assert.rejects(reportFeedbackTool.execute({ surface: 'cli', client: 'fake' }, 'fixture'), /Unrecognized/)
  mode = 'OFF'
  await assert.rejects(reportFeedbackTool.execute({}, 'fixture'), { status: 404 })
})

test('tool exceptions and returned 5xx report in background without capturing messages, arguments or response data', async () => {
  const original = new Error('Task "Secret task title" failed for private@example.test')
  const tools = observeFeedbackTools([
    { name: 'hypertask_hello', description: 'throws', parameters: z.object({}).strict(), execute: async () => { throw original } },
    { name: 'hypertask_list_tasks', description: 'returns', parameters: z.object({}).strict(), execute: async () => JSON.stringify({ status: 503, error: 'Private response content', data: { title: 'Secret title' } }) },
  ], 985)
  await assert.rejects(tools[0].execute({}, 'fixture'), (error) => error === original)
  assert.match(await tools[1].execute({}, 'fixture'), /Private response content/)
  await drain()
  assert.equal(files.length, 2)
  for (const row of files) assert.match(row.description, /Category: call_failed/)
  for (const row of files) for (const secret of ['Secret', 'private@example', 'Private response']) assert.equal(row.description.includes(secret), false)
  mode = 'OFF'; files = []
  await assert.rejects(tools[0].execute({}, 'fixture'))
  await drain()
  assert.equal(files.length, 0)
})

test('MCP empty list reports and unauthenticated 401 reports use only Everyone global bucket', async () => {
  mode = 'OFF'
  await handleStatelessMcpRequest(rpcRequest('tools/list'), { token: 'fixture', clientId: '985' }, [])
  await drain(); assert.equal(files.length, 0)
  mode = 'OWNER_AND_QA'
  await handleStatelessMcpRequest(rpcRequest('tools/list'), { token: 'fixture', clientId: '985' }, [])
  await drain(); assert.equal(files.length, 1)
  assert.match(files[0].description, /empty-tools-list/)
  assert.match(files[0].description, /Category: empty_result/)
  files = []; authorized = false
  assert.equal((await mcpHandler(rpcRequest('tools/list'))).status, 401)
  await drain(); assert.equal(files.length, 0)
  mode = 'EVERYONE'
  assert.equal((await mcpHandler(rpcRequest('tools/list'))).status, 401)
  await drain(); assert.equal(files.length, 0)
  process.env.AI_FEEDBACK_AGENT_USER_ID = '77'
  assert.equal((await mcpHandler(rpcRequest('tools/list'))).status, 401)
  await drain(); assert.equal(files.length, 1)
  assert.equal(files[0].userId, 77)
  assert.match(files[0].description, /HTTP status: 401/)
  assert.match(files[0].description, /Category: auth_failed/)
  assert.match(files[0].description, /Reporting display names: <\/p>/)
})

test('REST shared wrapper reports 5xx and thrown errors, normalizes registered dynamic routes, and never reports 4xx or feedback itself', async () => {
  const request = new NextRequest('https://app.hypertask.ai/api/mcp/projects/private-board-id/members?title=Secret', { headers: { Authorization: 'Bearer fixture', 'User-Agent': 'hypertask-cli/0.2.0' } })
  const response = Response.json({ private: 'content' }, { status: 503 })
  assert.equal(await wrapMcpRoute(async () => response)(request), response)
  await drain(); assert.equal(files.length, 1)
  assert.match(files[0].description, /Surface: cli/)
  assert.match(files[0].description, /Tool: \/api\/mcp\/projects\/:projectId\/members/)
  assert.equal(files[0].description.includes('private-board-id'), false)
  const failure = new Error('private exception')
  await assert.rejects(wrapMcpRoute(async () => { throw failure })(request), (error) => error === failure)
  await drain(); assert.equal(files.length, 2)
  queueRestFailure(request, 400); queueRestFailure(restRequest({}), 503)
  await drain(); assert.equal(files.length, 2)
  assert.equal(feedbackRouteTemplate('/api/mcp/projects/user-email@example.test/members'), '/api/mcp/projects/:projectId/members')
  assert.equal(feedbackRouteTemplate('/api/mcp/unknown-private-content'), '/api/mcp/unknown')
  assert.equal(feedbackRouteTemplate('/api/mcp/agents/create'), '/api/mcp/agents/create')
  assert.equal(feedbackRouteTemplate('/api/v1/projects/123/members'), '/api/mcp/projects/:projectId/members')
})

test('original response does not wait for filing, and reporting rejection cannot break it', { timeout: 3000 }, async () => {
  let finish
  coreBlock = new Promise((resolve) => { finish = resolve })
  const request = new NextRequest('https://app.hypertask.ai/api/mcp/tasks', { headers: { Authorization: 'Bearer fixture' } })
  const response = Response.json({ original: true }, { status: 500 })
  assert.equal(await wrapMcpRoute(async () => response)(request), response)
  assert.ok(pending.length)
  assert.equal(files.length, 0)
  finish()
  await drain()
  assert.equal(files.length, 1)
  coreThrow = true
  assert.equal(await wrapMcpRoute(async () => response)(request), response)
  await drain()
  assert.equal(files.length, 1)
})

test('all REST handlers adopt the shared failure boundary or are constant 404/not-found routes', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  for (const file of walk(path.join(root, 'src/app/api/mcp')).filter((file) => file.endsWith('route.ts'))) {
    const source = fs.readFileSync(file, 'utf8')
    // Reporting endpoints must not report their own failures through AI feedback.
    if (file.includes('/feedback/') || file.includes('/cli-error/') || file.includes('/factory/')) continue
    if (source.includes('wrapMcpRoute')) continue
    const match = source.match(/from ['"](@\/lib\/mcp\/operations\/[^'"]+)['"]/) ?? source.match(/export \{ [^}]+ \} from ['"](@\/lib\/mcp\/[^'"]+)['"]/)
    assert.ok(match, path.relative(root, file))
    const operation = fs.readFileSync(path.join(root, 'src', match[1].slice(2) + '.ts'), 'utf8')
    assert.ok(operation.includes('wrapMcpRoute'), path.relative(root, file))
  }
})


test('automatic observers preserve thrown HTTP status and hostile error identity, but do not report returned 4xx', async () => {
  const missing = Object.assign(new Error('private resource'), { httpStatus: 404 })
  const hostile = new Error('original')
  Object.defineProperty(hostile, 'status', { get() { throw new Error('getter failed') } })
  const tools = observeFeedbackTools([
    { name: 'hypertask_hello', description: '404', parameters: z.object({}), execute: async () => JSON.stringify({ status: 404 }) },
    { name: 'hypertask_list_tasks', description: 'throws 404', parameters: z.object({}), execute: async () => { throw missing } },
    { name: 'hypertask_get_tasks', description: 'hostile error', parameters: z.object({}), execute: async () => { throw hostile } },
  ], 985)
  assert.equal(await tools[0].execute({}, 'fixture'), '{"status":404}')
  await assert.rejects(tools[1].execute({}, 'fixture'), (error) => error === missing)
  await assert.rejects(tools[2].execute({}, 'fixture'), (error) => error === hostile)
  await drain()
  assert.equal(files.length, 2)
  assert.match(files[0].description, /HTTP status: 404/)
  assert.match(files[1].description, /HTTP status: 500/)
})

test('thrown MCP caller errors keep their HTTP meaning instead of filing as 500 (HTPR-7202)', async () => {
  const { NotFoundError, ValidationError } = jiti('../src/lib/mcp-server/utils/errors.ts')
  const tools = observeFeedbackTools([
    { name: 'hypertask_update_task', description: 'missing task', parameters: z.object({}), execute: async () => { throw new NotFoundError('Task not found') } },
    { name: 'hypertask_create_task', description: 'bad input', parameters: z.object({}), execute: async () => { throw new ValidationError('Invalid request') } },
  ], 985)
  await assert.rejects(tools[0].execute({}, 'fixture'), NotFoundError)
  await assert.rejects(tools[1].execute({}, 'fixture'), ValidationError)
  await drain()
  assert.equal(files.length, 2)
  assert.match(files[0].description, /HTTP status: 404/)
  assert.match(files[1].description, /HTTP status: 400/)
})

test('deliberate thrown 403 refusals are rethrown unchanged without AI feedback (HTPR-7251)', async () => {
  const { McpError, AuthorizationError } = jiti('../src/lib/mcp-server/utils/errors.ts')
  const { AgentDoneLifecycleDeniedError } = jiti('../src/lib/mcp/tasks/agentDoneLifecycle.ts')
  for (const original of [
    Object.assign(new Error('Access denied'), { httpStatus: 403 }),
    new McpError(-32003, 'Access denied'),
    new AuthorizationError(),
    new AgentDoneLifecycleDeniedError(),
  ]) {
    const [tool] = observeFeedbackTools([
      { name: 'hypertask_update_task', description: 'permission refusal', parameters: z.object({}), execute: async () => { throw original } },
    ], 985)
    await assert.rejects(tool.execute({}, 'fixture'), (error) => error === original)
    assert.equal(pending.length, 0)
    await drain()
    assert.equal(files.length, 0)
  }
})

test('thrown 400, 404 and 500 errors still file AI feedback and are rethrown unchanged (HTPR-7251)', async () => {
  for (const status of [400, 404, 500]) {
    const original = Object.assign(new Error('Tool failed'), { httpStatus: status })
    const [tool] = observeFeedbackTools([
      { name: 'hypertask_update_task', description: 'tool failure', parameters: z.object({}), execute: async () => { throw original } },
    ], 985)
    const count = files.length
    await assert.rejects(tool.execute({}, 'fixture'), (error) => error === original)
    await drain()
    assert.equal(files.length, count + 1)
    assert.match(files.at(-1).description, new RegExp(`HTTP status: ${status}`))
    assert.match(files.at(-1).description, /Error code: tool-exception/)
  }
})

test('schema rejections thrown inside a tool file are a refused call that files nothing (HTPR-7207, HTPR-7920)', async () => {
  const schema = z.object({ task_id: z.array(z.number()) })
  const tools = observeFeedbackTools([
    { name: 'hypertask_tasks', description: 'bad input', parameters: z.object({}), execute: async (args) => { schema.parse(args); return '{}' } },
  ], 985)
  await assert.rejects(tools[0].execute({ task_id: 'HTPR-1' }, 'fixture'), z.ZodError)
  await drain()
  assert.equal(files.length, 0)
})

test('an empty real MCP catalog reports even when deferred discovery helpers prevent a literally empty wire list', async () => {
  registeredTools.length = 0
  const response = await (await mcpHandler(rpcRequest('tools/list'))).json()
  assert.deepEqual(response.result.tools.map((tool) => tool.name).sort(), ['hypertask_describe_tool', 'hypertask_search_tools'])
  await drain()
  assert.equal(files.length, 1)
  assert.match(files[0].description, /empty-tools-list/)
  assert.match(files[0].description, /Category: empty_result/)
})


test('unmatched REST 5xx failures use a content-free fallback and query strings cannot suppress reporting', async () => {
  const request = new NextRequest('https://app.hypertask.ai/api/mcp/private@example.test/secret-board?skip=/mcp/feedback', { headers: { Authorization: 'Bearer fixture' } })
  queueRestFailure(request, 500)
  await drain()
  assert.equal(files.length, 1)
  assert.match(files[0].description, /Tool: \/api\/mcp\/unknown/)
  assert.equal(files[0].description.includes('private@example.test'), false)
  assert.equal(files[0].description.includes('secret-board'), false)
})


test('REST rejects credential-shaped structured fields with 400 and still accepts legitimate callers', async () => {
  for (const field of ['tool', 'client', 'errorCode']) {
    for (const value of ['vck_secret123', 'httk_secret123', 'abc_x7Yz9QwE', 'htk_secret123', 'eyJ' + 'hbGciOiJIUzI1NiJ9.payload', 'aB7cD9eF2g' + 'H4jK6mN8pQ']) {
      const response = await POST(restRequest({ surface: 'cli', [field]: value }))
      assert.equal(response.status, 400)
      assert.match((await response.json()).error, /Credential-shaped/)
    }
  }
  assert.equal(files.length, 0)
  const response = await POST(restRequest({ surface: 'cli', tool: 'hypertask_tasks', client: 'hypertask-cli', errorCode: 'service-unavailable', category: 'call_failed' }))
  assert.equal(response.status, 200)
  assert.equal(files.length, 1)
})

test('automatic reports drop credential-shaped fields, retain safe fields and still file in background', async () => {
  for (const value of ['vck_secret123', 'httk_secret123', 'abc_x7Yz9QwE', 'htk_secret123', 'eyJ' + 'hbGciOiJIUzI1NiJ9.payload', 'aB7cD9eF2g' + 'H4jK6mN8pQ']) {
    queueAiFeedback({ surface: 'mcp', tool: value, client: value, errorCode: value, status: 503 }, 985)
    await drain()
    const report = files.at(-1).description
    assert.equal(report.includes(value), false)
    for (const label of ['Tool:', 'Error code:']) assert.equal(report.includes(label), false)
    assert.match(report, /Clients: <\/p>/)
    assert.match(report, /HTTP status: 503/)
    assert.match(report, /Category: call_failed/)
  }
  assert.equal(files.length, 6)
})

test('MCP input schema documents free-text non-storage and the optional category contract', async () => {
  const result = await (await mcpHandler(rpcRequest('tools/list'))).json()
  // Full schema is exposed by discovery even when the initial catalog is deferred.
  const described = await (await mcpHandler(rpcRequest('tools/call', { name: 'hypertask_describe_tool', arguments: { name: 'hypertask_report_feedback' } }))).json()
  const text = JSON.stringify(described)
  assert.ok(result.result.tools.some((tool) => tool.name === 'hypertask_report_feedback'))
  for (const value of ['call_failed', 'empty_result', 'unexpected_result', 'auth_failed', 'slow', 'user_reported_broken', 'other']) assert.ok(text.includes(value))
  assert.match(reportFeedbackTool.parameters.shape.note.description, /never stored/)
  assert.match(reportFeedbackTool.parameters.shape.error.description, /never stored/)
  assert.match(reportFeedbackTool.description, /never stored/)
  assert.equal(reportFeedbackTool.parameters.parse({}).category, 'other')
})


test('REST and MCP feedback check flags before the shared attempt limit and filing', async () => {
  attemptCount = 60
  mode = 'OFF'
  const response = await POST(restRequest({ surface: 'api' }))
  assert.equal(response.status, 404)
  assert.equal(attemptCount, 60)
  mode = 'EVERYONE'
  const limited = await POST(restRequest({ surface: 'api' }))
  assert.equal(limited.status, 429)
  assert.match((await limited.json()).error, /attempt limit/)
  await assert.rejects(reportFeedbackTool.execute({}, 'fixture'), { status: 429 })
  assert.equal(files.length, 0)
  assert.equal(quotaCount, 0)
  assert.equal(attemptCount, 62)
})


test('automatic contention awaits the same filing path in waitUntil', async () => {
  let attempted
  const waiting = new Promise((resolve) => { attempted = resolve })
  lockBlock = true
  onLockAttempt = attempted
  queueAiFeedback({ surface: 'mcp', tool: 'hypertask_tasks', status: 503, note: 'private prose', error: 'private error' }, 985)
  assert.equal(files.length, 0)
  assert.equal(pending.length, 1)
  await waiting
  assert.equal(quotaCount, 0)
  lockBlock = false
  await drain()
  assert.equal(files.length, 1)
  assert.equal(files[0].userId, 985)
  assert.match(files[0].description, /Tool: hypertask_tasks/)
  assert.equal(files[0].description.includes('private prose'), false)
})

test('REST explicit transaction timeout returns 503 without filing', async () => {
  transactionError = Object.assign(new Error('Transaction expired'), { code: 'P2028' })
  const response = await POST(restRequest({ surface: 'api' }))
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /timed out/)
  assert.equal(files.length, 0)
})


test('plain flag On quiets explicit REST and MCP refusals but keeps missing routes and server failures', async () => {
  plainMode = 'EVERYONE'
  const quiet = await POST(restRequest({ surface: 'api', status: 404, error: 'Task not found' }))
  assert.equal((await quiet.json()).filed, false)
  const refusal = JSON.parse(await reportFeedbackTool.execute({ status: 403, errorCode: 'forbidden' }, 'fixture'))
  assert.equal(refusal.filed, false)
  assert.equal(files.length, 0)
  const missing = await POST(restRequest({ surface: 'api', status: 404, errorCode: 'not_found', error: 'Cannot GET /api/mcp/tasks' }))
  assert.equal((await missing.json()).success, true)
  const server = JSON.parse(await reportFeedbackTool.execute({ status: 500, category: 'auth_failed' }, 'fixture'))
  assert.equal(server.success, true)
  assert.equal(files.length, 2)
  assert.match(files[1].title, /server error/)
})

test('plain flag On preserves automatic auth-failure and thrown 404 reports', async () => {
  plainMode = 'EVERYONE'; mode = 'EVERYONE'; authorized = false
  process.env.AI_FEEDBACK_AGENT_USER_ID = '77'
  assert.equal((await mcpHandler(rpcRequest('tools/list'))).status, 401)
  await drain()
  assert.equal(files.length, 1)
  assert.match(files[0].description, /HTTP status: 401/)
  assert.doesNotMatch(files[0].description, /usually means the agent used/)
  queueAiFeedback({ surface: 'mcp', status: 404, error: 'Task not found' }, 985)
  await drain()
  assert.equal(files.length, 2)
})
