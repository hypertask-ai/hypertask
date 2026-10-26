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

function spyTasks(taskNumberAlias = true, { ticketNumber = true } = {}) {
  const calls = []
  const tools = selectMcpTools([{
    name: 'hypertask_list_tasks',
    description: 'List tasks.',
    parameters: z.object({
      project_id: z.number().optional(),
      task_id: z.string().optional(),
      ...(ticketNumber ? { ticket_number: z.string().optional() } : {}),
    }).strict(),
    execute: async (args) => {
      calls.push(args)
      return JSON.stringify({ tasks: [{ id: 1, ticket: args.ticket_number ?? null }] })
    },
  }], true, {}, false, false, taskNumberAlias)
  return { calls, tasks: tools.find((tool) => tool.name === 'hypertask_tasks') }
}

test('task_number is accepted as an alias for ticket_number', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { task_number: 'HTPR-7889' } }, 'fixture-token'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ticket_number, 'HTPR-7889')
  assert.equal(Object.hasOwn(calls[0], 'task_number'), false)
  assert.equal(result.data.tasks[0].ticket, 'HTPR-7889')
})

test('ticket_number keeps working unchanged', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7889' } }, 'fixture-token')
  assert.equal(calls[0].ticket_number, 'HTPR-7889')
})

test('task_number with the same ticket_number is accepted', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7889', task_number: 'HTPR-7889' } }, 'fixture-token')
  assert.equal(calls[0].ticket_number, 'HTPR-7889')
})

test('task_number with a different ticket_number is refused', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7889', task_number: 'HTPR-7000' } }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.match(error.message, /Pass either ticket_number or task_number/)
    return true
  })
  assert.equal(calls.length, 0)
})

test('task_number is still refused on an action with no ticket_number field', async () => {
  const { calls, tasks } = spyTasks(true, { ticketNumber: false })
  await assert.rejects(tasks.execute({ action: 'list', input: { task_number: 'HTPR-7889' } }, 'fixture-token'), /unrecognized_keys|Unrecognized key/)
  assert.equal(calls.length, 0)
})

test('with the alias off task_number is refused as before', async () => {
  const { calls, tasks } = spyTasks(false)
  const result = await executeToolResult(tasks, { action: 'list', input: { task_number: 'HTPR-7889' } }, 'fixture-token')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Remove unsupported fields task_number/)
  assert.equal(calls.length, 0)
})

test('the alias is documented but is not a schema property of its own', () => {
  const { tasks } = spyTasks()
  const variant = tasks.inputSchema.oneOf.find((entry) => entry.properties.action.const === 'list')
  assert.equal(Object.hasOwn(variant.properties.input.properties, 'task_number'), false)
  assert.match(variant.properties.input.properties.ticket_number.description, /task_number is accepted as an alias/)
})
