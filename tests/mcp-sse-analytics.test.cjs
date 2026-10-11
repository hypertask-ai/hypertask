const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createJiti } = require('jiti')

const root = path.resolve(__dirname, '..')
const captures = []
const scheduled = []
const response = new Response('legacy transport response', {
  headers: { 'content-type': 'text/event-stream' },
})
let failCapture = false
let failSchedule = false
let authenticated = true
let failBody = false
let clientAvailable = true

function stub(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
function source(file, exports) {
  stub(path.join(root, file), exports)
}

source('src/lib/mcp-server/legacy-sse.ts', {
  isLegacySseRequest: (request) => ['/sse', '/message'].includes(new URL(request.url).pathname),
  handleLegacySseRequest: async () => response,
})
const flagChecks = []
source('src/lib/flags.ts', {
  HTPR_6804_MCP_TOOLS_FLAG: 'htpr-6804-mcp-tools',
  isFeatureEnabled: async (key, userId) => {
    flagChecks.push({ key, userId })
    return false
  },
})
source('src/lib/prisma.ts', { __esModule: true, default: new Proxy({}, {
  get: () => { throw new Error('Analytics tests must not access the database') },
}) })
source('src/lib/mcp-server/tools.ts', { MCP_TOOLS: [] })
source('src/lib/mcp-server/listQueryContract.ts', { resolvePortableTools: () => [] })
source('src/lib/mcp/auth.ts', {
  extractBearerToken: () => 'test-token',
  validateMcpAuth: async () => authenticated ? { user: { id: 2343 } } : null,
})
source('src/lib/telemetry/signupAnalytics.ts', {
  postHogClient: () => clientAvailable ? {
    captureImmediate: async (capture) => {
      if (failCapture) throw new Error('analytics unavailable')
      captures.push(capture)
    },
  } : undefined,
})
stub(require.resolve('mcp-handler'), {
  createMcpHandler: () => async () => response,
  withMcpAuth: (handler) => handler,
})
stub(require.resolve('@vercel/functions'), {
  waitUntil: (promise) => {
    scheduled.push(promise)
    if (failSchedule) throw new Error('scheduling unavailable')
  },
})
class McpAttachmentRequestBodyError extends Error {
  status = 413
}
source('src/lib/mcp/attachments/readRequestBody.ts', {
  McpAttachmentRequestBodyError,
  readRequestBytesWithCap: async (request) => {
    if (failBody) throw new McpAttachmentRequestBodyError('body too large')
    return new Uint8Array(await request.arrayBuffer())
  },
})
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const routes = {
  '/sse': jiti(path.join(root, 'src/app/sse/route.ts')),
  '/message': jiti(path.join(root, 'src/app/message/route.ts')),
  '/mcp': jiti(path.join(root, 'src/app/mcp/route.ts')),
}

async function call(endpoint, method = 'GET') {
  captures.length = 0
  scheduled.length = 0
  flagChecks.length = 0
  const request = new Request(`https://app.hypertask.ai${endpoint}?sessionId=private-session`, {
    method,
    headers: { Authorization: 'Bearer private-token', 'User-Agent': 'legacy-client/1.0' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
  const result = await routes[endpoint][method](request)
  await Promise.all(scheduled)
  return result
}

test('each legacy route and supported method captures verified identity and request metadata once without changing the response', async () => {
  for (const endpoint of ['/sse', '/message']) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const before = Date.now()
      assert.equal(await call(endpoint, method), response)
      assert.equal(captures.length, 1)
      const capture = captures[0]
      assert.equal(capture.event, 'mcp_legacy_sse_request')
      assert.equal(capture.distinctId, '2343')
      assert.equal(capture.properties.endpoint, endpoint)
      assert.equal(capture.properties.user_id, 2343)
      assert.equal(capture.properties.user_agent, 'legacy-client/1.0')
      assert.equal(capture.properties.method, method)
      assert.equal(capture.properties.timestamp, capture.timestamp.toISOString())
      assert.ok(capture.timestamp.getTime() >= before)
      assert.ok(capture.timestamp.getTime() <= Date.now())
      assert.ok(!JSON.stringify(capture).includes('private-token'))
      assert.ok(!JSON.stringify(capture).includes('private-session'))
    }
  }
})

test('transport analytics evaluates the catalog flag through an isolated fixture for the verified user', async () => {
  for (const endpoint of ['/sse', '/message', '/mcp']) {
    await call(endpoint)
    assert.deepEqual(flagChecks, [
      { key: 'htpr-6927-mcp-v2', userId: 2343 },
      { key: 'htpr-6804-mcp-tools', userId: 2343 },
    ])
  }
  authenticated = false
  try {
    assert.equal((await call('/sse')).status, 401)
    assert.deepEqual(flagChecks, [])
  } finally {
    authenticated = true
  }
})

test('unauthenticated attempts are counted but never attributed to a verified user', async () => {
  authenticated = false
  try {
    assert.equal((await call('/sse')).status, 401)
    assert.equal(captures.length, 1)
    assert.equal(captures[0].properties.user_id, null)
    assert.match(captures[0].distinctId, /^mcp-sse-anonymous:/)
    assert.equal(captures[0].properties.$process_person_profile, false)
  } finally {
    authenticated = true
  }
})

test('oversized legacy requests are still counted and preserve the rejection', async () => {
  failBody = true
  try {
    assert.equal((await call('/message', 'POST')).status, 413)
    assert.equal(captures.length, 1)
    assert.equal(captures[0].properties.user_id, null)
  } finally {
    failBody = false
  }
})

test('the current /mcp transport does not contribute to the legacy counter', async () => {
  assert.equal((await call('/mcp')).status, 405)
  assert.equal(captures.length, 0)
  assert.equal(scheduled.length, 0)
})

test('analytics rejection, unavailable configuration and scheduling failure never alter client responses', async () => {
  failCapture = true
  try {
    assert.equal(await call('/sse'), response)
  } finally {
    failCapture = false
  }
  clientAvailable = false
  try {
    assert.equal(await call('/sse'), response)
    assert.equal(scheduled.length, 0)
  } finally {
    clientAvailable = true
  }
  failSchedule = true
  try {
    assert.equal(await call('/message'), response)
    assert.equal(captures.length, 1)
  } finally {
    failSchedule = false
  }
})
