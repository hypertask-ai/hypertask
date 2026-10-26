const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { z } = require('zod')
const root = path.resolve(__dirname, '..')
const stubModule = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
stubModule('src/lib/prisma.ts', { __esModule: true, default: {
  featureFlag: { findUnique: async () => null },
  user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? 'valentin.yeo@gmail.com' : where.id === 985 ? 'valentin@hypertask.ai' : 'member@example.com' }) },
} })
stubModule('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null })
stubModule('src/lib/mcp/auth.ts', {
  extractBearerToken: (header) => header?.replace(/^Bearer /, ''),
  validateMcpAuth: async () => ({ user: { id: 985 }, agentId: null }),
})
stubModule('src/lib/telemetry/mcpSseAnalytics.ts', { recordLegacyMcpRequest: () => {} })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const load = (file) => jiti(path.join(root, file))
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const { executeToolResult } = load('src/lib/mcp-server/tool-response.ts')

function spyTasks({ inputWrapperFields = true, topLevelInputFields = true } = {}) {
  const calls = []
  const listTool = {
    name: 'hypertask_list_tasks',
    description: 'List tasks.',
    parameters: z.object({
      ticket_number: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
    }).strict(),
    execute: async (args) => {
      calls.push({ tool: 'list', args })
      return JSON.stringify({ tasks: [{ id: 1, ticket: args.ticket_number ?? null }] })
    },
  }
  const getTool = {
    name: 'hypertask_get_tasks',
    description: 'Get tasks.',
    parameters: z.object({ ticket_number: z.string().optional() }).strict(),
    execute: async (args) => {
      calls.push({ tool: 'get', args })
      return JSON.stringify({ tasks: [{ id: 1, ticket: args.ticket_number ?? null }] })
    },
  }
  const tools = selectMcpTools([listTool], true, {}, false, false, false, false, topLevelInputFields, inputWrapperFields)
  const getOnly = selectMcpTools([getTool], true, {}, false, false, false, false, topLevelInputFields, inputWrapperFields)
  return {
    calls,
    tasks: tools.find((tool) => tool.name === 'hypertask_tasks'),
    getTasks: getOnly.find((tool) => tool.name === 'hypertask_tasks'),
  }
}

async function call(tool, args) {
  const result = await executeToolResult(tool, args, 'fixture-token')
  return { result, body: result.isError ? null : JSON.parse(result.content[0].text) }
}

test('response_format inside input reaches the call level', async () => {
  const { calls, tasks } = spyTasks()
  const { result, body } = await call(tasks, { action: 'list', input: { ticket_number: 'HTPR-7917', response_format: 'detailed' } })
  assert.equal(result.isError, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.ticket_number, 'HTPR-7917')
  assert.equal(Object.hasOwn(calls[0].args, 'response_format'), false)
  assert.equal(body.response_format, 'detailed')
})

test('limit and offset inside input reach the call level on an action that does not document them', async () => {
  const { calls, getTasks } = spyTasks()
  const { result } = await call(getTasks, { action: 'get', input: { ticket_number: 'HTPR-7917', limit: 3, offset: 2 } })
  assert.equal(result.isError, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.ticket_number, 'HTPR-7917')
  assert.equal(Object.hasOwn(calls[0].args, 'limit'), false)
  assert.equal(Object.hasOwn(calls[0].args, 'offset'), false)
})

test('a field the action documents inside input stays inside and keeps its page size', async () => {
  const { calls, tasks } = spyTasks()
  const { result } = await call(tasks, { action: 'list', input: { ticket_number: 'HTPR-7917', limit: 5, offset: 4 } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].args.limit, 5)
  assert.equal(calls[0].args.offset, 4)
})

test('the same wrapper in both places with the same value is accepted', async () => {
  const { calls, tasks } = spyTasks()
  const { result } = await call(tasks, { action: 'list', response_format: 'concise', input: { ticket_number: 'HTPR-7917', response_format: 'concise' } })
  assert.equal(result.isError, undefined)
  assert.equal(calls.length, 1)
})

test('the same wrapper in both places with different values is refused', async () => {
  const { calls, tasks } = spyTasks()
  const { result } = await call(tasks, { action: 'list', response_format: 'concise', input: { ticket_number: 'HTPR-7917', response_format: 'detailed' } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Pass response_format inside input or at the top level, not both with different values/)
  assert.equal(calls.length, 0)
})

test('with the fix off a wrapper inside input is refused as before', async () => {
  const { calls, tasks } = spyTasks({ inputWrapperFields: false, topLevelInputFields: false })
  const { result } = await call(tasks, { action: 'list', input: { ticket_number: 'HTPR-7917', response_format: 'detailed' } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields response_format/)
  assert.equal(calls.length, 0)
})

test('a documented field at the top level still works with both placements on', async () => {
  const { calls, tasks } = spyTasks()
  const { result } = await call(tasks, { action: 'list', ticket_number: 'HTPR-7917' })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].args.ticket_number, 'HTPR-7917')
})

test('an unknown field inside input is still refused', async () => {
  const { calls, tasks } = spyTasks()
  const { result } = await call(tasks, { action: 'list', input: { ticket_number: 'HTPR-7917', zzzznotafield: 1 } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields zzzznotafield/)
  assert.equal(calls.length, 0)
})
