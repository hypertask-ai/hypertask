const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const signingKey = 'mcp-audience-test-signing-key-0000000000'
const user = {
  id: 985,
  email: 'mcp-audience@example.test',
  displayName: 'MCP audience test',
  mcpTokensRevokedAt: null,
}

process.env.JWT_SECRET = signingKey
process.env.JWT_ISSUER = 'hypertask'
process.env.JWT_OAUTH_AUDIENCE = 'https://mcp.hypertask.ai'

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

stubModule('src/lib/prisma.ts', {
  default: {
    user: {
      findUnique: async ({ where }) => (where.id === user.id ? user : null),
      findFirst: async ({ where }) => (where.email === user.email ? user : null),
    },
    oAuthClient: { findUnique: async () => null },
    revokedToken: { findFirst: async () => null },
    agent: { findFirst: async () => null },
    project: {
      count: async () => 0,
      findMany: async () => [],
    },
    logs: { create: async () => ({ id: 1 }) },
  },
})
stubModule('src/lib/redis.ts', {
  getRedis: async () => ({
    incr: async () => 1,
    expire: async () => 1,
  }),
})
stubModule('src/lib/flags.ts', {
  HTPR_4638_AI_DIRECTORY_METADATA_FLAG: 'htpr-4638-ai-directory-metadata',
  HTPR_6530_MCP_LIST_QUERY_FLAG: 'htpr-6530-mcp-list-query',
  HTPR_6531_DEFERRED_MCP_TOOLS_FLAG: 'htpr-6531-deferred-mcp-tools',
  HTPR_6532_STATELESS_MCP_FLAG: 'htpr-6532-stateless-mcp',
  HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG: 'htpr-6542-team-scoped-management-keys',
  isFeatureEnabled: async () => false,
})
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
  alias: { '@': path.join(root, 'src') },
})
const projectsRoute = jiti(path.join(root, 'src/app/api/mcp/projects/route.ts'))
const { validateMcpAuth, verifyMcpJwtToken } = jiti(
  path.join(root, 'src/lib/mcp/auth.ts'),
)
const { handleMcpHttp } = jiti(path.join(root, 'src/lib/mcp-server/mcp-http.ts'))

function tokenFor(audience) {
  return jwt.sign(
    { sub: user.email },
    signingKey,
    { issuer: 'hypertask', audience, expiresIn: '15m' },
  )
}

for (const audience of ['email-link', 'email-verification', 'unrelated-security-test']) {
  test(`HTTP MCP rejects a signed ${audience} token`, async () => {
    const response = await projectsRoute.GET(
      new NextRequest('https://app.hypertask.ai/api/mcp/projects', {
        headers: { Authorization: `Bearer ${tokenFor(audience)}` },
      }),
    )

    assert.equal(response.status, 401)
  })

  test(`JSON-RPC MCP rejects a signed ${audience} token`, async () => {
    const response = await handleMcpHttp(
      new Request('https://app.hypertask.ai/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenFor(audience)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'audience-test', version: '1' },
          },
        }),
      }),
      {
        authenticate: async (request, token) => {
          if (!token) return null
          const ctx = await validateMcpAuth(
            new NextRequest(request.url, {
              method: request.method,
              headers: request.headers,
            }),
          )
          return ctx ? { token, clientId: String(ctx.user.id) } : null
        },
        tools: [],
      },
    )

    assert.equal(response.status, 401)
  })
}

test('an audience-less legacy MCP token remains valid', () => {
  const token = jwt.sign(
    { sub: user.email },
    signingKey,
    { issuer: 'hypertask', expiresIn: '15m' },
  )

  assert.equal(verifyMcpJwtToken(token)?.sub, user.email)
})
