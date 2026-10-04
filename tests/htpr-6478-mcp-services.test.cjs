const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const load = (file) => jiti(path.join(root, file))
const context = load('src/lib/mcp/operationContext.ts')
const auth = { user: { id: 42, email: 'fixture@example.com' }, agentId: 'agent-fixture', agentRuntimeGeneration: 7 }
let calls = []
let limitChecks = 0
let credentialChecks = 0
let failure
let thrown
let limitedResponse
const task = { id: 6478, ticketNumber: 'HTPR-6478', projectId: 15, title: 'Fixture', description: '<p>Fixture</p>',
  createdAt: '2026-10-01T00:00:00.000Z', priority: { priority_index: 2 }, estimate: { estimate_index: 1 }, link: { url: 'https://example.com/ticket' }, agentId: 'internal' }
function backend(endpoint, options = {}) {
  const url = new URL(endpoint, 'http://mcp.internal')
  if (failure) return { status: failure.status, data: failure.data }
  if (url.pathname === '/mcp/tasks') return { status: 200, data: { success: true, tasks: [task], total: 1, limit: 20 } }
  if (['/mcp/tasks/create', '/mcp/tasks/update'].includes(url.pathname)) return { status: 200, data: { success: true, task } }
  if (url.pathname === '/mcp/comments' && options.method === 'POST') return { status: 201, data: { success: true, comment: { id: 19, text: '<p>Fixture</p>', taskId: task.id, agentId: 'internal' } } }
  if (url.pathname === '/mcp/tasks/attachments') return { status: 200, data: { success: true, attachments: [{ id: 3, fileName: 'proof.txt', fileType: 'text/plain', fileSize: 5, url: 'https://example.com/proof.txt' }] } }
  throw new Error(`Unexpected operation ${url.pathname}`)
}
function stub(file, exports) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
stub('src/lib/mcp/auth.ts', {
  validateMcpAuth: async () => { credentialChecks++; return auth },
  checkMcpRateLimit: async () => { limitChecks++; return limitedResponse ?? null },
})
stub('src/lib/mcp/operations/index.ts', {
  executeMcpOperation: async (request) => {
    if (thrown) throw thrown
    assert.deepEqual(context.getMcpOperationContext(request), { auth, rateLimitChecked: true })
    const endpoint = request.nextUrl.pathname + request.nextUrl.search
    const options = { method: request.method, headers: { 'Idempotency-Key': request.headers.get('Idempotency-Key') } }
    if (request.method !== 'GET') options.body = await request.text()
    calls.push({ endpoint, options })
    const result = backend(endpoint, options)
    return Response.json(result.data, { status: result.status })
  },
})
const { mapHttpErrorToMcpError } = load('src/lib/mcp-server/utils/errors.ts')
const { createInProcessMcpClient } = load('src/lib/mcp/inProcessClient.ts')
const { MCP_TOOLS } = load('src/lib/mcp-server/tools/index.ts')
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const { resolvePortableTools } = load('src/lib/mcp-server/listQueryContract.ts')
const snapshots = require('./fixtures/mcp-6478/legacy-tools.json')
const token = 'fixture-token'
const invocation = { requestId: 'request-fixture', clientFingerprint: 'fixture-principal' }
function legacyRequest(endpoint, options = {}) {
  if (thrown) throw mapHttpErrorToMcpError(500, 'HTTP 500: Internal Server Error', 'fixture-correlation')
  calls.push({ endpoint, options: { method: options.method ?? 'GET', ...(options.body ? { body: options.body } : {}), headers: { 'Idempotency-Key': new Headers(options.headers).get('Idempotency-Key') } } })
  const result = backend(endpoint, options)
  const data = JSON.parse(JSON.stringify(result.data))
  if (result.status >= 400) {
    const message = data.message || data.error || `HTTP ${result.status}: ${require('node:http').STATUS_CODES[result.status]}`
    throw mapHttpErrorToMcpError(result.status, message, 'fixture-correlation', data)
  }
  return Promise.resolve(data)
}
function legacyLoad(file, overrides = {}) {
  const source = ts.transpileModule(snapshots[file], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const loadedModule = { exports: {} }
  const filename = path.join(root, 'src/lib/mcp-server', file)
  new Function('module', 'exports', 'require', source)(loadedModule, loadedModule.exports, (name) => {
    if (name in overrides) return overrides[name]
    return name.startsWith('.') ? jiti(path.resolve(path.dirname(filename), name)) : name.startsWith('@/') ? jiti(path.join(root, 'src', name.slice(2))) : require(name)
  })
  return loadedModule.exports
}
const oldExecutor = legacyLoad('utils/executeWithService.ts', { '../lib/api-client': { createApiClient: () => ({ makeRequest: legacyRequest }) } })
const cases = [
  { name: 'hypertask_get_tasks', file: 'get-tasks', key: 'getTasksTool', args: { ticket_number: ['HTPR-6478'] }, action: 'get' },
  { name: 'hypertask_list_tasks', file: 'list-tasks', key: 'listTasksTool', args: { project_id: 15, limit: 20 }, action: 'list' },
  { name: 'hypertask_create_task', file: 'create-task', key: 'createTaskTool', args: { project_id: 15, title: 'Fixture', description: 'Fixture' }, action: 'create' },
  { name: 'hypertask_update_task', file: 'update-task', key: 'updateTaskTool', args: { ticket_number: 'HTPR-6478', title: 'Fixture' }, action: 'update' },
  { name: 'hypertask_add_comment_to_task', file: 'add-comment', key: 'addCommentTool', args: { ticket_number: 'HTPR-6478', text: 'Fixture' }, action: 'add' },
]
for (const fixture of cases) {
  const oldTool = legacyLoad(`tools/${fixture.file}.tool.ts`, { '../utils/executeWithService': oldExecutor })[fixture.key]
  const newTool = MCP_TOOLS.find((tool) => tool.name === fixture.name)
  test(`${fixture.name} keeps byte-identical legacy result text and operation inputs`, async () => {
    failure = undefined
    calls = []
    const before = await oldTool.execute(fixture.args, token, invocation)
    const originalCalls = calls
    calls = []
    credentialChecks = limitChecks = 0
    const after = await context.withMcpExecutionContext(token, auth, () => newTool.execute(fixture.args, token, invocation))
    assert.equal(after, before)
    assert.deepEqual(calls, originalCalls)
    assert.equal(credentialChecks, 0)
    assert.equal(limitChecks, 1)
  })
  test(`${fixture.name} keeps error text for REST failures`, async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
      failure = { status, data: { success: false, message: `Fixture error ${status}`, error: 'less specific', details: { field: 'task' } } }
      let before
      try { await oldTool.execute(fixture.args, token, invocation) } catch (error) { before = error }
      assert.ok(before)
      await assert.rejects(context.withMcpExecutionContext(token, auth, () => newTool.execute(fixture.args, token, invocation)), (after) => {
        assert.equal(after.message, before.message)
        assert.equal(after.code, before.code)
        assert.equal(after.statusCode, before.statusCode)
        return true
      })
    }
    failure = undefined
  })
  test(`${fixture.name} works as the cached alias and consolidated action with either catalog`, async () => {
    failure = undefined
    const legacy = resolvePortableTools(MCP_TOOLS)
    const before = await context.withMcpExecutionContext(token, auth, () => newTool.execute(fixture.args, token, invocation))
    for (const enabled of [false, true]) {
      const alias = selectMcpTools(legacy, enabled).find((tool) => tool.name === fixture.name)
      assert.equal(await context.withMcpExecutionContext(token, auth, () => alias.execute(fixture.args, token, invocation)), before)
    }
    const consolidatedName = fixture.action === 'add' ? 'hypertask_comments' : 'hypertask_tasks'
    const consolidated = selectMcpTools(legacy, true).find((tool) => tool.name === consolidatedName)
    const result = JSON.parse(await context.withMcpExecutionContext(token, auth, () => consolidated.execute({ action: fixture.action, input: fixture.args, response_format: 'detailed' }, token, invocation)))
    assert.ok(result.data)
    assert.equal(result.response_format, 'detailed')
  })
}
test('compound writes preserve attachments and invocation idempotency with one rate-limit check', async () => {
  const fixture = cases.find((candidate) => candidate.action === 'create')
  const args = { ...fixture.args, attachments: [{ filename: 'proof.txt', content_type: 'text/plain', data: 'cHJvb2Y=' }] }
  const oldTool = legacyLoad('tools/create-task.tool.ts', { '../utils/executeWithService': oldExecutor }).createTaskTool
  calls = []
  const before = await oldTool.execute(args, token, invocation)
  const originalCalls = calls
  calls = []
  limitChecks = 0
  const after = await context.withMcpExecutionContext(token, auth, () => MCP_TOOLS.find((tool) => tool.name === fixture.name).execute(args, token, invocation))
  assert.equal(after, before)
  assert.deepEqual(calls, originalCalls)
  assert.equal(limitChecks, 1)
})
test('invalid representative inputs keep the exact pre-refactor validation messages', async () => {
  const invalid = [{}, { project_id: 15, limit: 0 }, { project_id: 15, title: '' }, { ticket_number: 'HTPR-6478', title: '' }, { ticket_number: 'HTPR-6478', text: '' }]
  for (const [index, fixture] of cases.entries()) {
    const oldTool = legacyLoad(`tools/${fixture.file}.tool.ts`, { '../utils/executeWithService': oldExecutor })[fixture.key]
    let before
    try { await oldTool.execute(invalid[index], token, invocation) } catch (error) { before = error }
    assert.ok(before)
    await assert.rejects(context.withMcpExecutionContext(token, auth, () => MCP_TOOLS.find((tool) => tool.name === fixture.name).execute(invalid[index], token, invocation)), (after) => {
      assert.equal(after.message, before.message)
      return true
    })
  }
})
test('uncaught operation failures retain the REST boundary error without exposing internal details', async () => {
  thrown = new Error('fixture private controller detail')
  try {
    const fixture = cases[0]
    const oldTool = legacyLoad('tools/get-tasks.tool.ts', { '../utils/executeWithService': oldExecutor }).getTasksTool
    let before
    try { await oldTool.execute(fixture.args, token, invocation) } catch (error) { before = error }
    await assert.rejects(context.withMcpExecutionContext(token, auth, () => MCP_TOOLS.find((tool) => tool.name === fixture.name).execute(fixture.args, token, invocation)), (after) => {
      assert.equal(after.message, before.message)
      assert.doesNotMatch(after.message, /private controller detail/)
      return true
    })
  } finally { thrown = undefined }
})
test('concurrent compound operations share one rate check without consuming the failure response twice', async () => {
  limitedResponse = Response.json({ message: 'Rate limit exceeded. Please slow down and try again shortly.' }, { status: 429 })
  limitChecks = 0
  calls = []
  try {
    const { client } = await context.withMcpExecutionContext(token, auth, () => createInProcessMcpClient(token))
    const results = await Promise.allSettled([client.makeRequest('/mcp/tasks'), client.makeRequest('/mcp/tasks')])
    for (const result of results) {
      assert.equal(result.status, 'rejected')
      assert.equal(result.reason.message, 'Rate limit exceeded. Please slow down and try again shortly.')
    }
    assert.equal(limitChecks, 1)
    assert.equal(calls.length, 0)
  } finally { limitedResponse = undefined }
})
test('operation endpoints cannot turn the in-process client into an outbound client', async () => {
  const { client } = await context.withMcpExecutionContext(token, auth, () => createInProcessMcpClient(token))
  for (const endpoint of ['https://app.hypertask.ai/api/mcp/tasks', '//attacker.example/mcp/tasks', '/api/mcp/tasks']) {
    await assert.rejects(client.makeRequest(endpoint), /Invalid MCP operation endpoint/)
  }
})
test('execution auth is isolated across concurrent principals and only matches the selected bearer', async () => {
  let release
  const barrier = new Promise((resolve) => { release = resolve })
  const second = { user: { id: 43, email: 'second@example.com' }, agentId: null }
  await Promise.all([
    context.withMcpExecutionContext(token, auth, async () => { await barrier; assert.equal(context.getMcpExecutionContext(token), auth); assert.equal(context.getMcpExecutionContext('other'), undefined) }),
    context.withMcpExecutionContext('other', second, async () => { release(); await barrier; assert.equal(context.getMcpExecutionContext('other'), second); assert.equal(context.getMcpExecutionContext(token), undefined) }),
  ])
  assert.equal(context.getMcpExecutionContext(token), undefined)
})
test('HTTP headers and a clone cannot spoof an in-process operation context', () => {
  const request = new Request('http://mcp.internal/mcp/tasks', { headers: { 'X-MCP-Context': JSON.stringify(auth) } })
  assert.equal(context.getMcpOperationContext(request), undefined)
  context.bindMcpOperationContext(request, auth, true)
  assert.equal(context.getMcpOperationContext(request.clone()), undefined)
})
