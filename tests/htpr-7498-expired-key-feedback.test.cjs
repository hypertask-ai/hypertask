const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const { randomBytes } = require('node:crypto')
const { loader } = require('./htpr-6927-fixtures.cjs')

const key = 'htpr-7498-expired-key-feedback'
const handshakeKey = 'htpr-7390-mcp-handshake-feedback'
const unauthorized = { surface: 'mcp', tool: 'mcp', status: 401, errorCode: 'unauthorized', category: 'auth_failed' }
const signingKey = randomBytes(32).toString('hex')
const extractBearerToken = (header) => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null

function setup({ mode = null, handshakeMode = null, reason, revoked = false } = {}) {
  const feedback = []
  const pending = []
  const classifications = []
  const reasons = []
  const flagLookups = []
  const load = loader({
    '@/lib/prisma': { __esModule: true, default: {
      featureFlag: { findUnique: async ({ where }) => {
        flagLookups.push(where.key)
        const selected = where.key === key ? mode : where.key === handshakeKey ? handshakeMode : null
        if (selected instanceof Error) throw selected
        return selected ? { mode: selected } : null
      } },
      user: { findUnique: async () => ({ id: 7, mcpTokensRevokedAt: null }) },
      revokedToken: { findFirst: async () => revoked ? { jti: 'fixture' } : null },
    } },
    react: { cache: (fn) => fn },
    '@vercel/functions': { waitUntil: (work) => pending.push(work) },
    './report': { fileAiFeedback: async (input) => feedback.push(input) },
    './tools': { MCP_TOOLS: [] },
    '@/lib/mcp/auth': {
      extractBearerToken,
      validateMcpAuth: async (request) => request.headers.get('Authorization') === 'Bearer valid-token' ? { user: { id: 7 } } : null,
    },
    '@/lib/mcp/auth/mcpAuthErrors': {
      classifyMcpAuthFailure: async (request) => {
        classifications.push(request)
        if (reason instanceof Error) throw reason
        const result = await (typeof reason === 'function' ? reason() : reason ?? load('src/lib/mcp/auth/mcpAuthErrors.ts').classifyMcpAuthFailure(request))
        reasons.push(result)
        return result
      },
    },
    './session': { extractBearerToken, isManagementKeyToken: () => false },
    './verifyJwt': {
      verifyMcpJwtToken: (token) => { try { return jwt.verify(token, signingKey) } catch { return null } },
      tokenRevocationJtis: (_userId, _token, payload) => [payload.jti],
    },
    '@/lib/mcp/mcpV2': { isMcpV2Enabled: async () => false },
    '@/lib/aiFeedback/enabled': { aiFeedbackEnabled: async () => false },
    '@/lib/aiFeedback/clientInfo': { rememberFeedbackClient: () => {} },
    '@/lib/telemetry/mcpSseAnalytics': { recordLegacyMcpRequest: () => {} },
    './legacy-sse': { isLegacySseRequest: () => false },
  })
  async function flush() {
    for (let index = 0; index < pending.length; index++) await pending[index]
  }
  return { load, mcpHandler: load('src/lib/mcp-server/handler.ts').mcpHandler, feedback, pending, classifications, reasons, flagLookups, flush }
}

function request(token) {
  return new Request('https://app.hypertask.ai/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }),
  })
}

async function assertUnauthorized(fixture, token) {
  const input = request(token)
  const expected = await fixture.load('src/lib/mcp-server/stateless-http.ts').mcpUnauthorizedResponse(input)
  const response = await fixture.mcpHandler(input)
  assert.equal(response.status, 401)
  assert.equal(response.status, expected.status)
  assert.deepEqual([...response.headers], [...expected.headers])
  assert.equal(await response.text(), await expected.text())
}

function signedToken(expiresIn = '1h') {
  return jwt.sign({ userId: 7, jti: 'fixture' }, signingKey, { expiresIn })
}

test('flag is registered with the requested bugfix defaults and telemetry-only risk', () => {
  const { load } = setup()
  const { FEATURE_FLAG_DEFINITIONS } = load('src/lib/flags/definitions.ts')
  assert.equal(load('src/lib/flags/keys.ts').HTPR_7498_EXPIRED_KEY_FEEDBACK_FLAG, key)
  assert.equal(FEATURE_FLAG_DEFINITIONS.filter((flag) => flag.key === key).length, 1)
  const definition = FEATURE_FLAG_DEFINITIONS.find((flag) => flag.key === key)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.shippedOn, '2026-10-21')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.equal(definition.releaseRisk.highRisk, undefined)
  assert.equal(load('src/lib/flags.ts').FEATURE_FLAG_KEYS.filter((flag) => flag === key).length, 1)
  assert.deepEqual(load('src/lib/flags/releaseRisk.ts').FEATURE_FLAG_RELEASE_RISKS[key], definition.releaseRisk)
})

