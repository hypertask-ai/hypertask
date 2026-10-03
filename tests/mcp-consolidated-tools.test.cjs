const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { z } = require('zod')
const Ajv = require('ajv')
const root = path.resolve(__dirname, '..')
const stubModule = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let mode = null
let authUserId = 985
let caller = {}
stubModule('src/lib/prisma.ts', { __esModule: true, default: {
  featureFlag: { findUnique: async () => mode ? { mode } : null },
  user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? 'valentin.yeo@gmail.com' : where.id === 985 ? 'valentin@hypertask.ai' : 'member@example.com' }) },
} })
stubModule('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null })
stubModule('src/lib/mcp/auth.ts', {
  extractBearerToken: (header) => header?.replace(/^Bearer /, ''),
  validateMcpAuth: async () => ({ user: { id: authUserId }, agentId: caller.agent ? 'agent-example' : null,
    ...(caller.managementPermissions ? { management: { permissions: caller.managementPermissions, ...(caller.teamScoped ? { teamId: 'team-example' } : {}) } } : {}),
  }),
})
stubModule('src/lib/telemetry/mcpSseAnalytics.ts', { recordLegacyMcpRequest: () => {} })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const load = (file) => jiti(path.join(root, file))
const { MCP_TOOLS } = load('src/lib/mcp-server/tools/index.ts')
const { resolvePortableTools } = load('src/lib/mcp-server/listQueryContract.ts')
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const { CONSOLIDATED_TOOL_DESCRIPTIONS: definitions } = load('src/lib/mcp-server/config/consolidated-descriptions.ts')
const { executeToolResult, formatToolResponse, actionableToolError, bindConsolidatedSseTools } = load('src/lib/mcp-server/tool-response.ts')
const { handleMcpHttp } = load('src/lib/mcp-server/mcp-http.ts')
const { mcpHandler } = load('src/lib/mcp-server/handler.ts')
const flags = load('src/lib/flags.ts')
const legacy = resolvePortableTools(MCP_TOOLS)
const ajv = new Ajv({ strict: false })
require('ajv-formats')(ajv)
const request = (method, params) => new Request('https://mcp.example.com/mcp', {
  method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
})
async function rpc(tools, method, params) {
  const response = await handleMcpHttp(request(method, params), { authenticate: async () => ({ token: 'fixture-token', clientId: '985' }), tools })
  assert.equal(response.status, 200)
  return response.json()
}
const visible = (tools) => tools.filter((tool) => !tool.hidden)
const toolNamed = (tools, name) => tools.find((tool) => tool.name === name)
function sample(schema) {
  if (schema.const !== undefined) return schema.const
  if (schema.default !== undefined) return schema.default
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf)[0])
  if (schema.type === 'object') {
    const input = Object.fromEntries((schema.required ?? []).map((key) => [key, sample(schema.properties[key])]))
    const fields = schema.properties ?? {}
    if (fields.ticket_number && !input.task_id && !input.unique_index) input.ticket_number = fields.ticket_number.type === 'array' ? ['HTPR-1234'] : 'HTPR-1234'
    if (fields.page_id && !input.id) input.page_id = sample(fields.page_id)
    if (fields.revoke_all) input.revoke_all = true
    if (fields.task_identifier) input.task_identifier = 'HTPR-1234'
    if (fields.task) input.task = 'HTPR-1234'
    if (fields.minutes) input.minutes = 25
    if (fields.filename && fields.content_type) { input.content_type = 'text/plain'; input.data = 'Rml4dHVyZQ==' }
    return input
  }
  if (schema.type === 'array') return Array.from({ length: Math.max(schema.minItems ?? 1, 1) }, () => sample(schema.items))
  if (schema.type === 'integer' || schema.type === 'number') return Math.max(schema.minimum ?? 1, 1)
  if (schema.type === 'boolean') return false
  if (schema.format === 'email') return 'fixture@example.com'
  if (schema.format === 'uri') return 'https://example.com/source'
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  return 'Fixture'
}
function spyTools() {
  const calls = []
  const tools = legacy.map((tool) => ({ ...tool, execute: async (args, token, invocation) => {
    calls.push({ name: tool.name, args, token, invocation })
    return JSON.stringify({ success: true, legacy_name: tool.name, args })
  } }))
  return { calls, tools: selectMcpTools(tools, true) }
}

