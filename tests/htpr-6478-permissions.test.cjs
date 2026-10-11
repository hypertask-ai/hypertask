const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')
const jwt = require('jsonwebtoken')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const context = jiti(path.join(root, 'src/lib/mcp/operationContext.ts'))
const permissions = jiti(path.join(root, 'src/lib/mcp/managementPermissions.ts'))
const denied = () => { throw new Error('Unexpected credential or database lookup') }
function load(file, stubs) {
  const loadedModule = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('module', 'exports', 'require', source)(loadedModule, loadedModule.exports, (name) => {
    assert.ok(name in stubs, `Unexpected import ${name}`)
    return stubs[name]
  })
  return loadedModule.exports
}
let publicAuthCalls = 0
const session = load('src/lib/mcp/auth/session.ts', {
    '@/lib/telemetry/activationOccurrences': { recordAuthenticatedConnection: () => {} },
  'next/server': { NextRequest }, '@/lib/prisma': {}, jsonwebtoken: jwt,
  '@/lib/apiKeys': {}, '@/lib/auth/betterAuth': { auth: { api: { verifyApiKey: denied } } },
  '@/lib/auth/getSessionUser': { getSessionUser: denied },
  '@/lib/mcp/managementPermissions': permissions,
  '@/lib/mcp/clientTelemetry': { logMcpCliUsage: () => {} }, '@/lib/flags': {},
  '@/lib/mcp/managementKeyTeamScope': { ACCOUNT_MANAGEMENT_KEY_PREFIX: 'htmk_', TEAM_MANAGEMENT_KEY_PREFIX: 'httmk_' },
  './verifyJwt': { JWT_MCP_AUDIENCE: 'mcp-api', validateJwtToken: async () => { publicAuthCalls++; return null } },
  '../operationContext': context,
})
const user = { id: 42, email: 'fixture@example.com' }
const human = { user, agentId: null }
const token = jwt.sign({ aud: 'mcp-api' }, require('node:crypto').randomBytes(32))
function request(bearer, auth, checked = true) {
  const req = new NextRequest('http://mcp.internal/mcp/tasks', { headers: { Authorization: `Bearer ${bearer}` } })
  if (auth) context.bindMcpOperationContext(req, auth, checked)
  return req
}
test('in-process data auth retains agent identity and runtime-generation fence without another credential lookup', async () => {
  const agent = { user, agentId: 'agent-fixture', agentRuntimeGeneration: 19 }
  assert.equal(await session.validateMcpAuth(request(token, agent)), agent)
  assert.equal(publicAuthCalls, 0)
})
test('management-only and team-scoped keys cannot reuse their context to gain data access', async () => {
  for (const team of [false, true]) {
    const auth = { ...human, management: { keyId: 'fixture', permissions: { management: ['read'] }, ...(team ? { teamId: 'team-fixture', teamAccessBinding: 'binding-fixture' } : {}) } }
    const req = request('htmk_fixture', auth)
    assert.equal(await session.validateMcpAuth(req), null)
    assert.equal(await session.validateMcpAuth(req, { deferManagementPermissionCheck: true }), auth)
    assert.equal(await session.validateManagementAuth(req, 'read'), auth)
    assert.equal(await session.validateManagementAuth(req, 'write'), null)
  }
})
test('full and usage-scoped management keys retain the existing permission rules', async () => {
  const full = { ...human, management: { keyId: 'full', permissions: permissions.FULL_MANAGEMENT_KEY_PERMISSIONS } }
  const req = request('htmk_fixture', full)
  assert.equal(await session.validateMcpAuth(req), full)
  assert.equal(await session.validateManagementAuth(req, 'write'), full)
  assert.equal(await session.validateUsageReadAuth(req), full)
  const usage = { ...human, management: { keyId: 'usage', permissions: permissions.USAGE_READ_KEY_PERMISSIONS } }
  const usageReq = request('htmk_fixture', usage)
  assert.equal(await session.validateMcpAuth(usageReq), null)
  assert.equal(await session.validateUsageReadAuth(usageReq), usage)
  assert.equal(await session.validateManagementAuth(usageReq, 'write'), null)
})
test('management routes still reject agents, data keys, legacy JWT audiences and usage through human JWTs', async () => {
  assert.equal(await session.validateManagementAuth(request(token, { ...human, agentId: 'agent-fixture' }), 'write'), null)
  assert.equal(await session.validateManagementAuth(request('htk_fixture', human), 'write'), null)
  const legacy = jwt.sign({ aud: 'legacy' }, require('node:crypto').randomBytes(32))
  assert.equal(await session.validateManagementAuth(request(legacy, human), 'write'), null)
  assert.equal(await session.validateManagementAuth(request(token, human), 'usage:read'), null)
  assert.equal(await session.validateManagementAuth(request(token, human), 'write'), human)
})
test('unbound REST requests still perform their existing authentication pass', async () => {
  const before = publicAuthCalls
  assert.equal(await session.validateMcpAuth(request(token)), null)
  assert.equal(publicAuthCalls, before + 1)
})
let increments = 0
const rate = load('src/lib/mcp/auth/rateLimit.ts', {
  'next/server': require('next/server'), crypto: require('node:crypto'),
  '@/lib/redis': { getRedis: async () => ({ incr: async () => ++increments, expire: async () => {} }) },
  '@/lib/mcp/rateLimitDecision': jiti(path.join(root, 'src/lib/mcp/rateLimitDecision.ts')),
  './session': session, '../operationContext': context,
})
test('only the internally checked operation request skips rate limiting; REST and unchecked internal requests still count', async () => {
  increments = 0
  assert.equal(await rate.checkMcpRateLimit(request(token, human)), null)
  assert.equal(increments, 0)
  assert.equal(await rate.checkMcpRateLimit(request(token, human, false)), null)
  assert.equal(increments, 1)
  assert.equal(await rate.checkMcpRateLimit(request(token)), null)
  assert.equal(increments, 2)
})
