const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { root, loader, sample } = require('./htpr-6927-fixtures.cjs')

const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
stub('src/lib/prisma.ts', { __esModule: true, default: {} })
stub('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { actAsAgentContext, ActAsAgentError } = jiti(path.join(root, 'src/lib/mcp/agents/actAs.ts'))
const { ManagementService } = jiti(path.join(root, 'src/lib/mcp-server/lib/services/management.service.ts'))
const { MCP_TOOLS } = jiti(path.join(root, 'src/lib/mcp-server/tools/index.ts'))
const { resolvePortableTools } = jiti(path.join(root, 'src/lib/mcp-server/listQueryContract.ts'))

const CLAUDE = '2f272c9b-a338-4a0b-95c9-1540ccbea957'
const OTHER = '85b985ac-afe8-41a3-a1ac-d9549a9310c7'
const valentin = { user: { id: 6, email: 'valentin.yeo@gmail.com' }, agentId: null }

function database(agents) {
  const seen = []
  return {
    seen,
    agent: {
      async findFirst({ where }) {
        seen.push(where)
        const agent = agents.find((row) => row.id === where.id && row.userId === where.userId && !row.revoked && !row.archived)
        return agent ? { id: agent.id, runtimeGeneration: 4, permissions: { role: agent.role ?? 'write' }, members: agent.boards.map((projectId) => ({ projectId })) } : null
      },
    },
  }
}

const owned = () => database([
  { id: CLAUDE, userId: 6, boards: [15] },
  { id: OTHER, userId: 7, boards: [15] },
])

test('a person acting as their own agent on its board gets the agent identity', async () => {
  const db = owned()
  const ctx = await actAsAgentContext(db, valentin, { agentId: CLAUDE, projectIds: [15], write: true, requireBoard: true })
  assert.deepEqual(ctx, { user: valentin.user, agentId: CLAUDE, agentRuntimeGeneration: 4 })
  assert.deepEqual(db.seen[0], { id: CLAUDE, userId: 6, revokedAt: null, archivedAt: null })
})

test('still allowed: inbox reads need ownership but no board', async () => {
  const ctx = await actAsAgentContext(owned(), valentin, { agentId: CLAUDE, projectIds: [], write: false, requireBoard: false })
  assert.equal(ctx.agentId, CLAUDE)
})

test('still allowed: a read-role agent can read as itself', async () => {
  const db = database([{ id: CLAUDE, userId: 6, boards: [15], role: 'read' }])
  const ctx = await actAsAgentContext(db, valentin, { agentId: CLAUDE, projectIds: [15], write: false, requireBoard: true })
  assert.equal(ctx.agentId, CLAUDE)
})

test('now refused: as_agent with an agent the caller does not own', async () => {
  await assert.rejects(
    actAsAgentContext(owned(), valentin, { agentId: OTHER, projectIds: [15], write: true, requireBoard: true }),
    (error) => error instanceof ActAsAgentError && /not an active agent you own/.test(error.message),
  )
})

test('now refused: as_agent with an owned agent that is not on the ticket board', async () => {
  await assert.rejects(
    actAsAgentContext(owned(), valentin, { agentId: CLAUDE, projectIds: [339], write: true, requireBoard: true }),
    /not a member of board 339/,
  )
})

test('now refused: a move to a board the agent is not on', async () => {
  await assert.rejects(
    actAsAgentContext(owned(), valentin, { agentId: CLAUDE, projectIds: [15, 339], write: true, requireBoard: true }),
    /board 339/,
  )
})

test('now refused: revoked or archived agents, agent and management credentials, read-role writes and missing boards', async () => {
  const gone = database([{ id: CLAUDE, userId: 6, boards: [15], revoked: true }])
  await assert.rejects(actAsAgentContext(gone, valentin, { agentId: CLAUDE, projectIds: [15], write: true, requireBoard: true }), /not an active agent/)
  await assert.rejects(actAsAgentContext(owned(), { ...valentin, agentId: OTHER }, { agentId: CLAUDE, projectIds: [15], write: true, requireBoard: true }), /agent credential cannot act/)
  await assert.rejects(actAsAgentContext(owned(), { ...valentin, management: { keyId: 'k', permissions: {} } }, { agentId: CLAUDE, projectIds: [15], write: true, requireBoard: true }), /management key/)
  const reader = database([{ id: CLAUDE, userId: 6, boards: [15], role: 'read' }])
  await assert.rejects(actAsAgentContext(reader, valentin, { agentId: CLAUDE, projectIds: [15], write: true, requireBoard: true }), /read role/)
  await assert.rejects(actAsAgentContext(owned(), valentin, { agentId: CLAUDE, projectIds: [], write: true, requireBoard: true }), /needs a ticket or board/)
})

function apiClient(agents) {
  const calls = []
  return {
    calls,
    async makeRequest(endpoint, options = {}) {
      calls.push({ endpoint, method: options.method, body: options.body ? JSON.parse(options.body) : undefined })
      if (options.method === 'GET') return { success: true, agents }
      if (options.method === 'POST') return { success: true, agent: { id: 'new-agent', display_name: 'Claude' }, token: 'secret-agent-token', message: 'Store this token' }
      return { success: true }
    },
  }
}

const listed = (id, name, boards, revoked = false) => ({ id, display_name: name, revoked, created_at: '2026-10-21T18:00:00.000Z', boards: boards.map((board) => ({ id: board, name: `Board ${board}` })) })

test('agents ensure returns the same agent on repeat calls without creating one', async () => {
  const client = apiClient([listed(CLAUDE, 'Claude', [15])])
  const service = new ManagementService(client)
  const first = await service.ensureAgent({ display_name: 'claude', project_ids: [15] })
  const second = await service.ensureAgent({ display_name: 'Claude ', project_ids: [15] })
  assert.equal(first.agent.id, CLAUDE)
  assert.equal(second.agent.id, CLAUDE)
  assert.equal(first.created, false)
  assert.deepEqual(client.calls.map((call) => call.method), ['GET', 'GET'])
})

test('agents ensure adds missing boards to the existing agent', async () => {
  const client = apiClient([listed(CLAUDE, 'Claude', [15])])
  const result = await new ManagementService(client).ensureAgent({ display_name: 'Claude', project_ids: [15, 2099] })
  assert.deepEqual(result.added_project_ids, [2099])
  assert.deepEqual(client.calls[1], { endpoint: `/mcp/agents/${CLAUDE}`, method: 'PATCH', body: { add_project_ids: [2099] } })
})

test('agents ensure creates the agent when none is active and never returns its token', async () => {
  const client = apiClient([listed(OTHER, 'Claude', [15], true), listed(CLAUDE, 'Cursor', [15])])
  const result = await new ManagementService(client).ensureAgent({ display_name: 'Claude', project_ids: [15] })
  assert.equal(result.created, true)
  assert.equal(result.agent.id, 'new-agent')
  assert.equal(JSON.stringify(result).includes('secret-agent-token'), false)
  assert.deepEqual(client.calls[1], { endpoint: '/mcp/admin/agents', method: 'POST', body: { display_name: 'Claude', project_ids: [15], role: 'write' } })
})

const legacy = resolvePortableTools(MCP_TOOLS).map((tool) => ({ ...tool, execute: async (args) => JSON.stringify({ name: tool.name, args }) }))
const acted = []
const load = loader({
  '@/lib/mcp/auth': { extractBearerToken: (header) => header?.replace(/^Bearer /, '') },
  './utils/actAsAgent': { runAsAgent: async (token, request, run) => { acted.push({ token, ...request }); return run() } },
})
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const toolNamed = (tools, name) => tools.find((tool) => tool.name === name)
const actionInput = (tool, action) => tool.inputSchema.oneOf.find((variant) => variant.properties.action.const === action).properties.input

test('as_agent is advertised only on supported actions and only when the flag is on', () => {
  const off = toolNamed(selectMcpTools(legacy, true, {}), 'hypertask_comments')
  assert.equal(actionInput(off, 'add').properties.as_agent, undefined)
  const on = selectMcpTools(legacy, true, { actAsAgent: true })
  assert.equal(actionInput(toolNamed(on, 'hypertask_comments'), 'add').properties.as_agent.format, 'uuid')
  assert.ok(actionInput(toolNamed(on, 'hypertask_inbox'), 'list').properties.as_agent)
  assert.ok(actionInput(toolNamed(on, 'hypertask_tasks'), 'update').properties.as_agent)
  assert.equal(actionInput(toolNamed(on, 'hypertask_inbox'), 'move_task').properties.as_agent, undefined)
  assert.equal(actionInput(toolNamed(on, 'hypertask_decisions'), 'answer').properties.as_agent, undefined)
})

test('as_agent routes the call through the agent identity with board checks for comments', async () => {
  acted.length = 0
  const comments = toolNamed(selectMcpTools(legacy, true, { actAsAgent: true }), 'hypertask_comments')
  const input = { ...sample(actionInput(comments, 'add')), ticket_number: 'HTPR-7529', text: 'On it', as_agent: CLAUDE }
  const result = JSON.parse(await comments.execute({ action: 'add', input }, 'fixture-token'))
  assert.equal(result.data.args.as_agent, undefined)
  assert.equal(acted.length, 1)
  assert.equal(acted[0].agentId, CLAUDE)
  assert.equal(acted[0].write, true)
  assert.equal(acted[0].requireBoard, true)
  assert.equal(acted[0].input.ticket_number, 'HTPR-7529')
})

test('inbox list as an agent checks ownership only', async () => {
  acted.length = 0
  const inbox = toolNamed(selectMcpTools(legacy, true, { actAsAgent: true }), 'hypertask_inbox')
  await inbox.execute({ action: 'list', input: { as_agent: CLAUDE } }, 'fixture-token')
  assert.equal(acted[0].requireBoard, false)
  assert.equal(acted[0].write, false)
})

test('now refused: as_agent when the flag is off, on unsupported actions, or not a UUID', async () => {
  acted.length = 0
  const off = toolNamed(selectMcpTools(legacy, true, {}), 'hypertask_comments')
  await assert.rejects(off.execute({ action: 'add', input: { ticket_number: 'HTPR-7529', text: 'x', as_agent: CLAUDE } }, 'fixture-token'), /as_agent is not supported/)
  const on = selectMcpTools(legacy, true, { actAsAgent: true })
  await assert.rejects(toolNamed(on, 'hypertask_decisions').execute({ action: 'answer', input: { decision_request_id: 1, selected_option: 'Yes', as_agent: CLAUDE } }, 'fixture-token'), /as_agent is not supported/)
  await assert.rejects(toolNamed(on, 'hypertask_comments').execute({ action: 'add', input: { ticket_number: 'HTPR-7529', text: 'x', as_agent: 'Claude' } }, 'fixture-token'))
  assert.equal(acted.length, 0)
})

test('still allowed: calls without as_agent never touch the act-as path', async () => {
  acted.length = 0
  const comments = toolNamed(selectMcpTools(legacy, true, { actAsAgent: true }), 'hypertask_comments')
  await comments.execute({ action: 'add', input: { ticket_number: 'HTPR-7529', text: 'Human reply' } }, 'fixture-token')
  assert.equal(acted.length, 0)
})
