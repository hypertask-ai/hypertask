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
const { getGetCommentsBaseSchema } = load('src/lib/mcp-server/validations/comment.validation.ts')
const { getGetTasksBaseSchema } = load('src/lib/mcp-server/validations/task.validation.ts')

function spyComments({ taskIdTicketReference = true, ticketNumber = z.string(), parameters, name = 'hypertask_get_comments_for_task', resource = 'hypertask_comments' } = {}) {
  const calls = []
  const tools = selectMcpTools([{
    name,
    description: 'Get comments.',
    parameters: parameters ?? z.object({
      task_id: z.union([z.number().int().positive(), z.array(z.number().int().positive())]).optional(),
      ...(ticketNumber ? { ticket_number: ticketNumber.optional() } : {}),
    }).strict(),
    execute: async (args) => {
      calls.push(args)
      return JSON.stringify({ comments: [{ id: 1, ticket: args.ticket_number ?? null, task: args.task_id ?? null }] })
    },
  }], true, {}, false, false, false, false, false, false, false, false, taskIdTicketReference)
  return { calls, tools: tools.find((tool) => tool.name === resource) }
}

async function call(tool, args) {
  const result = await executeToolResult(tool, args, 'fixture-token')
  return { result, body: result.isError ? null : JSON.parse(result.content[0].text) }
}

test('a ticket reference in task_id reaches ticket_number', async () => {
  const { calls, tools } = spyComments()
  const { result, body } = await call(tools, { action: 'list', input: { task_id: 'HTPR-7894' } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
  assert.equal(body.data.comments[0].ticket, 'HTPR-7894')
})

test('a one-item list unwraps when ticket_number takes a single string', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'] } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

test('a list of ticket references reaches ticket_number where it takes a list', async () => {
  const { calls, tools } = spyComments({ ticketNumber: z.union([z.string(), z.array(z.string())]) })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894', 'htpr-7895'] } })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0].ticket_number, ['HTPR-7894', 'HTPR-7895'])
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

test('a list of ticket references is refused where ticket_number takes one string', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894', 'HTPR-7895'] } })
  assert.equal(result.isError, true)
  assert.equal(calls.length, 0)
})

test('a numeric task_id keeps working unchanged', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: 76292 } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].task_id, 76292)
  assert.equal(Object.hasOwn(calls[0], 'ticket_number'), false)
})

test('an explicit ticket_number plus the same ticket in task_id is accepted once', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: 'HTPR-7894', ticket_number: 'HTPR-7894' } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

test('an explicit ticket_number that disagrees with task_id is refused', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: 'HTPR-7894', ticket_number: 'HTPR-7000' } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Pass task_id inside input or at the top level, not both with different values/)
  assert.equal(calls.length, 0)
})

test('with the fix off a ticket reference in task_id is refused as before', async () => {
  const { calls, tools } = spyComments({ taskIdTicketReference: false })
  const { result } = await call(tools, { action: 'list', input: { task_id: 'HTPR-7894' } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /task_id/)
  assert.equal(calls.length, 0)
})

test('a tool without ticket_number keeps refusing the ticket reference', async () => {
  const { calls, tools } = spyComments({ ticketNumber: false })
  const { result } = await call(tools, { action: 'list', input: { task_id: 'HTPR-7894' } })
  assert.equal(result.isError, true)
  assert.equal(calls.length, 0)
})

test('a non-ticket string in task_id is still refused', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: 'not-a-reference' } })
  assert.equal(result.isError, true)
  assert.equal(calls.length, 0)
})

test('the ticket_number validator, not schema text, decides whether a list is accepted', async () => {
  const { calls, tools } = spyComments({ ticketNumber: z.string().describe('array') })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'] } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

test('a one-item list unwraps when an array branch rejects ticket strings', async () => {
  const { calls, tools } = spyComments({ ticketNumber: z.union([z.string(), z.array(z.number())]) })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'] } })
  assert.equal(result.isError, undefined)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
})

test('an array-only ticket_number keeps a one-item list as a list', async () => {
  const { calls, tools } = spyComments({ ticketNumber: z.array(z.string()) })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'] } })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0].ticket_number, ['HTPR-7894'])
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

test('a one-item list and matching explicit ticket_number are accepted once', async () => {
  const { calls, tools } = spyComments()
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'], ticket_number: 'HTPR-7894' } })
  assert.equal(result.isError, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ticket_number, 'HTPR-7894')
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

for (const task_id of ['htpr-7894', [' htpr-7894 ']]) {
  test(`the real comments schema accepts ${JSON.stringify(task_id)} after normalization`, async () => {
    const { calls, tools } = spyComments({ parameters: getGetCommentsBaseSchema() })
    const { result, body } = await call(tools, { action: 'list', input: { task_id } })
    assert.equal(result.isError, undefined)
    assert.equal(calls[0].ticket_number, 'HTPR-7894')
    assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
    assert.equal(body.data.comments[0].ticket, 'HTPR-7894')
  })
}

test('the real task get schema accepts multiple ticket references', async () => {
  const { calls, tools } = spyComments({ parameters: getGetTasksBaseSchema(), name: 'hypertask_get_tasks', resource: 'hypertask_tasks' })
  const { result } = await call(tools, { action: 'get', input: { task_id: ['HTPR-7894', 'htpr-7895'] } })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0].ticket_number, ['HTPR-7894', 'HTPR-7895'])
  assert.equal(Object.hasOwn(calls[0], 'task_id'), false)
})

for (const task_id of [[], ['HTPR-7894', 76292], ['HTPR-7894', 'not-a-reference']]) {
  test(`an invalid task_id list ${JSON.stringify(task_id)} is not converted`, async () => {
    const { calls, tools } = spyComments({ parameters: getGetCommentsBaseSchema() })
    const { result } = await call(tools, { action: 'list', input: { task_id } })
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /task_id/)
    assert.equal(calls.length, 0)
  })
}

test('the real comments schema still refuses more than one ticket', async () => {
  const { calls, tools } = spyComments({ parameters: getGetCommentsBaseSchema() })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894', 'HTPR-7895'] } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /task_id/)
  assert.equal(calls.length, 0)
})

test('numeric task_id lists keep working unchanged', async () => {
  const { calls, tools } = spyComments({ parameters: getGetTasksBaseSchema(), name: 'hypertask_get_tasks', resource: 'hypertask_tasks' })
  const { result } = await call(tools, { action: 'get', input: { task_id: [76292, 76293] } })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0].task_id, [76292, 76293])
  assert.equal(Object.hasOwn(calls[0], 'ticket_number'), false)
})

test('with the fix off the real comments schema refuses a one-item ticket list', async () => {
  const { calls, tools } = spyComments({ taskIdTicketReference: false, parameters: getGetCommentsBaseSchema() })
  const { result } = await call(tools, { action: 'list', input: { task_id: ['HTPR-7894'] } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /task_id/)
  assert.equal(calls.length, 0)
})
