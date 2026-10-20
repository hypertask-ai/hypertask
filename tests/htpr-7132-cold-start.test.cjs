const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, stubs) {
  stubs = { '@/lib/auth/agentScope': () => require('./helpers/agent-board-scope.cjs').enforcedScope, ...stubs }
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const imports = []
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'process', code)(mod, mod.exports, name => {
    imports.push(name)
    assert.ok(name in stubs, `Unexpected import ${name}`)
    return stubs[name]()
  }, { env: {} })
  return { exports: mod.exports, imports }
}

function sessionHarness({ authFails = false } = {}) {
  const user = { id: 7, email: 'cold@example.test', displayName: 'Fixture' }
  const context = { user, agentId: null }
  const verifiedKeys = []
  const sessionHeaders = []
  const permissions = load('src/lib/mcp/managementPermissions.ts', {}).exports
  const loaded = load('src/lib/mcp/auth/session.ts', {
    '@/lib/telemetry/analyticsIntents': () => ({ enqueueAnalyticsIntent: async () => "intent-key", processAnalyticsIntentSoon: () => {}, enqueueOutsideSaveAndProcessSoon: async (enqueue) => { await enqueue() } }),
    '@/lib/telemetry/activationOccurrences': () => ({ enqueueAuthenticatedConnection: async () => null }),
    '@/lib/prisma': () => ({ user: { findUnique: async () => user } }),
    jsonwebtoken: () => ({ decode: () => ({ aud: 'mcp-api' }) }),
    '@/lib/apiKeys': () => ({}),
    '@/lib/auth/betterAuth': () => {
      if (authFails) throw new Error('module unavailable')
      return { auth: { api: { verifyApiKey: async ({ body }) => {
        verifiedKeys.push(body.key)
        return { valid: true, key: { id: '1', referenceId: '7', prefix: 'htmk_', permissions: { tasks: ['read'] } } }
      } } } }
    },
    '@/lib/auth/getSessionUser': () => ({ getSessionUser: async headers => { sessionHeaders.push(headers); return { userId: 7 } } }),
    '@/lib/mcp/managementPermissions': () => permissions,
    '@/lib/mcp/clientTelemetry': () => ({ logMcpCliUsage: () => {} }),
    '@/lib/flags': () => ({}),
    '@/lib/mcp/managementKeyTeamScope': () => ({ ACCOUNT_MANAGEMENT_KEY_PREFIX: 'htmk_', TEAM_MANAGEMENT_KEY_PREFIX: 'httk_' }),
    './verifyJwt': () => ({ JWT_MCP_AUDIENCE: 'mcp-api', validateJwtToken: async token => token === 'jwt-fixture' ? context : null }),
    '../operationContext': () => ({ getMcpOperationContext: () => null }),
  })
  return { ...loaded, user, context, verifiedKeys, sessionHeaders }
}

const request = token => ({ headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}) })
const authModule = '@/lib/auth/betterAuth'
const sessionModule = '@/lib/auth/getSessionUser'

test('MCP JWT auth does not load Better Auth or browser sessions; management keys still verify', async () => {
  const h = sessionHarness()
  assert.equal(h.imports.includes(authModule), false)
  assert.equal(h.imports.includes(sessionModule), false)
  assert.deepEqual(await h.exports.validateMcpAuth(request('jwt-fixture')), h.context)
  assert.equal(h.imports.includes(authModule), false)
  assert.equal(h.imports.includes(sessionModule), false)
  const management = await h.exports.validateManagementApiKey('htmk_fixture')
  assert.deepEqual(management.user, h.user)
  assert.deepEqual(h.verifiedKeys, ['htmk_fixture'])
  assert.equal(h.imports.includes(authModule), true)
  assert.equal(h.imports.includes(sessionModule), false)
})

test('session fallback stays lazy and cannot upgrade a failed bearer credential', async () => {
  const h = sessionHarness()
  assert.equal(await h.exports.validateManagementOrSessionAuth(request('invalid')), null)
  assert.equal(h.imports.includes(sessionModule), false)
  const req = request()
  assert.deepEqual((await h.exports.validateManagementOrSessionAuth(req)).user, h.user)
  assert.deepEqual(h.sessionHeaders, [req.headers])
  assert.equal(h.imports.includes(authModule), false)
})

test('management-key module load failure fails closed', async () => {
  const h = sessionHarness({ authFails: true })
  assert.equal(await h.exports.validateManagementApiKey('htmk_fixture'), null)
  assert.deepEqual(h.verifiedKeys, [])
})

test('flag evaluation does not load sessions; admin owner check still resolves the session', async () => {
  const headers = new Headers()
  const calls = []
  const h = load('src/lib/flags.ts', {
    '@/lib/prisma': () => ({ featureFlag: { findUnique: async () => ({ mode: 'EVERYONE' }) }, user: { findUnique: async () => ({ email: 'valentin.yeo@gmail.com' }) } }),
    react: () => ({ cache: fn => fn }),
    '@/lib/flags/definitions': () => ({ FEATURE_FLAG_DEFINITIONS: [{ key: 'fixture', kind: 'feature' }] }),
    '@/lib/flags/keys': () => ({}),
    [sessionModule]: () => ({ getSessionUser: async received => { calls.push(received); return { userId: 6 } } }),
  })
  assert.equal(h.imports.includes(sessionModule), false)
  assert.equal(await h.exports.isFeatureEnabled('fixture', 7), true)
  assert.equal(h.imports.includes(sessionModule), false)
  assert.equal(await h.exports.isFeatureFlagOwner(headers), true)
  assert.deepEqual(calls, [headers])
})