test('catalog flag off preserves the entire current deferred list exactly', async () => {
  const selected = selectMcpTools(legacy, false, { managementPermissions: { management: ['read'] } })
  assert.equal(selected, legacy)
  const listed = (await rpc(selected, 'tools/list')).result.tools
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/mcp-6804/legacy-catalog.json')))
  assert.deepEqual(listed, baseline)
  assert.deepEqual(baseline.filter((tool) => !['hypertask_search_tools', 'hypertask_describe_tool'].includes(tool.name)).map((tool) => tool.name), legacy.map((tool) => tool.name))
})

test('catalog flag on advertises 15 to 25 consolidated tools, with no duplicate names', async () => {
  const selected = selectMcpTools(legacy, true)
  const listed = (await rpc(selected, 'tools/list')).result.tools
  assert.ok(listed.length >= 15 && listed.length <= 25)
  assert.equal(new Set(selected.map((tool) => tool.name)).size, selected.length)
  assert.deepEqual(listed.map((tool) => tool.name), definitions.map((tool) => tool.name))
  for (const tool of listed) {
    assert.match(tool.name, /^hypertask_/)
    assert.ok(tool.name.length < 64)
    assert.ok(tool.inputSchema.properties.action.enum.length)
    assert.ok(tool.outputSchema.required.includes('data'))
  }
})

test('server flag defaults to Owner + QA and evaluates the authenticated user', async () => {
  mode = null
  for (const [id, enabled] of [[6, true], [985, true], [7, false]]) {
    authUserId = id
    assert.equal(await flags.isFeatureEnabled(flags.HTPR_6804_MCP_TOOLS_FLAG, id), enabled)
    const listed = (await (await mcpHandler(request('tools/list'))).json()).result.tools
    assert.equal(listed.length, enabled ? definitions.length : legacy.length + 2)
  }
  mode = 'OFF'
  authUserId = 6
  assert.equal((await (await mcpHandler(request('tools/list'))).json()).result.tools.length, legacy.length + 2)
  const disabledCall = await (await mcpHandler(request('tools/call', { name: 'hypertask_tasks', arguments: { action: 'create', input: { project_id: 15, title: 'Not executed' } } }))).json()
  assert.equal(disabledCall.error.code, -32602)
  mode = null
  authUserId = 985
})

test('scope filtering advertises only callable actions for management, agent and team credentials', async () => {
  for (const [permissions, expected] of [
    [{ management: ['read'] }, { hypertask_user_context: ['connections'], hypertask_agents: ['list'] }],
    [{ management: ['write'] }, { hypertask_agents: ['create', 'revoke', 'archive', 'delete'], hypertask_tokens: ['mint', 'revoke'] }],
  ]) {
    const tools = selectMcpTools(legacy, true, { managementPermissions: permissions })
    const listed = (await rpc(tools, 'tools/list')).result.tools
    assert.deepEqual(Object.fromEntries(listed.map((tool) => [tool.name, tool.inputSchema.properties.action.enum])), expected)
    const denied = await rpc(tools, 'tools/call', { name: 'hypertask_create_task', arguments: { project_id: 15, title: 'Denied' } })
    assert.equal(denied.result.isError, true)
    assert.match(denied.result.content[0].text, /required scope|not allowed/)
  }
  const agent = visible(selectMcpTools(legacy, true, { agent: true }))
  assert.equal(agent.some((tool) => tool.name === 'hypertask_tokens'), false)
  assert.deepEqual(toolNamed(agent, 'hypertask_agents').parameters.shape.action.options, ['presence'])
  const scoped = visible(selectMcpTools(legacy, true, { teamScoped: true, managementPermissions: { management: ['read', 'write'] } }))
  assert.deepEqual(scoped.map((tool) => tool.name), ['hypertask_agents'])
})

