const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { loader } = require('./htpr-6927-fixtures.cjs')
const {
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
  extractWWWAuthenticateParams,
} = require('@modelcontextprotocol/sdk/client/auth.js')

const key = 'htpr-7190-mcp-resource-host'
const metadataPath = '/.well-known/oauth-protected-resource'
const originalEnv = { NEXT_PUBLIC_MCP_SERVER_URL: process.env.NEXT_PUBLIC_MCP_SERVER_URL, REDIS_URL: process.env.REDIS_URL }
process.env.NEXT_PUBLIC_MCP_SERVER_URL = 'https://mcp.hypertask.ai/mcp'
delete process.env.REDIS_URL

test.after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function fixture(mode = null) {
  const calls = []
  const load = loader({
    '@/lib/prisma': { __esModule: true, default: {
      featureFlag: { findUnique: async ({ where }) => {
        assert.equal(where.key, key)
        calls.push(where.key)
        if (mode === 'error') throw new Error('flag store unavailable')
        return mode ? { mode } : null
      } },
      user: { findUnique: async () => { throw new Error('anonymous discovery must not look up a user') } },
    } },
    react: { cache: (fn) => fn },
  })
  return { load, calls, route: load('src/app/.well-known/oauth-protected-resource/route.ts') }
}

async function metadata(f, url, headers = {}) {
  return (await f.route.GET(new Request(url, { headers }))).json()
}

for (const host of ['app.hypertask.ai', 'mcp.hypertask.ai']) {
  test(`${host} metadata matches the caller, including forwarded Vercel host`, async () => {
    const f = fixture()
    assert.equal((await metadata(f, `https://${host}${metadataPath}`)).resource, `https://${host}/mcp`)
    const response = await f.route.GET(new Request(`https://app.hypertask.ai${metadataPath}`, {
      headers: { 'x-forwarded-host': `${host}, proxy.internal`, 'x-forwarded-proto': 'https, http' },
    }))
    assert.equal((await metadata(f, `https://internal.invalid${metadataPath}`, {
      host: host.toUpperCase(), 'x-forwarded-proto': 'https',
    })).resource, `https://${host}/mcp`)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    assert.deepEqual(await response.json(), {
      resource: `https://${host}/mcp`, authorization_servers: ['https://app.hypertask.ai'],
      scopes_supported: ['mcp:full'], bearer_methods_supported: ['header'],
    })
    assert.ok(f.calls.length > 0, 'anonymous requests evaluate the real flag implementation')
  })
}

test('configured MCP host and existing localhost/preview allowlist are supported', async () => {
  process.env.NEXT_PUBLIC_MCP_SERVER_URL = 'https://custom.fixture.invalid:8443/mcp'
  try {
    const f = fixture()
    for (const origin of [
      'https://custom.fixture.invalid:8443', 'http://localhost:3000', 'http://127.0.0.1:3000',
      'https://hypertasks-prod-resource-host-hypertaskai.vercel.app',
    ]) {
      assert.equal((await metadata(f, `${origin}${metadataPath}`)).resource, `${origin}/mcp`)
    }
    assert.equal((await metadata(f, `https://unknown.invalid${metadataPath}`)).resource, 'https://custom.fixture.invalid:8443/mcp')
  } finally {
    process.env.NEXT_PUBLIC_MCP_SERVER_URL = 'https://mcp.hypertask.ai/mcp'
  }
})

test('unknown, deceptive and malformed hosts cannot replace the configured default', async () => {
  const f = fixture()
  for (const host of [
    'unknown.invalid', 'app.hypertask.ai.evil.invalid', 'mcp.hypertask.ai:8443',
    'hypertasks-prod-evil-other-team.vercel.app', 'localhost:3999',
    'mcp.hypertask.ai@evil.invalid', 'mcp.hypertask.ai/path', 'mcp.hypertask.ai#fragment',
  ]) {
    assert.equal((await metadata(f, `https://unknown.invalid${metadataPath}`, {
      'x-forwarded-host': host,
    })).resource, 'https://mcp.hypertask.ai/mcp', host)
  }
  assert.equal((await metadata(f, `https://unknown.invalid${metadataPath}`)).resource, 'https://mcp.hypertask.ai/mcp')
})

test('flag off and failed flag reads preserve legacy metadata and challenge exactly', async () => {
  for (const mode of ['OFF', 'error']) {
    const f = fixture(mode)
    const request = new Request('https://app.hypertask.ai/mcp', {
      headers: { 'x-forwarded-host': 'mcp.hypertask.ai', 'x-forwarded-proto': 'https' },
    })
    assert.equal((await metadata(f, `https://app.hypertask.ai${metadataPath}`)).resource, 'https://mcp.hypertask.ai/mcp')
    const response = await f.load('src/lib/mcp-server/stateless-http.ts').mcpUnauthorizedResponse(request)
    assert.equal(response.headers.get('WWW-Authenticate'), `Bearer realm="hypertask-mcp", error="invalid_token", resource_metadata="https://app.hypertask.ai${metadataPath}"`)
  }
})

