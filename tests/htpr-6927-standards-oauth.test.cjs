const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { root, loader } = require('./htpr-6927-fixtures.cjs')
const load = loader()
const { TOOL_NAMES } = load('src/lib/mcp-server/config/tool-metadata.ts')
const definitions = load('src/lib/mcp-server/config/consolidated-descriptions.ts').CONSOLIDATED_TOOL_DESCRIPTIONS
const { validateToolNames } = load('src/lib/mcp-server/config/mcp-standards.ts')
function validateCatalog(names) {
  assert.equal(new Set(names).size, names.length, 'duplicate tool names')
  assert.deepEqual(validateToolNames(names).filter((result) => !result.valid), [])
}

test('complete legacy and consolidated catalogs have unique standards-compliant prefixed names', () => {
  const discovery = ['hypertask_search_tools', 'hypertask_describe_tool']
  validateCatalog([...TOOL_NAMES, ...discovery])
  validateCatalog([...definitions.map((definition) => definition.name), ...discovery])
  for (const [file, exports] of Object.entries({
    'src/lib/prisma.ts': { __esModule: true, default: {} },
    'src/lib/auth/getSessionUser.ts': { getSessionUser: async () => null },
  })) {
    const filename = path.join(root, file)
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
  const actual = jiti(path.join(root, 'src/lib/mcp-server/tools/index.ts')).MCP_TOOLS.map((tool) => tool.name)
  validateCatalog(actual)
  assert.deepEqual(new Set(actual), new Set(TOOL_NAMES))
  assert.ok(TOOL_NAMES.length > 0)
  assert.ok(definitions.length > 0)
})

test('name validation rejects duplicates, missing prefixes, invalid characters and excess length', () => {
  for (const names of [
    ['hypertask_good', 'hypertask_good'], ['other_tool'], ['hypertask_bad name'], ['hypertask_bad/name'],
    [`hypertask_${'a'.repeat(119)}`], ['hypertask_\u00e9'], [''],
  ]) assert.throws(() => validateCatalog(names))
  validateCatalog(['hypertask_good.name-1', `hypertask_${'a'.repeat(118)}`])
})

test('protected-resource metadata advertises the canonical MCP resource and OAuth server', async () => {
  const original = process.env.NEXT_PUBLIC_MCP_SERVER_URL
  delete process.env.NEXT_PUBLIC_MCP_SERVER_URL
  try {
    const route = loader()('src/app/.well-known/oauth-protected-resource/route.ts')
    const response = route.GET()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    assert.deepEqual(await response.json(), {
      resource: 'https://mcp.hypertask.ai/mcp', authorization_servers: ['https://app.hypertask.ai'],
      scopes_supported: ['mcp:full'], bearer_methods_supported: ['header'],
    })
    const options = route.OPTIONS()
    assert.equal(options.status, 204)
    assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
    process.env.NEXT_PUBLIC_MCP_SERVER_URL = 'https://mcp.fixture.invalid/mcp'
    assert.equal((await loader()('src/app/.well-known/oauth-protected-resource/route.ts').GET().json()).resource, process.env.NEXT_PUBLIC_MCP_SERVER_URL)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_MCP_SERVER_URL
    else process.env.NEXT_PUBLIC_MCP_SERVER_URL = original
  }
})

test('authorization-server metadata supports code, S256 PKCE and public registered clients', async () => {
  const env = { JWT_ISSUER: process.env.JWT_ISSUER, NEXT_PUBLIC_BASEURL: process.env.NEXT_PUBLIC_BASEURL }
  delete process.env.JWT_ISSUER
  delete process.env.NEXT_PUBLIC_BASEURL
  try {
    const response = await loader()('src/app/.well-known/oauth-authorization-server/route.ts').GET()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600')
    assert.deepEqual(await response.json(), {
      issuer: 'https://app.hypertask.ai', authorization_endpoint: 'https://app.hypertask.ai/oauth/authorize',
      token_endpoint: 'https://app.hypertask.ai/oauth/token', registration_endpoint: 'https://app.hypertask.ai/oauth/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp:full'],
    })
    process.env.JWT_ISSUER = 'https://issuer.fixture.invalid'
    process.env.NEXT_PUBLIC_BASEURL = 'https://app.fixture.invalid'
    const configured = await (await loader()('src/app/.well-known/oauth-authorization-server/route.ts').GET()).json()
    assert.equal(configured.issuer, process.env.JWT_ISSUER)
    assert.equal(configured.authorization_endpoint, `${process.env.NEXT_PUBLIC_BASEURL}/oauth/authorize`)
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('unauthorized MCP challenges link to discoverable protected-resource metadata', async () => {
  const { handleStatelessMcpRequest } = load('src/lib/mcp-server/stateless-http.ts')
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await handleStatelessMcpRequest(new Request('https://mcp.fixture.invalid/mcp', { method }), null, [])
    assert.equal(response.status, 401)
    const challenge = response.headers.get('WWW-Authenticate')
    assert.match(challenge, /^Bearer /)
    const url = new URL(challenge.match(/resource_metadata="([^"]+)"/)[1])
    assert.equal(url.origin, 'https://mcp.fixture.invalid')
    assert.equal(url.pathname, '/.well-known/oauth-protected-resource')
    assert.ok(response.headers.get('Access-Control-Expose-Headers').includes('WWW-Authenticate'))
    assert.equal((await response.json()).error.code, -32001)
    assert.equal(load(`src/app${url.pathname}/route.ts`).GET().status, 200)
  }
})

test('slice statuses state local completion, remaining scope and security prerequisites for unsupported CIMD', () => {
  const docs = fs.readFileSync(path.join(root, 'docs/htpr-6478-slices.md'), 'utf8')
  assert.match(docs, /Section 4: implemented locally in PR A, deployment pending/)
  assert.match(docs, /Section 5: update orchestration implemented locally; broader simplification remaining/)
  assert.match(docs, /CIMD is unsupported.*stored UUID.*registered client/)
  assert.match(docs, /security-reviewed resolver.*SSRF.*bounded HTTPS.*redirect controls/)
})