test('legacy dispatch keeps every existing name callable and forwards credentials and invocation identity', async () => {
  const { calls, tools } = spyTools()
  for (const tool of legacy) {
    const args = sample(z.toJSONSchema(tool.parameters, { unrepresentable: 'any' }))
    if (tool.name === 'hypertask_time') args.action = 'running'
    const result = await rpc(tools, 'tools/call', { name: tool.name, arguments: args })
    assert.equal(result.error, undefined, tool.name)
    assert.notEqual(result.result.isError, true, `${tool.name}: ${result.result.content[0].text}`)
    const call = calls.at(-1)
    assert.equal(call.name, tool.name)
    assert.equal(call.token, 'fixture-token')
    assert.equal(call.invocation.requestId, '1')
    assert.match(call.invocation.clientFingerprint, /^[a-f0-9]{64}$/)
  }
  for (const [name, args] of [['hypertask_search_tools', { query: 'tasks' }], ['hypertask_describe_tool', { name: 'hypertask_tasks' }]]) {
    const result = await rpc(tools, 'tools/call', { name, arguments: args })
    assert.notEqual(result.result.isError, true)
    if (name === 'hypertask_describe_tool') {
      assert.equal(result.result.structuredContent.inputSchema.oneOf.length, Object.keys(definitions.find((tool) => tool.name === 'hypertask_tasks').actions).length)
      assert.ok(result.result.structuredContent.outputSchema.required.includes('data'))
    }
  }
  const described = await rpc(tools, 'tools/call', { name: 'hypertask_describe_tool', arguments: { name: 'hypertask_list_tasks' } })
  assert.notEqual(described.result.isError, true)
  const timer = await rpc(tools, 'tools/call', { name: 'hypertask_time', arguments: { action: 'log', task: 'HTPR-1234', minutes: 25 } })
  assert.notEqual(timer.result.isError, true)
  assert.deepEqual(calls.at(-1).args, { action: 'log', task: 'HTPR-1234', minutes: 25 })
})

test('action dispatch covers every consolidated operation with action-specific parameters', async () => {
  const { calls, tools } = spyTools()
  for (const definition of definitions) {
    const tool = toolNamed(tools, definition.name)
    for (const [index, [name, action]] of Object.entries(definition.actions).entries()) {
      const input = sample(tool.inputSchema.oneOf[index].properties.input)
      const result = await executeToolResult(tool, { action: name, input }, 'fixture-token')
      assert.notEqual(result.isError, true, `${definition.name}/${name}: ${result.content[0].text}`)
      assert.equal(calls.at(-1).name, action.tool)
      if (action.legacy_action) assert.equal(calls.at(-1).args.action, action.legacy_action)
      assert.equal(ajv.validate(tool.outputSchema, result.structuredContent), true, JSON.stringify(ajv.errors))
    }
  }
})

test('description schemas document every parameter and keep four reviewable prose parts', () => {
  for (const tool of visible(selectMcpTools(legacy, true))) {
    const parts = tool.description.split('\n')
    assert.equal(parts.length, 4)
    for (const [index, label] of ['Does:', 'Use when:', 'Do not use when:', 'Parameters and caveats:'].entries()) assert.ok(parts[index].startsWith(label))
    assert.ok(tool.description.length < 1800)
    const description = definitions.find((item) => item.name === tool.name)
    assert.ok(description.does.endsWith('.'))
    assert.ok(fs.existsSync(path.join(root, 'src/lib/mcp-server/config/descriptions', tool.name.slice(10) + '.json')))
    const check = (schema) => {
      if (!schema || typeof schema !== 'object') return
      if (schema.properties) for (const [name, field] of Object.entries(schema.properties)) {
        if (name === 'action' && field.const) continue
        if (name === 'input' && !field.description) continue
        assert.ok(field.description?.length > 5, `${tool.name}: undocumented ${name}`)
      }
      for (const value of Object.values(schema)) Array.isArray(value) ? value.forEach(check) : check(value)
    }
    check(tool.inputSchema)
  }
})

