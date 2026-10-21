const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, load } = require('./helpers/agent-cookie-bridge.cjs')

const tuples = [
  ['POST', '/api/tasks/createGlobally'], ['PUT', '/api/tasks/single'],
  ['PUT', '/api/tasks/moveTask'], ['POST', '/api/tasks/(un)archive'],
  ['POST', '/api/tasks/setDueDate'], ['POST', '/api/priority/setPriority'],
  ['POST', '/api/estimate/setEstimate'],
]
const refused = [
  ['GET', '/api/tasks/createGlobally'], ['GET', '/api/tasks/single'], ['DELETE', '/api/tasks/single'],
  ['GET', '/api/app-shell/bootstrap'], ['GET', '/api/mcp/token'], ['POST', '/api/mcp/token'],
  ['POST', '/api/users/api-keys'], ['POST', '/api/cli/generate-code'], ['GET', '/oauth/authorize'],
  ['POST', '/api/pusher/auth'], ['GET', '/api/v1/anything'], ['GET', '/inbox'],
  ['GET', '/detail/project-15/7495.json'], ['POST', '/api/auth/bridge-session'],
  ['GET', '/api/errors'], ['GET', '/developers'], ['GET', '/mcp'], ['GET', '/sse'],
  ['POST', '/message'], ['GET', '/mcp-health'], ['POST', '/oauth/token'],
  ['POST', '/oauth/register'], ['POST', '/oauth/revoke'], ['GET', '/.well-known/oauth-authorization-server'],
  ['GET', '/detail/project-15'], ['GET', '/'],
]

for (const enforce of [false, true]) {
  for (const [method, pathname] of refused) {
    test(`agent refused in ${enforce ? 'ENFORCE' : 'WATCH'}: ${method} ${pathname}, human and absent cookies unchanged`, async () => {
      const h = harness({ enforce })
      for (const bearer of [false, true]) {
        const response = await h.proxy(h.request(pathname, { method, bearer, profile: false }))
        assert.equal(response.status, 403)
        assert.equal(response.headers.has('location'), false)
        if (pathname.startsWith('/api') || ['/mcp', '/sse', '/message', '/mcp-health', '/oauth/token', '/oauth/register', '/oauth/revoke'].includes(pathname) || pathname.startsWith('/.well-known')) {
          assert.deepEqual(await response.json(), { error: 'Agent cookies are only accepted on task bridge routes', code: 'AGENT_COOKIE_ROUTE' })
        } else {
          assert.equal(response.headers.get('content-type')?.startsWith('application/json') ?? false, false)
        }
      }
      for (const kind of ['human', 'none']) {
        const response = await h.proxy(h.request(pathname, { method, kind }))
        assert.notEqual(response.status, 403)
        if (!['/', '/detail/project-15', '/inbox'].includes(pathname) || (pathname === '/inbox' && kind === 'human')) assert.equal(response.headers.get('x-middleware-next'), '1')
      }
      assert.equal(h.captures.length, 1)
      assert.equal(h.calls.flags, 0)
    })
  }
  for (const [method, pathname] of tuples) {
    test(`bridge tuple allowed in ${enforce ? 'ENFORCE' : 'WATCH'}: ${method} ${pathname}`, async () => {
      const h = harness({ enforce })
      const response = await h.proxy(h.request(pathname, { method }))
      assert.equal(response.headers.get('x-middleware-next'), '1')
      assert.deepEqual(h.captures, [])
      assert.equal(h.calls.verify, 1)
    })
  }
}

test('pure decision admits only exact tuples for agents and leaves other principals alone', () => {
  const { AGENT_COOKIE_BRIDGE_ROUTES, isAgentCookieBridgeRequestAllowed: allowed } = load('src/lib/auth/agentCookieBridgeRoutes.ts', {})
  assert.deepEqual(AGENT_COOKIE_BRIDGE_ROUTES, tuples)
  for (const [method, pathname] of tuples) {
    assert.equal(allowed({ agentId: 'a' }, method, pathname), true)
    for (const wrong of ['GET', 'DELETE', 'HEAD', 'OPTIONS', method.toLowerCase()]) assert.equal(allowed({ agentId: 'a' }, wrong, pathname), false)
    for (const suffix of ['/', '.json', '/extra']) assert.equal(allowed({ agentId: 'a' }, method, pathname + suffix), false)
  }
  for (const principal of [null, undefined, { id: 7 }]) assert.equal(allowed(principal, 'DELETE', '/anything'), true)
})

test('human cookie is verified once, absent cookies are not verified, and bearer-only MCP remains allowed', async () => {
  for (const pathname of ['/api/mcp/token', '/api/auth/bridge-session', '/oauth/authorize', '/inbox', '/api/tasks/single']) {
    const h = harness()
    assert.equal((await h.proxy(h.request(pathname, { kind: 'human' }))).headers.get('x-middleware-next'), '1')
    assert.equal(h.calls.verify, 1, pathname)
  }
  for (const pathname of ['/api/mcp/tasks', '/api/v1/tasks', '/mcp']) {
    const h = harness()
    assert.equal((await h.proxy(h.request(pathname, { kind: 'none', bearer: true }))).headers.get('x-middleware-next'), '1')
    assert.equal(h.calls.verify, 0)
    assert.deepEqual(h.captures, [])
  }
})

test('capture is hourly per agent/method/path, contains no credentials and expires at the hour', async (t) => {
  const h = harness()
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  for (const query of ['?a=1', '?a=2']) await h.proxy(h.request(`/api/mcp/token${query}`))
  await h.proxy(h.request('/api/mcp/token', { method: 'POST' }))
  await h.proxy(h.request('/api/mcp/token', { agentId: 'other-agent' }))
  await h.proxy(h.request('/api/users/api-keys'))
  assert.equal(h.captures.length, 4)
  assert.deepEqual(h.captures[0], {
    distinctId: '7', event: 'agent_cookie_route_refused',
    properties: { agentId: 'bridge-agent', ownerUserId: 7, method: 'GET', route: '/api/mcp/token' },
  })
  now += 60 * 60 * 1000 - 1
  await h.proxy(h.request('/api/mcp/token'))
  assert.equal(h.captures.length, 4)
  now++
  await h.proxy(h.request('/api/mcp/token'))
  assert.equal(h.captures.length, 5)
})

for (const captureError of [true, 'throw']) {
  test(`capture failure is non-fatal: ${captureError}`, async () => {
    const h = harness({ captureError })
    assert.equal((await h.proxy(h.request('/api/mcp/token'))).status, 403)
    assert.equal((await h.proxy(h.request('/api/mcp/token'))).status, 403)
    assert.equal(h.captures.length, 1)
  })
}

test('agent refusal precedes revocation, redirects, bearer and auth exemptions', async () => {
  const h = harness({ revoked: true })
  for (const pathname of ['/api/auth/bridge-session', '/api/mcp/token', '/detail/project-15', '/', '/health', '/demo']) {
    const response = await h.proxy(h.request(pathname, { bearer: true, host: 'mcp.hypertask.ai' }))
    assert.equal(response.status, 403)
  }
  assert.equal(h.calls.revocation, 0)
})