test('bugfix flag defaults Everyone and evaluates anonymously without identity lookup', async () => {
  const f = fixture()
  const definition = f.load('src/lib/flags/definitions/htpr-7190-mcp-resource-host.ts').default
  assert.equal(definition.key, key)
  assert.equal(definition.kind, 'bugfix')
  assert.ok(definition.releaseRisk.reason)
  const flags = f.load('src/lib/flags.ts')
  assert.equal(flags.defaultFeatureFlagMode(key), 'EVERYONE')
  assert.equal(await flags.isFeatureEnabled(key, 0), true)
  assert.equal(await fixture('OFF').load('src/lib/flags.ts').isFeatureEnabled(key, 0), false)
  assert.equal(await fixture('OWNER_AND_QA').load('src/lib/flags.ts').isFeatureEnabled(key, 0), false)
})

test('path-suffixed route reuses GET/OPTIONS and proxy permits anonymous discovery even with stale cookies', async () => {
  const f = fixture()
  const suffixed = f.load('src/app/.well-known/oauth-protected-resource/mcp/route.ts')
  assert.equal(suffixed.GET, f.route.GET)
  assert.equal(suffixed.OPTIONS, f.route.OPTIONS)
  assert.equal((await (await suffixed.GET(new Request(`https://app.hypertask.ai${metadataPath}/mcp`))).json()).resource, 'https://app.hypertask.ai/mcp')
  assert.equal(suffixed.OPTIONS().status, 204)
  const proxy = loader({
    './utils/edgeHelpers': { isValidUser: () => ({ isValid: false }) },
    './utils/serverActions': {},
    './utils/helperFunctions/helperFunctions': {},
    '@/lib/auth/sessionEdge': {},
    '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: () => { throw new Error('well-known must bypass cookie revocation') } },
    '@/lib/auth/cookieIdentity': { verifyCookieIdentity: () => { throw new Error('well-known must bypass identity checks') } },
  })('src/proxy.ts').default
  const response = await proxy(new NextRequest(`https://app.hypertask.ai${metadataPath}/mcp`, {
    headers: { cookie: 'nookies_user=stale; ht_session=stale' },
  }))
  assert.equal(response.headers.get('x-middleware-next'), '1')
  assert.equal(response.headers.get('location'), null)
})

for (const host of ['app.hypertask.ai', 'mcp.hypertask.ai']) {
  test(`401 and official SDK discovery accept ${host} with and without a challenge`, async () => {
    const f = fixture()
    const origin = `https://${host}`
    const transport = f.load('src/lib/mcp-server/stateless-http.ts')
    for (const method of ['GET', 'POST', 'DELETE']) {
      const direct = await transport.handleStatelessMcpRequest(new Request(`${origin}/mcp`, { method }), null, [])
      assert.equal(direct.status, 401)
      assert.equal(extractWWWAuthenticateParams(direct).resourceMetadataUrl.href, `${origin}${metadataPath}`)
    }
    const request = new Request('https://app.hypertask.ai/mcp', {
      method: 'POST', headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' },
    })
    const response = await f.load('src/lib/mcp-server/stateless-http.ts').handleStatelessMcpRequest(request, null, [])
    assert.equal(response.status, 401)
    const { resourceMetadataUrl } = extractWWWAuthenticateParams(response)
    assert.equal(resourceMetadataUrl.href, `${origin}${metadataPath}`)
    const paths = []
    const mockFetch = async (url) => {
      const parsed = new URL(url)
      assert.equal(parsed.origin, origin)
      paths.push(parsed.pathname)
      const route = parsed.pathname === `${metadataPath}/mcp`
        ? f.load('src/app/.well-known/oauth-protected-resource/mcp/route.ts') : f.route
      return route.GET(new Request(parsed))
    }
    for (const options of [{ resourceMetadataUrl }, undefined]) {
      const body = await discoverOAuthProtectedResourceMetadata(new URL(`${origin}/mcp`), options, mockFetch)
      assert.equal((await selectResourceURL(new URL(`${origin}/mcp`), {}, body)).href, `${origin}/mcp`)
    }
    assert.deepEqual(paths, [metadataPath, `${metadataPath}/mcp`])
  })
}

test('official SDK negative control rejects legacy cross-host metadata', async () => {
  const body = await metadata(fixture('OFF'), `https://app.hypertask.ai${metadataPath}`)
  await assert.rejects(selectResourceURL(new URL('https://app.hypertask.ai/mcp'), {}, body), /Protected resource .* does not match expected/)
})
