const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createJiti } = require('jiti')

const root = path.resolve(__dirname, '..')
const calls = []
let ctx, task, rows, rateLimited, dbError
function stub(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
stub('src/lib/mcp/auth.ts', {
  checkMcpRateLimit: async () => rateLimited,
  validateMcpAuth: async () => ctx,
  mcpUnauthorizedResponse: async () => Response.json({ success: false }, { status: 401 }),
})
class TaskIdentifierAmbiguityError extends Error {}
stub('src/lib/mcp/tasks/resolveTask.ts', {
  TaskIdentifierAmbiguityError,
  findTaskByIdentifier: async (...args) => { calls.push(args); return task },
})
stub('src/lib/prisma.ts', {
  agentRunActivity: {
    findMany: async (query) => {
      calls.push(query)
      if (dbError) throw dbError
      return rows.slice(0, query.take)
    },
  },
})
const { GET } = createJiti(__filename, {
  alias: { '@': path.join(root, 'src') }, interopDefault: true,
})(path.join(root, 'src/app/api/mcp/tasks/[taskId]/agent-activity/route.ts'))

function reset() {
  calls.length = 0
  ctx = { user: { id: 6 }, agentId: 'caller-agent' }
  task = { id: 42, projectId: 15 }
  rows = []
  rateLimited = null
  dbError = null
}
function read(id = '42', query = '') {
  return GET({ nextUrl: new URL(`https://app.hypertask.ai/api/mcp/tasks/${id}/agent-activity${query}`) }, {
    params: Promise.resolve({ taskId: id }),
  })
}
function row(n) {
  return {
    runId: `run-${n}`, type: 'THOUGHT', text: `Progress ${n}`,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    run: { agentId: `agent-${n}`, agent: { displayName: `Agent ${n}` } },
  }
}

test('unauthenticated, rate-limited and inaccessible requests never read activity', async () => {
  reset(); ctx = null
  assert.equal((await read()).status, 401)
  assert.equal(calls.length, 0)
  reset(); rateLimited = Response.json({}, { status: 429 })
  assert.equal((await read()).status, 429)
  assert.equal(calls.length, 0)
  reset(); task = null
  assert.equal((await read()).status, 404)
  assert.deepEqual(calls, [[ctx.user, { task_id: 42 }, 'caller-agent']])
})

test('agent read uses task permission helper, not caller run ownership; returns all requested fields', async () => {
  reset(); rows = [row(1), row(2)]
  const response = await read()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(calls[0], [ctx.user, { task_id: 42 }, 'caller-agent'])
  assert.deepEqual(calls[1], {
    where: { run: { taskId: 42 } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20,
    select: {
      runId: true, type: true, text: true, createdAt: true,
      run: { select: { agentId: true, agent: { select: { displayName: true } } } },
    },
  })
  assert.deepEqual((await response.json()).activities, [1, 2].map((n) => ({
    agentId: `agent-${n}`, agentName: `Agent ${n}`, runId: `run-${n}`,
    type: 'thought', text: `Progress ${n}`, createdAt: '2026-10-01T10:00:00.000Z',
  })))
})

test('user tokens use the same task permission helper and empty history succeeds', async () => {
  reset(); ctx.agentId = null
  assert.deepEqual(await (await read()).json(), { success: true, activities: [] })
  assert.deepEqual(calls[0], [ctx.user, { task_id: 42 }, null])
})

test('ticket identifiers resolve with task access; limits default to 20 and cap at 100', async () => {
  reset(); rows = Array.from({ length: 110 }, (_, n) => row(n))
  assert.equal((await (await read('htpr-42')).json()).activities.length, 20)
  assert.deepEqual(calls[0], [ctx.user, { ticket_number: 'HTPR-42' }, 'caller-agent'])
  assert.equal((await (await read('42', '?limit=200')).json()).activities.length, 100)
  assert.equal((await (await read('42', '?limit=1')).json()).activities.length, 1)
})

test('optional claimant filter keeps task access and reads only that agent across its runs', async () => {
  reset()
  assert.equal((await read('42', '?agent_id=claiming-agent&limit=1')).status, 200)
  assert.deepEqual(calls[0], [ctx.user, { task_id: 42 }, 'caller-agent'])
  assert.deepEqual(calls[1].where, { run: { taskId: 42, agentId: 'claiming-agent' } })
  reset()
  assert.equal((await read('42', '?agent_id=')).status, 400)
  assert.equal(calls.length, 1)
})

test('invalid ids and limits are rejected without permission or activity queries', async () => {
  for (const id of ['0', '-1', '1.5', 'NaN', '9007199254740992', '42junk', '']) {
    reset(); assert.equal((await read(id)).status, 400, id); assert.equal(calls.length, 0)
  }
  for (const limit of ['0', '-1', '1.5', 'abc', '', '9007199254740992']) {
    reset(); assert.equal((await read('42', `?limit=${limit}`)).status, 400, limit); assert.equal(calls.length, 0)
  }
})

test('storage failures return no private data', async () => {
  reset(); dbError = new Error('private storage failure')
  const original = console.error
  console.error = () => {}
  try {
    const response = await read()
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { success: false, error: 'Failed to read task agent activity' })
  } finally { console.error = original }
})