test('nested examples satisfy the advertised schema and dispatch without real mutations', async () => {
  const { tools } = spyTools()
  for (const name of ['hypertask_tasks', 'hypertask_projects']) {
    const tool = toolNamed(tools, name)
    assert.ok(tool.input_examples.length >= 2)
    for (const example of tool.input_examples) {
      assert.equal(ajv.validate(tool.inputSchema, example), true, JSON.stringify(ajv.errors))
      const result = await executeToolResult(tool, example, 'fixture-token')
      assert.notEqual(result.isError, true, result.content[0].text)
    }
  }
})

test('concise response has stable ticket fields; detailed response retains full detail', () => {
  const task = { id: 1234, ticketNumber: 'HTPR-1234', title: 'Checkout', section: 'Review', status: 'Normal', description: 'Full reproduction', sectionId: 42, boardId: 15, assignees: [{ id: 9, displayName: 'QA' }], dueDate: '2026-10-05', link: { url: 'https://example.com' } }
  const text = JSON.stringify({ success: true, tasks: [task] })
  const concise = JSON.parse(formatToolResponse(text, 'concise', true, 20, 0, true))
  assert.deepEqual(Object.keys(concise.data.tasks[0]).sort(), ['assignee', 'due', 'id', 'status', 'ticket', 'title'])
  assert.equal(concise.data.tasks[0].ticket, 'HTPR-1234')
  assert.equal(concise.data.tasks[0].status, 'Review')
  const detailed = JSON.parse(formatToolResponse(text, 'detailed', true, 20, 0, true))
  assert.deepEqual(detailed.data.tasks[0], task)
  assert.equal(ajv.validate(visible(selectMcpTools(legacy, true))[0].outputSchema, detailed), true)
  assert.equal(ajv.validate(visible(selectMcpTools(legacy, true))[0].outputSchema, { wrong: true }), false)
})

test('detailed reads preserve complete JSON documents independently of collection limits and offsets', () => {
  const document = { type: 'doc', attrs: { labels: Array.from({ length: 30 }, (_, id) => `Document label ${id}`) }, content: Array.from({ length: 30 }, (_, paragraph) => ({
    type: 'paragraph', content: Array.from({ length: 25 }, (_, word) => ({
      type: 'text', text: `Paragraph ${paragraph}, word ${word}`, marks: [{ type: 'bold' }],
    })),
  })) }
  for (const source of [
    { page: { id: 1, title: 'Full document', content: document } },
    { tasks: [{ id: 1, title: 'Full task', descriptionJson: document }] },
    { versions: [{ id: 1, content: document.content }] },
  ]) {
    for (const serverPaginated of [false, true]) {
      const result = JSON.parse(formatToolResponse(JSON.stringify(source), 'detailed', true, 20, 0, serverPaginated))
      assert.deepEqual(result.data, source)
      assert.equal(result.pagination.has_more, false)
      assert.equal(result.pagination.truncated, undefined)
      assert.equal(result.pagination.guidance, undefined)
    }
  }
  const page = { page: { id: 1, content: document } }
  const offset = JSON.parse(formatToolResponse(JSON.stringify(page), 'detailed', true, 1, 10, false))
  assert.deepEqual(offset.data, page)
})

