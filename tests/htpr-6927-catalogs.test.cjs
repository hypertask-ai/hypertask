const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { z } = require('zod')
const { root, loader } = require('./htpr-6927-fixtures.cjs')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
stub('src/lib/prisma.ts', { __esModule: true, default: {} })
stub('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { MCP_TOOLS } = jiti(path.join(root, 'src/lib/mcp-server/tools/index.ts'))
const { resolvePortableTools } = jiti(path.join(root, 'src/lib/mcp-server/listQueryContract.ts'))
const definitions = jiti(path.join(root, 'src/lib/mcp-server/config/consolidated-descriptions.ts')).CONSOLIDATED_TOOL_DESCRIPTIONS
const legacy = resolvePortableTools(MCP_TOOLS).map((tool) => ({ ...tool, execute: async (args, token, invocation) => JSON.stringify({ name: tool.name, args, token, invocation }) }))
const overrides = { '@/lib/mcp/auth': { extractBearerToken: (header) => header?.replace(/^Bearer /, '') } }
const load = loader(overrides)
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const request = (method, params, query = '') => new Request(`https://mcp.example.com/mcp${query}`, {
  method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
})
async function rpc(modules, tools, method, params, deferred = false, query = '') {
  return (await modules('src/lib/mcp-server/stateless-http.ts').handleStatelessMcpRequest(request(method, params, query), { token: 'fixture-token', clientId: '985' }, tools, { deferred })).text()
}

test('every legacy, consolidated and discovery tool has top-level safety hints when ON', async () => {
  const annotations = load('src/lib/mcp-server/config/tool-annotations.ts').TOOL_ANNOTATIONS
  assert.equal(Object.keys(annotations).length, legacy.length + 2)
  for (const consolidated of [false, true]) {
    const tools = selectMcpTools(legacy, consolidated, {})
    const connected = load('src/lib/mcp-server/deferred-tools.ts').toolsForConnect(tools, true)
    for (const tool of connected) {
      assert.deepEqual(Object.keys(tool.annotations).sort(), ['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint'])
      assert.deepEqual(load('src/lib/mcp-server/deferred-tools.ts').describeToolCatalog(connected, tool.name).annotations, tool.annotations)
    }
    for (const deferred of [false, true]) {
      const listed = JSON.parse(await rpc(load, connected, 'tools/list', undefined, deferred)).result.tools
      assert.ok(listed.every((tool) => tool.annotations && !tool.inputSchema.annotations))
    }
    const full = load('src/lib/mcp-server/deferred-tools.ts').listToolsFull(connected)
    assert.ok(full.every((tool) => tool.annotations))
  }
  assert.equal(annotations.hypertask_archive_agent.idempotentHint, true)
  for (const name of ['import_skills', 'attach_files', 'create_task', 'update_task', 'add_comment_to_task', 'update_comment', 'agent_webhook']) assert.equal(annotations[`hypertask_${name}`].openWorldHint, true)
  assert.equal(annotations.hypertask_get_tasks.openWorldHint, false)
})

test('every tool with destructive schema or metadata actions is annotated conservatively', () => {
  const { TOOL_ANNOTATIONS, annotationsForActions } = load('src/lib/mcp-server/config/tool-annotations.ts')
  const destructiveAction = /(?:^|_)(?:update|delete|remove|replace|archive|revoke|restore|unlink)(?:_|$)/
  const connected = load('src/lib/mcp-server/deferred-tools.ts').toolsForConnect(selectMcpTools(legacy, true, {}), true)
  const tools = [...selectMcpTools(legacy, false, {}), ...connected]
  assert.deepEqual(new Set(tools.map((tool) => tool.name).filter((name) => name in TOOL_ANNOTATIONS)), new Set(Object.keys(TOOL_ANNOTATIONS)))
  function verify(annotations) {
    for (const tool of tools) {
      const schema = tool.inputSchema ?? z.toJSONSchema(tool.parameters, { unrepresentable: 'any', io: 'input' })
      const schemaActions = schema.properties?.action?.enum ?? []
      const metadataActions = definitions.flatMap((definition) => Object.entries(definition.actions).filter(([, action]) => action.tool === tool.name || definition.name === tool.name).flatMap(([name, action]) => [name, action.legacy_action].filter(Boolean)))
      if ([tool.name.replace(/^hypertask_/, ''), ...schemaActions, ...metadataActions].some((action) => destructiveAction.test(action))) {
        assert.equal(tool.annotations.destructiveHint, true, tool.name)
        assert.equal((annotations[tool.name] ?? tool.annotations).destructiveHint, true, tool.name)
      }
    }
  }
  verify(TOOL_ANNOTATIONS)
  assert.throws(() => verify({ ...TOOL_ANNOTATIONS, hypertask_add_comment_to_task: { ...TOOL_ANNOTATIONS.hypertask_add_comment_to_task, destructiveHint: false } }), /hypertask_add_comment_to_task/)
  assert.equal(annotationsForActions([{ tool: 'hypertask_add_comment_to_task', read_only: false }]).destructiveHint, true)
  assert.equal(annotationsForActions([{ tool: 'hypertask_get_tasks', read_only: false }]).destructiveHint, true)
  assert.equal(annotationsForActions([{ tool: 'hypertask_create_task', read_only: false }]).destructiveHint, false)
  assert.equal(annotationsForActions([{ tool: 'hypertask_add_comment_to_task', read_only: true }]).destructiveHint, false)
})

test('legacy scopes reuse consolidated policy for management, team and agent read credentials', async () => {
  for (const caller of [
    { managementPermissions: { management: ['read'] } },
    { managementPermissions: { management: ['write'] } },
    { managementPermissions: { management: ['read', 'write'], data: ['read', 'write'] }, teamScoped: true },
    { agent: true, agentRole: 'read' },
    { agent: true, agentRole: 'write' },
  ]) {
    const consolidated = selectMcpTools(legacy, true, caller)
    const permitted = new Set(consolidated.filter((tool) => !tool.hidden).flatMap((tool) => {
      const definition = definitions.find((definition) => definition.name === tool.name)
      const actionSchema = tool.parameters.shape.action
      return (actionSchema.options ?? actionSchema.unwrap().options).map((action) => definition.actions[action].tool)
    }))
    const tools = selectMcpTools(legacy, false, caller)
    assert.deepEqual(new Set(tools.map((tool) => tool.name)), permitted)
    if (caller.agentRole === 'read' || caller.managementPermissions?.management.length === 1 && caller.managementPermissions.management[0] === 'read') {
      assert.ok(tools.filter((tool) => tool.name !== 'hypertask_report_feedback').every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint && tool.annotations.idempotentHint && !tool.annotations.openWorldHint))
      assert.equal(tools.find((tool) => tool.name === 'hypertask_report_feedback').annotations.readOnlyHint, false)
      assert.ok(consolidated.filter((tool) => tool.name !== 'hypertask_report_feedback').every((tool) => tool.annotations.readOnlyHint))
    }
  }
  const read = selectMcpTools(legacy, false, { agent: true, agentRole: 'read' })
  const mixed = read.find((tool) => tool.name === 'hypertask_agent_webhook')
  assert.deepEqual(mixed.parameters.shape.action.options, ['get'])
  const consolidatedRead = selectMcpTools(legacy, true, { agent: true, agentRole: 'read' })
  const hidden = load('src/lib/mcp-server/deferred-tools.ts').describeToolCatalog(consolidatedRead, 'hypertask_agent_webhook')
  assert.deepEqual(hidden.inputSchema.properties.action.enum, ['get'])
  assert.equal(hidden.annotations.readOnlyHint, true)
  await assert.rejects(mixed.execute({ action: 'delete' }, 'fixture-token'), /not allowed/)
  assert.equal(read.some((tool) => tool.name === 'hypertask_create_task'), false)
})

