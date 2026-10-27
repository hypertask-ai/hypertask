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

test('identical ticket_number and task_number dispatch only ticket_number', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7900', task_number: 'HTPR-7900' } }, 'fixture-token'))
  assert.deepEqual(calls, [{ ticket_number: 'HTPR-7900' }])
  assert.equal(Object.hasOwn(calls[0], 'task_number'), false)
  assert.equal(result.data.tasks[0].ticket, 'HTPR-7900')
})

test('a bare task_number matches a prefixed ticket_number without replacing it', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7900', task_number: '7900' } }, 'fixture-token'))
  assert.deepEqual(calls, [{ ticket_number: 'HTPR-7900' }])
  assert.equal(Object.hasOwn(calls[0], 'task_number'), false)
  assert.equal(result.data.tasks[0].ticket, 'HTPR-7900')
})

test('task_number ignores prefix case and leading numeric zeroes', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7900', task_number: 'htpr-07900' } }, 'fixture-token'))
  assert.deepEqual(calls, [{ ticket_number: 'HTPR-7900' }])
  assert.equal(Object.hasOwn(calls[0], 'task_number'), false)
  assert.equal(result.data.tasks[0].ticket, 'HTPR-7900')
})

test('different ticket prefixes are refused at input.task_number with both values', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7900', task_number: 'YPER4-7900' } }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.equal(error.issues.length, 1)
    assert.equal(error.issues[0].code, 'custom')
    assert.deepEqual(error.issues[0].path, ['input', 'task_number'])
    assert.match(error.issues[0].message, /^Pass either ticket_number or task_number, not both with different values: 'HTPR-7900' and 'YPER4-7900'\.$/)
    return true
  })
  assert.equal(calls.length, 0)
})

test('different ticket numbers are refused at input.task_number with both values', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { ticket_number: 'HTPR-7900', task_number: '7901' } }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.equal(error.issues.length, 1)
    assert.equal(error.issues[0].code, 'custom')
    assert.deepEqual(error.issues[0].path, ['input', 'task_number'])
    assert.match(error.issues[0].message, /^Pass either ticket_number or task_number, not both with different values: 'HTPR-7900' and '7901'\.$/)
    return true
  })
  assert.equal(calls.length, 0)
})

test('ticket_number alone and task_number alone retain their dispatch and response', async () => {
  for (const input of [{ ticket_number: 'HTPR-7900' }, { task_number: 'HTPR-7900' }]) {
    const { calls, tasks } = spyTasks()
    const result = JSON.parse(await tasks.execute({ action: 'list', input }, 'fixture-token'))
    assert.deepEqual(calls, [{ ticket_number: 'HTPR-7900' }])
    assert.equal(Object.hasOwn(calls[0], 'task_number'), false)
    assert.equal(result.data.tasks[0].ticket, 'HTPR-7900')
  }
})

test('task_number remains a strict-schema error when the alias flag is disabled', async () => {
  const { calls, tasks } = spyTasks(false)
  await assert.rejects(tasks.execute({ action: 'list', input: { task_number: 'HTPR-7900' } }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.equal(error.issues.length, 1)
    assert.equal(error.issues[0].code, 'unrecognized_keys')
    assert.deepEqual(error.issues[0].path, ['input'])
    assert.deepEqual(error.issues[0].keys, ['task_number'])
    return true
  })
  assert.equal(calls.length, 0)
})
