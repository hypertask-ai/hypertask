const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const key = 'htpr-7390-mcp-handshake-feedback'
const unauthorized = { surface: 'mcp', tool: 'mcp', status: 401, errorCode: 'unauthorized' }

function setup(mode = null) {
  const feedback = []
  const load = loader({
    '@/lib/prisma': { __esModule: true, default: {
      featureFlag: { findUnique: async ({ where }) => {
        if (where.key !== key) return null
        if (mode instanceof Error) throw mode
        return mode ? { mode } : null
      } },
    } },
    react: { cache: (fn) => fn },
    './tools': { MCP_TOOLS: [] },
    '@/lib/mcp/auth': {
      extractBearerToken: (header) => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null,
      validateMcpAuth: async (request) => request.headers.get('Authorization') === 'Bearer valid-token' ? { user: { id: 7 } } : null,
    },
    '@/lib/mcp/mcpV2': { isMcpV2Enabled: async () => false },
    '@/lib/aiFeedback/enabled': { aiFeedbackEnabled: async () => false },
    '@/lib/aiFeedback/automatic': {
      observeFeedbackTools: (tools) => tools,
      queueAiFeedback: (input) => feedback.push(input),
      queueMcpAuthFailure: () => feedback.push(unauthorized),
    },
    '@/lib/aiFeedback/clientInfo': { rememberFeedbackClient: () => {} },
    '@/lib/telemetry/mcpSseAnalytics': { recordLegacyMcpRequest: () => {} },
    './legacy-sse': { isLegacySseRequest: () => false },
  })
  return { mcpHandler: load('src/lib/mcp-server/handler.ts').mcpHandler, feedback }
}

function request(token) {
  return new Request('https://app.hypertask.ai/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }),
  })
}

async function assertUnauthorized(response) {
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer realm="hypertask-mcp", error="invalid_token", resource_metadata="https://app.hypertask.ai/.well-known/oauth-protected-resource"')
  assert.equal(await response.text(), JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Authentication required. Send a bearer token on every request.' },
    id: null,
  }))
}

test('keyless initialize preserves the OAuth 401 challenge without queuing feedback', async () => {
  const { mcpHandler, feedback } = setup()
  await assertUnauthorized(await mcpHandler(request()))
  assert.deepEqual(feedback, [])
})

test('rejected bearer still queues exactly one unauthorized report', async () => {
  const { mcpHandler, feedback } = setup()
  await assertUnauthorized(await mcpHandler(request('rejected-token')))
  assert.deepEqual(feedback, [unauthorized])
})

test('valid bearer reaches normal MCP initialization without unauthorized feedback', async () => {
  const { mcpHandler, feedback } = setup()
  const response = await mcpHandler(request('valid-token'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.id, 1)
  assert.equal(body.result.protocolVersion, '2025-03-26')
  assert.deepEqual(body.result.serverInfo, { name: 'hyperTask', version: '1.0.0' })
  assert.deepEqual(feedback, [])
})

test('flag Off preserves keyless unauthorized reporting and the exact 401 response', async () => {
  const { mcpHandler, feedback } = setup('OFF')
  await assertUnauthorized(await mcpHandler(request()))
  assert.deepEqual(feedback, [unauthorized])
})

test('flag lookup failure preserves the 401 response and previous feedback behavior', async () => {
  const { mcpHandler, feedback } = setup(new Error('Flag store unavailable'))
  await assertUnauthorized(await mcpHandler(request()))
  assert.deepEqual(feedback, [unauthorized])
})
