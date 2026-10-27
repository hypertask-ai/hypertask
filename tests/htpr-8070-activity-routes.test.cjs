const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

function routes(principal) {
  const activity = { id: 'activity-1', runId: 'run-1', type: 'thought', text: 'Working' }
  const stubs = {
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (handler) => handler },
    '@/lib/mcp/tasks/agentMutationFence': { TaskTeamScopeError: class extends Error {} },
    '@/lib/mcp/auth': { checkMcpRateLimit: async () => null },
    '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: (key) => key },
    '@/lib/agentRuns/service': {
      authenticateAgentRunRequest: async () => principal,
      browserMutationIsSameOrigin: (request) => request.headers.get('Origin') === 'https://app.hypertask.ai',
      agentRunActivitiesEnabledFor: () => { throw new Error('Retired flag must not be checked') },
      listAgentRunActivities: async () => [activity],
      createAgentRunActivity: async () => ({ activity, duplicate: false }),
      selectAgentRunActivity: async () => ({ activity, duplicate: false }),
    },
  }
  return {
    activities: load('src/app/api/mcp/agents/runs/[id]/activities/route.ts', stubs),
    selection: load('src/app/api/mcp/agents/runs/[id]/activities/[activityId]/select/route.ts', stubs),
    activity,
  }
}

const params = { params: Promise.resolve({ id: 'run-1', activityId: 'activity-1' }) }
function request(suffix = '', body, origin = 'https://app.hypertask.ai') {
  return new Request(`https://app.hypertask.ai/api/mcp/agents/runs/run-1/activities${suffix}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: origin },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

test('activity read, create and selection no longer consult the rollout flag', async () => {
  const agent = routes({ userId: 985, agentId: 'agent-1', source: 'agent' })
  const read = await agent.activities.GET(request(), params)
  assert.equal(read.status, 200)
  assert.deepEqual(await read.json(), { success: true, activities: [agent.activity] })
  const created = await agent.activities.POST(request('', { type: 'thought', text: 'Working' }), params)
  assert.equal(created.status, 200)
  assert.deepEqual(await created.json(), { success: true, activity: agent.activity, duplicate: false })

  const browser = routes({ userId: 985, agentId: null, source: 'browser' })
  const selected = await browser.selection.POST(request('/activity-1/select', { value: 'yes' }), params)
  assert.equal(selected.status, 200)
  assert.deepEqual(await selected.json(), { success: true, activity: browser.activity, duplicate: false })
})

test('activity routes retain authentication, agent-only writes and same-origin selection', async () => {
  const anonymous = routes(null)
  assert.equal((await anonymous.activities.GET(request(), params)).status, 401)
  assert.equal((await anonymous.activities.POST(request('', { type: 'thought', text: 'Working' }), params)).status, 401)
  assert.equal((await anonymous.selection.POST(request('/activity-1/select', { value: 'yes' }), params)).status, 401)
  const browser = routes({ userId: 985, agentId: null, source: 'browser' })
  assert.equal((await browser.activities.POST(request('', { type: 'thought', text: 'Working' }), params)).status, 403)
  assert.equal((await browser.selection.POST(request('/activity-1/select', { value: 'yes' }, 'https://other.example'), params)).status, 403)
  const agent = routes({ userId: 985, agentId: 'agent-1', source: 'agent' })
  assert.equal((await agent.selection.POST(request('/activity-1/select', { value: 'yes' }), params)).status, 403)
})
