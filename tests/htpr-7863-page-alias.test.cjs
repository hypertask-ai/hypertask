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

function spyTasks(pageAlias = true) {
  const calls = []
  const rows = Array.from({ length: 12 }, (_, id) => ({ id, title: `Task ${id}` }))
  const tools = selectMcpTools([{
    name: 'hypertask_list_tasks',
    description: 'List tasks.',
    parameters: z.object({
      project_id: z.number(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
      cursor: z.string().optional(),
    }),
    execute: async (args) => {
      calls.push(args)
      return JSON.stringify({ tasks: rows.slice(args.offset, args.offset + args.limit), has_more: args.offset + args.limit < rows.length })
    },
  }], true, {}, false, pageAlias)
  return { calls, tasks: tools.find((tool) => tool.name === 'hypertask_tasks') }
}

test('the hypertask_tasks schema lists page next to offset', () => {
  const { tasks } = spyTasks()
  const { properties } = tasks.inputSchema
  assert.ok(['number', 'integer'].includes(properties.page?.type))
  assert.equal(properties.page.minimum, 1)
  assert.ok(properties.offset)
  const keys = Object.keys(properties)
  assert.equal(keys.indexOf('page'), keys.indexOf('offset') + 1)
  assert.match(properties.page.description, /1-based page number/)
  for (const page of [0, -1, 1.5]) assert.equal(tasks.parameters.safeParse({ action: 'list', page }).success, false)
})

test('page 2 with limit 5 asks the list tool for offset 5', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, limit: 5 }, 'fixture-token'))
  const captured = calls.at(-1)
  assert.equal(captured.offset, 5)
  assert.ok(captured.limit >= 5)
  assert.equal(result.pagination.offset, 5)
  assert.equal(result.pagination.next_offset, 10)
  assert.deepEqual(result.data.tasks.map(({ id }) => id), [5, 6, 7, 8, 9])
  const beyond = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 100, limit: 5 }, 'fixture-token'))
  assert.equal(calls.at(-1).offset, 495)
  assert.deepEqual(beyond.data.tasks, [])
  assert.equal(beyond.pagination.offset, 495)
  assert.equal(beyond.pagination.has_more, false)
  assert.equal(beyond.pagination.next_offset, undefined)
})

test('page 1 keeps offset 0', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 1, limit: 5 }, 'fixture-token'))
  const captured = calls.at(-1)
  assert.equal(captured.offset, 0)
  assert.equal(result.pagination.offset, 0)
})

test('page and offset together are refused', async () => {
  const { calls, tasks } = spyTasks()
  for (const fields of [{ offset: 3 }, { input: { project_id: 15, offset: 3 } }]) {
    await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, ...fields }, 'fixture-token'), (error) => {
      assert.ok(error instanceof z.ZodError)
      assert.match(error.message, /Pass either page or offset/)
      assert.equal(error.issues.length, 1)
      assert.deepEqual(error.issues[0].path, ['page'])
      return true
    })
  }
  assert.equal(calls.length, 0)
  for (const fields of [{ offset: 0 }, { input: { project_id: 15, offset: 0 } }]) {
    await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, limit: 5, ...fields }, 'fixture-token')
    assert.equal(calls.at(-1).offset, 5)
  }
})

test('page and cursor together are refused', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15, cursor: 'c1' }, page: 2 }, 'fixture-token'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.match(error.message, /Pass either page or cursor/)
    assert.equal(error.issues.length, 1)
    assert.deepEqual(error.issues[0].path, ['page'])
    return true
  })
  assert.equal(calls.length, 0)
})

test('a plain page call no longer reports unrecognized_keys', async () => {
  const { calls, tasks } = spyTasks()
  const result = await executeToolResult(tasks, { action: 'list', input: { project_id: 15 }, page: 2, limit: 5 }, 'fixture-token')
  assert.doesNotMatch(JSON.stringify(result), /unrecognized_keys/)
  assert.notEqual(result.isError, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].offset, 5)
})

test('offset alone still works', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { project_id: 15 }, offset: 7, limit: 5 }, 'fixture-token')
  const captured = calls.at(-1)
  assert.equal(captured.offset, 7)
  await tasks.execute({ action: 'list', input: { project_id: 15, cursor: 'c1' }, offset: 7, limit: 5 }, 'fixture-token')
  assert.equal(calls.at(-1).offset, 0)
  assert.equal(calls.at(-1).cursor, 'c1')
  const result = await executeToolResult(tasks, { action: 'list', input: { project_id: 15 }, limit: 5 }, 'fixture-token')
  assert.notEqual(result.isError, true)
  assert.equal(calls.at(-1).offset, 0)
  await tasks.execute({ action: 'list', input: { project_id: 15, offset: 9 }, offset: 7, limit: 5 }, 'fixture-token')
  assert.equal(calls.at(-1).offset, 9)
})

test('page 2 with an action limit of 5 starts at row 5', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15, limit: 5 }, page: 2 }, 'fixture-token'))
  assert.equal(calls.at(-1).offset, 5)
  assert.equal(calls.at(-1).limit, 5)
  assert.equal(result.pagination.offset, 5)
  assert.equal(result.pagination.next_offset, 10)
  assert.deepEqual(result.data.tasks.map(({ id }) => id), [5, 6, 7, 8, 9])
})

test('page and offset are refused only when the page alias is on', async () => {
  const { calls, tasks } = spyTasks(false)
  assert.equal(Object.hasOwn(tasks.inputSchema.properties, 'page'), false)
  for (const fields of [{}, { offset: 3 }]) {
    await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, ...fields }, 'fixture-token'), (error) => {
      assert.ok(error instanceof z.ZodError)
      assert.equal(error.issues[0].code, 'unrecognized_keys')
      assert.deepEqual(error.issues[0].keys, ['page'])
      return true
    })
  }
  assert.equal(calls.length, 0)
  await tasks.execute({ action: 'list', input: { project_id: 15 }, offset: 7, limit: 5 }, 'fixture-token')
  assert.equal(calls.at(-1).offset, 7)
})