test('handler keeps scoped annotated tools without consulting the retired switch', async () => {
  const calls = []
  const auth = { user: { id: 985 }, agentId: 'agent-not-human' }
  const handler = loader({
    './tools': { MCP_TOOLS: legacy },
    '@/lib/prisma': { __esModule: true, default: {} },
    '@/lib/telemetry/mcpSseAnalytics': { recordLegacyMcpRequest: () => {} },
    '@/lib/mcp/auth': { ...overrides['@/lib/mcp/auth'], validateMcpAuth: async () => auth },
    '@/lib/mcp/agents/scopes': { getAgentRole: async () => 'read' },
    '@/lib/flags': { isFeatureEnabled: async (key, id) => { calls.push([key, id]); assert.notEqual(key, 'htpr-6927-mcp-v2'); return false } },
  })('src/lib/mcp-server/handler.ts').mcpHandler
  const on = JSON.parse(await (await handler(request('tools/list', { user_id: 6 }))).text()).result.tools
  assert.ok(on.every((tool) => tool.annotations.readOnlyHint))
  assert.ok(calls.every(([, id]) => id === auth.user.id))
  assert.ok(on.length > 0)

})

test('SDK streamable registration passes hints beside inputSchema and supports unannotated tools', () => {
  const registrations = []
  const bind = loader({ 'mcp-handler': { createMcpHandler: (register) => register({ registerTool: (name, config) => registrations.push({ name, config }) }) } })('src/lib/mcp-server/streamable-http.ts').bindMcpTools
  const tools = selectMcpTools(legacy, false, {})
  bind(tools)
  assert.ok(registrations.every((entry) => entry.config.annotations && !entry.config.inputSchema.annotations))
  registrations.length = 0
  bind(legacy.map(({ annotations, ...tool }) => tool))
  assert.ok(registrations.every((entry) => !('annotations' in entry.config)))
})

