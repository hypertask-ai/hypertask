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

function spyTasks(pageAlias = true) {
  const calls = []
  const rows = Array.from({ length: 60 }, (_, id) => ({ id, title: `Task ${id}` }))
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
  }], true, {}, false, false, pageAlias)
  return { calls, tasks: tools.find((tool) => tool.name === 'hypertask_tasks') }
}

test('page 2 with the offset that matches its start is accepted', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, limit: 5, offset: 5 }, 'fixture-token'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].offset, 5)
  assert.equal(result.pagination.offset, 5)
  assert.equal(result.pagination.next_offset, 10)
  assert.deepEqual(result.data.tasks.map((task) => task.id), [5, 6, 7, 8, 9])
})

test('page 2 with the default page size offset is accepted', async () => {
  const { calls, tasks } = spyTasks()
  const result = JSON.parse(await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, offset: 20 }, 'fixture-token'))
  assert.equal(calls[0].offset, 20)
  assert.equal(result.pagination.offset, 20)
  assert.deepEqual(result.data.tasks.map((task) => task.id), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39])
})

test('page 2 with an agreeing offset inside input is accepted', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { project_id: 15, offset: 5 }, page: 2, limit: 5 }, 'fixture-token')
  assert.equal(calls[0].offset, 5)
})

test('page 2 with an offset that points somewhere else is still refused', async () => {
  const { calls, tasks } = spyTasks()
  for (const fields of [{ offset: 3 }, { offset: 15 }, { input: { project_id: 15, offset: 10 } }, { offset: 15, input: { project_id: 15, offset: 5 } }]) {
    await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, limit: 5, ...fields }, 'fixture-token'), (error) => {
      assert.ok(error instanceof z.ZodError)
      assert.match(error.message, /Pass either page or offset/)
      assert.deepEqual(error.issues[0].path, ['page'])
      return true
    })
  }
  assert.equal(calls.length, 0)
})

test('page one with offset zero keeps working', async () => {
  const { calls, tasks } = spyTasks()
  await tasks.execute({ action: 'list', input: { project_id: 15 }, page: 1, limit: 5, offset: 0 }, 'fixture-token')
  assert.equal(calls[0].offset, 0)
})

test('page with a cursor is still refused', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15, cursor: 'c1' }, page: 2, offset: 20 }, 'fixture-token'), /Pass either page or cursor/)
  assert.equal(calls.length, 0)
})

test('an agreeing offset is refused when the page alias is off', async () => {
  const { calls, tasks } = spyTasks(false)
  assert.equal(Object.hasOwn(tasks.inputSchema.properties, 'page'), false)
  await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15 }, page: 2, offset: 20 }, 'fixture-token'), (error) => {
    assert.deepEqual(error.issues[0].keys, ['page'])
    return true
  })
  assert.equal(calls.length, 0)
})

test('an invalid input limit is still reported on its own field', async () => {
  const { calls, tasks } = spyTasks()
  await assert.rejects(tasks.execute({ action: 'list', input: { project_id: 15, limit: 0 }, page: 2 }, 'fixture-token'), (error) => {
    assert.deepEqual(error.issues[0].path, ['input', 'limit'])
    return true
  })
  assert.equal(calls.length, 0)
})