test('explicit Everyone mode suppresses expired-key feedback in a single background task', async () => {
  const fixture = setup({ mode: 'EVERYONE' })
  await assertUnauthorized(fixture, signedToken(-60))
  await fixture.flush()
  assert.deepEqual(fixture.reasons, ['token_expired'])
  assert.deepEqual(fixture.feedback, [])
  assert.equal(fixture.pending.length, 1)
})

test('expired key is classified once as token_expired and quiet with the exact existing 401', async () => {
  const fixture = setup()
  await assertUnauthorized(fixture, signedToken(-60))
  await fixture.flush()
  assert.deepEqual(fixture.reasons, ['token_expired'])
  assert.equal(fixture.classifications.length, 1)
  assert.deepEqual(fixture.feedback, [])
})

test('revoked key is quiet with the exact existing 401', async () => {
  const fixture = setup({ revoked: true })
  await assertUnauthorized(fixture, signedToken())
  await fixture.flush()
  assert.deepEqual(fixture.reasons, ['token_revoked'])
  assert.equal(fixture.classifications.length, 1)
  assert.deepEqual(fixture.feedback, [])
})

for (const reason of ['agent_revoked', 'agent_token_superseded']) {
  test(`${reason} is quiet with the exact existing 401`, async () => {
    const fixture = setup({ reason })
    await assertUnauthorized(fixture, 'rejected-token')
    await fixture.flush()
    assert.equal(fixture.classifications.length, 1)
    assert.deepEqual(fixture.feedback, [])
  })
}

for (const [label, options, token] of [
  ['garbage bearer', {}, 'garbage'],
  ['JWT without exp that fails verification', {}, jwt.sign({ userId: 7 }, randomBytes(32).toString('hex'))],
  ...['invalid_token', 'legacy_token', 'insufficient_scope', 'missing_token'].map((reason) => [reason, { reason }, 'rejected-token']),
]) {
  test(`${label} still files exactly once with the exact existing 401`, async () => {
    const fixture = setup(options)
    await assertUnauthorized(fixture, token)
    await fixture.flush()
    assert.equal(fixture.classifications.length, 1)
    assert.deepEqual(fixture.feedback, [unauthorized])
    assert.equal(fixture.pending.length, 1)
  })
}

for (const mode of ['OFF', 'OWNER_ONLY', 'OWNER_AND_QA', new Error('Flag store unavailable')]) {
  test(`flag ${mode instanceof Error ? 'lookup failure' : mode} preserves expired-key reporting without classification`, async () => {
    const fixture = setup({ mode })
    await assertUnauthorized(fixture, signedToken(-60))
    await fixture.flush()
    assert.deepEqual(fixture.classifications, [])
    assert.deepEqual(fixture.feedback, [unauthorized])
  })
}

test('classification failure keeps reporting exactly once', async () => {
  const fixture = setup({ reason: new Error('Classification unavailable') })
  await assertUnauthorized(fixture, 'rejected-token')
  await fixture.flush()
  assert.equal(fixture.classifications.length, 1)
  assert.deepEqual(fixture.feedback, [unauthorized])
})

test('pending classification does not delay the unchanged 401 response', async () => {
  let resolve
  const classification = new Promise((done) => { resolve = done })
  const fixture = setup({ reason: () => classification })
  try {
    await Promise.race([
      assertUnauthorized(fixture, 'rejected-token'),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('401 waited for classification')), 1000).unref() }),
    ])
    assert.deepEqual(fixture.feedback, [])
  } finally {
    resolve('token_expired')
    await fixture.flush()
  }
  assert.equal(fixture.classifications.length, 1)
  assert.deepEqual(fixture.feedback, [])
})

for (const handshakeMode of [null, 'OFF', new Error('Handshake flag unavailable')]) {
  test(`keyless behavior stays unchanged when handshake flag is ${handshakeMode === null ? 'Everyone' : handshakeMode instanceof Error ? 'unavailable' : handshakeMode}`, async () => {
    const fixture = setup({ handshakeMode })
    await assertUnauthorized(fixture)
    await fixture.flush()
    assert.deepEqual(fixture.classifications, [])
    assert.deepEqual(fixture.flagLookups.filter((flag) => flag === key || flag === handshakeKey), [handshakeKey])
    assert.deepEqual(fixture.feedback, handshakeMode === null ? [] : [unauthorized])
  })
}

test('valid bearer still initializes normally without classification or feedback', async () => {
  const fixture = setup()
  const response = await fixture.mcpHandler(request('valid-token'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).result.protocolVersion, '2025-03-26')
  await fixture.flush()
  assert.deepEqual(fixture.classifications, [])
  assert.deepEqual(fixture.feedback, [])
})

test('automatic feedback keeps shared category defaults and field sanitising', async () => {
  const fixture = setup()
  const { queueAiFeedback } = fixture.load('src/lib/aiFeedback/automatic.ts')
  queueAiFeedback({ surface: 'mcp', tool: 'bad tool', client: 'bad client', status: 401, errorCode: 'bad error' })
  await fixture.flush()
  assert.deepEqual(fixture.feedback, [{ surface: 'mcp', status: 401, category: 'auth_failed' }])
  assert.equal(fixture.pending.length, 1)
})