test('legacy SSE registration preserves SDK annotations and resolves per-message scopes', async () => {
  const registrations = []
  let subscriber
  let streamTransport
  let callback
  let role = 'write'
  const sent = []
  class Redis {
    constructor() { if (!subscriber) subscriber = this }
    async connect() {}
    on(event, handler) { if (event === 'message') callback = handler }
    async subscribe() {}
    async publish() {}
    disconnect() {}
  }
  class Server {
    registerTool(name, config) { registrations.push({ name, config }); return { remove: () => { registrations.splice(registrations.findIndex((entry) => entry.name === name), 1) } } }
    async connect(transport) { streamTransport = transport }
    async close() {}
  }
  class Transport {
    sessionId = 'fixture-session'
    async send(message) { sent.push(message) }
    async handleMessage(message) { sent.push({ jsonrpc: '2.0', id: message.id, result: { tools: registrations.map(({ name, config }) => ({ name, description: config.description, annotations: config.annotations })) } }) }
  }
  const auth = { clientId: '985', token: 'fixture-token', extra: { agent: true, mcpAuthContext: { user: { id: 985 }, agentId: 'fixture-agent' } } }
  const sse = loader({
    ioredis: Redis,
    '@modelcontextprotocol/sdk/server/mcp.js': { McpServer: Server },
    '@modelcontextprotocol/sdk/server/sse.js': { SSEServerTransport: Transport },
    '@/lib/mcp/agents/scopes': { getAgentRole: async () => role },
    '@/lib/flags': { isFeatureEnabled: async (key) => (assert.notEqual(key, 'htpr-6927-mcp-v2'), false) },
  })('src/lib/mcp-server/legacy-sse.ts').handleLegacySseRequest
  const originalRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://fixture.invalid'
  const abort = new AbortController()
  try {
    await sse(new Request('https://mcp.example.com/sse', { signal: abort.signal }), auth, legacy, selectMcpTools(legacy, false, { agent: true }))
    assert.ok(registrations.every((entry) => entry.config.annotations))
    assert.equal(streamTransport.sessionId, 'fixture-session')
    for (const currentRole of ['write', 'read']) {
      role = currentRole
      callback('mcp:legacy:session:fixture-session', JSON.stringify({ replyChannel: 'reply', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, authInfo: auth }))
      await new Promise((resolve) => setImmediate(resolve))
      assert.ok(sent.at(-1).result.tools.every((tool) => tool.annotations))
      assert.equal(sent.at(-1).result.tools.find((tool) => tool.name === 'hypertask_tasks').inputSchema.properties.action.enum.includes('create'), role === 'write')
    }
    const restricted = { ...auth, extra: { managementPermissions: { management: ['read'] }, mcpAuthContext: { user: { id: 985 }, agentId: null } } }
    callback('mcp:legacy:session:fixture-session', JSON.stringify({ replyChannel: 'reply', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, authInfo: restricted }))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(sent.at(-1).result.tools.map((tool) => tool.name).sort(), ['hypertask_agents', 'hypertask_user_context'])
  } finally {
    abort.abort()
    if (originalRedis === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalRedis
  }
})
