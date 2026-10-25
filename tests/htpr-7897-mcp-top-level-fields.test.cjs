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

function spyTasks(topLevelInputFields = true, { ticketNumber = true } = {}) {
  const calls = []
  const tools = selectMcpTools([{
    name: 'hypertask_list_tasks',
    description: 'List tasks.',
    parameters: z.object({
      project_id: z.number().optional(),
      ...(ticketNumber ? { ticket_number: z.string().optional() } : {}),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
    }).strict(),
    execute: async (args) => {
      calls.push(args)
      return JSON.stringify({ tasks: [{ id: 1, ticket: args.ticket_number ?? null }] })
    },
  }], true, {}, false, false, false, false, false, topLevelInputFields)
  return { calls, tasks: tools.find((tool) => tool.name === 'hypertask_tasks') }
}

test('a documented field at the top level reaches the tool', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', ticket_number: 'HTPR-7897' }, 'fixture-token'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ticket_number, 'HTPR-7897')
  assert.equal(result.data.tasks[0].ticket, 'HTPR-7897')
})

test('the same field inside input keeps working unchanged', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7897' } }, 'fixture-token')
  assert.equal(calls[0].ticket_number, 'HTPR-7897')
})

test('the field in both places with the same value is accepted', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7897' }, ticket_number: 'HTPR-7897' }, 'fixture-token')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ticket_number, 'HTPR-7897')
})

test('the field in both places with different values is refused', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7897' }, ticket_number: 'HTPR-7000' }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.match(error.message, /Pass ticket_number inside input or at the top level, not both with different values/)
    return true
  })
  assert.equal(calls.length, 0)
})

test('an unknown top-level field is still refused', async () => {
  const { calls, tasks } = spyTasks()
  const result = await executeToolResult(tasks, { action: 'list', zzzznotafield: 'HTPR-7897' }, 'fixture-token')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields zzzznotafield/)
  assert.equal(calls.length, 0)
})

test('a field the action does not document is still refused at the top level', async () => {
  const { calls, tasks } = spyTasks(true, { ticketNumber: false })
  const result = await executeToolResult(tasks, { action: 'list', ticket_number: 'HTPR-7897' }, 'fixture-token')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields ticket_number/)
  assert.equal(calls.length, 0)
})

test('pagination and response_format stay at the top level', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', limit: 5, offset: 4, response_format: 'detailed', ticket_number: 'HTPR-7897' }, 'fixture-token')
  assert.equal(calls[0].limit, 5)
  assert.equal(calls[0].offset, 4)
  assert.equal(calls[0].ticket_number, 'HTPR-7897')
  assert.equal(Object.hasOwn(calls[0], 'response_format'), false)
})

test('with the fix off a top-level documented field is refused as before', async () => {
  const { calls, tasks } = spyTasks(false)
  const result = await executeToolResult(tasks, { action: 'list', ticket_number: 'HTPR-7897' }, 'fixture-token')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields ticket_number/)
  assert.equal(calls.length, 0)
})