test('detailed page dispatch bounds result collections without truncating their document nodes', async () => {
  const document = { type: 'doc', content: Array.from({ length: 30 }, (_, id) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${id}` }] })) }
  const pages = Array.from({ length: 25 }, (_, id) => ({ id, title: `Page ${id}`, content: document }))
  const tools = selectMcpTools(legacy.map((tool) => ({ ...tool, execute: async () => JSON.stringify({ pages }) })), true)
  const result = await rpc(tools, 'tools/call', { name: 'hypertask_pages', arguments: {
    action: 'list', input: { project_id: 15 }, response_format: 'detailed', limit: 20, offset: 2,
  } })
  assert.notEqual(result.result.isError, true)
  const output = result.result.structuredContent
  assert.deepEqual(output, JSON.parse(result.result.content[0].text))
  assert.deepEqual(output.data.pages, pages.slice(2, 22))
  assert.equal(output.pagination.has_more, true)
  assert.equal(output.pagination.next_offset, 22)
  assert.equal(output.pagination.truncated, true)
})

test('read limits preserve non-collection arrays such as decision options and view filter payloads', () => {
  const values = Array.from({ length: 30 }, (_, id) => `Value ${id}`)
  const source = { decision_request: { id: 1, options: values }, view: { addedFilters: [{ searchPayload: values }] } }
  const result = JSON.parse(formatToolResponse(JSON.stringify(source), 'detailed', true, 20, 10, false))
  assert.deepEqual(result.data, source)
  assert.equal(result.pagination.has_more, false)
  assert.equal(result.pagination.truncated, undefined)
})

test('concise response retains semantic evidence, source identifiers and ticket tree relationships', () => {
  const source = { documents: [{ type: 'comment', taskId: 1234, commentId: 99, projectId: 15, ticketNumber: 'HTPR-1234', title: 'Checkout', content: 'Retries share the idempotency key.', uniqueIndex: 1234 }] }
  const semantic = JSON.parse(formatToolResponse(JSON.stringify(source), 'concise', true, 20, 0, false))
  assert.equal(semantic.data.documents[0].text, source.documents[0].content)
  assert.equal(semantic.data.documents[0].comment_id, 99)
  assert.equal(semantic.data.documents[0].project_id, 15)
  assert.equal(semantic.data.documents[0].uniqueIndex, undefined)
  const article = { articles: [{ title: 'Moving tickets', url: 'https://example.com/help/move', content: 'How to move a ticket. '.repeat(200) }] }
  const help = JSON.parse(formatToolResponse(JSON.stringify(article), 'concise', true, 20, 0, false))
  assert.equal(help.data.articles[0].text.length, 2000)
  assert.equal(help.data.articles[0].truncated, true)
  assert.match(help.data.articles[0].guidance, /response_format=detailed/)
  const full = JSON.parse(formatToolResponse(JSON.stringify(article), 'detailed', true, 20, 0, false))
  assert.equal(full.data.articles[0].content, article.articles[0].content)
  const tree = { tree: { id: 1234, ticketNumber: 'HTPR-1234', title: 'Parent', children: Array.from({ length: 30 }, (_, id) => ({ id, ticketNumber: `HTPR-${id}`, title: 'Child', relationType: 'BlockedBy' })) } }
  const concise = JSON.parse(formatToolResponse(JSON.stringify(tree), 'concise', true, 20, 0, false))
  assert.equal(concise.data.tree.children.length, 20)
  assert.equal(concise.data.tree.children[0].relationType, 'BlockedBy')
  assert.equal(concise.pagination.truncated, true)
  assert.equal(concise.pagination.next_offset, undefined)
  assert.equal(concise.pagination.has_more, false)
  assert.match(concise.pagination.guidance, /nested collections/)
})

test('response dispatcher forwards filters, renamed parameters and supported pagination without exceeding endpoint limits', async () => {
  const { calls, tools } = spyTools()
  await executeToolResult(toolNamed(tools, 'hypertask_tasks'), { action: 'list', input: { project_id: 15, cursor: 'cursor-example', filter: { section: 'Review' } }, limit: 5, offset: 7 }, 'fixture-token')
  assert.equal(calls.at(-1).args.limit, 5)
  assert.equal(calls.at(-1).args.offset, 7)
  assert.equal(calls.at(-1).args.cursor, 'cursor-example')
  assert.deepEqual(calls.at(-1).args.filter, { section: 'Review' })
  await executeToolResult(toolNamed(tools, 'hypertask_search'), { action: 'help', input: { query: 'checkout' } }, 'fixture-token')
  assert.equal(calls.at(-1).args.limit, 6)
  const viewId = '00000000-0000-4000-8000-000000000001'
  await executeToolResult(toolNamed(tools, 'hypertask_views'), { action: 'get', input: { view_id: viewId } }, 'fixture-token')
  assert.equal(calls.at(-1).args.viewId, viewId)
  assert.equal(calls.at(-1).args.view_id, undefined)
  const invalid = await executeToolResult(toolNamed(tools, 'hypertask_views'), { action: 'get', input: { view_id: -1 } }, 'fixture-token')
  assert.equal(invalid.isError, true)
  assert.match(invalid.content[0].text, /input.view_id/)
})

test('read limits still bound resource collections and nested ticket relationships in both formats', () => {
  const rows = Array.from({ length: 30 }, (_, id) => ({ id, title: `Resource ${id}` }))
  for (const format of ['concise', 'detailed']) {
    for (const key of ['items', 'tasks', 'projects', 'pages', 'versions', 'comments', 'documents', 'customFields', 'decision_requests', 'entries', 'user_notifications', 'agent_notifications', 'agent_invocations']) {
      const result = JSON.parse(formatToolResponse(JSON.stringify({ [key]: rows }), format, true, 20, 5, false))
      assert.equal(result.data[key].length, 20, `${format}/${key}`)
      assert.equal(result.data[key][0].id, 5)
      assert.equal(result.pagination.has_more, true)
      assert.equal(result.pagination.next_offset, 25)
    }
    const raw = JSON.parse(formatToolResponse(JSON.stringify(rows), format, true, 20, 5, false))
    assert.equal(raw.data.length, 20)
    assert.equal(raw.data[0].id, 5)
    const nested = JSON.parse(formatToolResponse(JSON.stringify({ tree: { id: 1, children: rows } }), format, true, 20, 5, false))
    assert.equal(nested.data.tree.children.length, 20)
    assert.equal(nested.data.tree.children[0].id, 0)
    assert.equal(nested.pagination.has_more, false)
    assert.equal(nested.pagination.truncated, true)
    assert.equal(nested.pagination.next_offset, undefined)
  }
})

test('pagination bounds reads, preserves cursor continuation and guides targeted searches', () => {
  const text = JSON.stringify({ tasks: Array.from({ length: 60 }, (_, id) => ({ id, title: 'Fixture', section: 'Todo' })), nextCursor: 'cursor-example' })
  const first = JSON.parse(formatToolResponse(text, 'concise', true, 20, 0, false))
  assert.equal(first.data.tasks.length, 20)
  assert.equal(first.pagination.has_more, true)
  assert.equal(first.pagination.next_offset, 20)
  assert.equal(first.pagination.next_cursor, 'cursor-example')
  assert.match(first.pagination.guidance, /small, targeted searches/)
  const second = JSON.parse(formatToolResponse(text, 'detailed', true, 20, 20, false))
  assert.equal(second.data.tasks[0].id, 20)
  const server = JSON.parse(formatToolResponse(text, 'detailed', true, 20, 20, true))
  assert.equal(server.data.tasks[0].id, 0)
  const receipt = JSON.parse(formatToolResponse(text, 'concise', false, 20, 0, false))
  assert.equal(receipt.data.tasks.length, 60)
  assert.equal(receipt.response_format, 'detailed')
})

test('validation and execution errors are actionable tool errors, not protocol errors or tracebacks', async () => {
  const tools = selectMcpTools(legacy, true)
  for (const args of [{ action: 'create', input: {} }, { action: 'bogus' }, { action: 'get', limit: 1000 }, { action: 'update', input: { unique_index: 1234, title: 'Fixture' } }]) {
    const result = await rpc(tools, 'tools/call', { name: 'hypertask_tasks', arguments: args })
    assert.equal(result.error, undefined)
    assert.equal(result.result.isError, true)
    assert.match(result.result.content[0].text, /Change|pass the project id|Check/)
  }
  const timer = await rpc(tools, 'tools/call', { name: 'hypertask_time', arguments: { action: 'log' } })
  assert.equal(timer.result.isError, true)
  assert.match(timer.result.content[0].text, /task.*required/)
  for (const result of ['Error: minutes is required for action=log', '{"success":false,"error":"project_id is required"}', '{"error":"Unknown action"}']) {
    const tool = { name: 'fixture', parameters: z.object({}), outputSchema: {}, execute: async () => result }
    const error = await executeToolResult(tool, {}, 'fixture-token')
    assert.equal(error.isError, true)
    assert.match(error.content[0].text, /Check/)
  }
  assert.match(actionableToolError({ code: -32003 }), /required scope/)
  assert.match(actionableToolError({ code: -32004 }), /Check the identifier/)
  assert.match(actionableToolError({ httpStatus: 429 }), /Wait/)
  assert.equal(actionableToolError(new Error('Prisma exception: private stack')).includes('Prisma'), false)
  assert.equal(actionableToolError(new Error('invalid Bearer fixture-secret')).includes('fixture-secret'), false)
})

test('response errors preserve partial upload receipts without echoing internal failure text', async () => {
  const receipt = { success: false, attachment_status: 'partial', attachments: [{ id: 12, fileName: 'kept.txt' }], failed_files: [{ index: 1, filename: 'retry.txt', error: 'Prisma exception: internal detail' }], error: 'Prisma exception: internal detail', retry_note: 'Retry only failed_files; do not repeat stored files.' }
  const envelope = formatToolResponse(JSON.stringify(receipt), 'concise', false, 20, 0, false)
  const tool = { parameters: z.object({}), outputSchema: visible(selectMcpTools(legacy, true))[0].outputSchema, execute: async () => envelope }
  const result = await executeToolResult(tool, {}, 'fixture-token')
  assert.equal(result.isError, true)
  assert.deepEqual(result.structuredContent.data.attachments, receipt.attachments)
  assert.equal(result.structuredContent.data.failed_files[0].index, 1)
  assert.match(result.structuredContent.data.retry_note, /do not repeat stored files/)
  assert.equal(JSON.stringify(result).includes('Prisma'), false)
  assert.equal(ajv.validate(tool.outputSchema, result.structuredContent), true)
})

test('response SSE binding uses the same hidden aliases, output schemas and actionable errors', async () => {
  const handlers = new Map()
  const server = { server: { setRequestHandler: (schema, handler) => handlers.set(schema.shape.method.value, handler) } }
  const { tools, calls } = spyTools()
  bindConsolidatedSseTools(server, tools, 'session-fixture')
  assert.equal((await handlers.get('tools/list')()).tools.length, definitions.length)
  const result = await handlers.get('tools/call')({ params: { name: 'hypertask_create_task', arguments: { project_id: 15, title: 'Fixture' } } }, { authInfo: { token: 'fixture-token' }, requestId: 9 })
  assert.notEqual(result.isError, true)
  assert.equal(calls.at(-1).invocation.sessionId, 'session-fixture')
  const failed = await handlers.get('tools/call')({ params: { name: 'hypertask_tasks', arguments: { action: 'create' } } }, { authInfo: { token: 'fixture-token' }, requestId: 10 })
  assert.equal(failed.isError, true)
  handlers.clear()
  bindConsolidatedSseTools(server, legacy, 'off-session')
  assert.equal(handlers.size, 0)
})

test('golden tasks are 20 to 30 realistic data-only tasks with valid consolidated calls', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/mcp-6804/golden-tasks.json')))
  assert.ok(golden.tasks.length >= 20 && golden.tasks.length <= 30)
  assert.equal(new Set(golden.tasks.map((task) => task.id)).size, golden.tasks.length)
  const tools = selectMcpTools(legacy, true)
  for (const task of golden.tasks) {
    assert.ok(task.prompt.length > 25)
    assert.ok(task.fixture && task.assertions.length >= 2)
    for (const call of task.expected_calls) {
      const tool = toolNamed(tools, call.tool)
      assert.ok(tool, call.tool)
      const { tool: name, ...args } = call
      assert.equal(ajv.validate(tool.inputSchema, args), true, `${task.id}/${name}: ${JSON.stringify(ajv.errors)}`)
    }
  }
})

test('inventory documentation covers every legacy tool and explains missing usage data and ownership', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/mcp-tools.md'), 'utf8')
  for (const tool of legacy) assert.ok(doc.includes('`' + tool.name + '`'), tool.name)
  assert.match(doc, /30-day/)
  assert.match(doc, /stderr/)
  assert.match(doc, /6478/)
  assert.match(doc, /6505/)
  assert.match(doc, /6506/)
  assert.match(doc, /Owner \+ QA/)
})
