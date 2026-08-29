const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jwt = require('jsonwebtoken')

const root = path.resolve(__dirname, '..')
process.env.JWT_SECRET = 'agent-oauth-generation-test-secret-32-chars'
process.env.JWT_ISSUER = 'hypertask'

const jiti = require('jiti')(
  path.join(root, 'tests/agent-oauth-token-generation-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
)

const {
  agentTokenCredentialFields,
  createOAuthToken,
  presentedAgentTokenGeneration,
  storedAgentTokenGeneration,
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

const agentId = 'a9ced00e-1c88-4c9d-a5a4-497b5c494759'

test('OAuth agent tokens retain the managed token generation across restarts', () => {
  const managedToken = jwt.sign(
    { sub: 'owner@example.test', userId: 6, agentId, jti: 'generation-7' },
    process.env.JWT_SECRET,
    { issuer: 'hypertask', audience: 'mcp-api' }
  )
  // HTPR-4671: the generation is written to the row when the token is minted
  // and read straight back, instead of being re-derived from a stored JWT.
  const generation = storedAgentTokenGeneration(
    agentTokenCredentialFields(managedToken)
  )

  const oauthToken = createOAuthToken(
    'firebase-owner',
    6,
    'owner@example.test',
    3600,
    agentId,
    generation
  )
  const decoded = jwt.verify(oauthToken, process.env.JWT_SECRET, {
    issuer: 'hypertask',
    audience: 'http://localhost:3001',
  })

  assert.equal(decoded.agentId, agentId)
  assert.equal(decoded.agentTokenGeneration, 'generation-7')
  assert.notEqual(decoded.jti, 'generation-7')
  assert.equal(presentedAgentTokenGeneration(decoded), 'generation-7')
  assert.equal(decoded.exp, undefined)
})

test('OAuth credentials get unique jtis within one managed generation', () => {
  const first = jwt.decode(createOAuthToken(
    'firebase-owner', 6, 'owner@example.test', 3600, agentId, 'generation-7'
  ))
  const second = jwt.decode(createOAuthToken(
    'firebase-owner', 6, 'owner@example.test', 3600, agentId, 'generation-7'
  ))

  assert.equal(first.agentTokenGeneration, second.agentTokenGeneration)
  assert.notEqual(first.jti, second.jti)
})

test('OAuth credentials carry millisecond issuance time for revoke-all ordering', () => {
  const before = Date.now()
  const decoded = jwt.decode(createOAuthToken(
    'firebase-owner', 6, 'owner@example.test', 3600
  ))
  const after = Date.now()

  assert.equal(decoded.iat, Math.floor(decoded.mcpIssuedAtMs / 1000))
  assert.ok(decoded.mcpIssuedAtMs >= before)
  assert.ok(decoded.mcpIssuedAtMs <= after)
})

test('OAuth refuses to mint an unrevocable agent token without a generation', () => {
  assert.throws(
    () => createOAuthToken(
      'firebase-owner',
      6,
      'owner@example.test',
      3600,
      agentId
    ),
    /require the current agent token jti/
  )
})

test('a row with no credential yields no generation to donate', () => {
  // HTPR-4671. The route used to re-verify a stored JWT before copying its jti
  // into an OAuth token. There is no stored JWT any more, so the equivalent
  // failure is a row that carries nothing.
  assert.equal(storedAgentTokenGeneration(null), null)
  assert.equal(storedAgentTokenGeneration(undefined), null)
  assert.equal(storedAgentTokenGeneration({ mcpTokenJti: null }), null)
  assert.equal(storedAgentTokenGeneration({ mcpTokenJti: '' }), null)
  assert.equal(storedAgentTokenGeneration(agentTokenCredentialFields(null)), null)
})

test('the stored generation is the minted credential jti and nothing else', () => {
  const managedToken = jwt.sign(
    { sub: 'owner@example.test', userId: 6, agentId, jti: 'generation-7' },
    process.env.JWT_SECRET,
    { issuer: 'hypertask', audience: 'mcp-api' }
  )
  const stored = agentTokenCredentialFields(managedToken)

  assert.equal(stored.mcpTokenJti, 'generation-7')
  assert.equal(stored.mcpTokenHash.length, 64)
  assert.notEqual(stored.mcpTokenHash, managedToken)
  assert.equal(storedAgentTokenGeneration(stored), 'generation-7')

  // A credential with no jti is refused rather than stored unrevokable.
  const noJti = jwt.sign({ agentId, userId: 6 }, process.env.JWT_SECRET, {
    issuer: 'hypertask',
    audience: 'mcp-api',
  })
  assert.throws(
    () => agentTokenCredentialFields(noJti),
    /could never be revoked/
  )
  assert.throws(() => agentTokenCredentialFields('not-a-jwt'))
})

test('rotation changes the accepted generation without reusing OAuth jti', () => {
  const oauthToken = createOAuthToken(
    'firebase-owner', 6, 'owner@example.test', 3600, agentId, 'generation-7'
  )
  const decoded = jwt.decode(oauthToken)

  assert.equal(presentedAgentTokenGeneration(decoded), 'generation-7')
  assert.notEqual(presentedAgentTokenGeneration(decoded), 'generation-8')
})
