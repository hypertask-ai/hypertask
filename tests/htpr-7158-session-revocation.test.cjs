const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relativePath, imports = {}) {
  const javascript = ts.transpileModule(readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(mod, mod.exports, (name) => {
    if (name in imports) return imports[name]
    if (name === 'crypto') return require('node:crypto')
    throw new Error(`Unexpected import: ${name}`)
  })
  return mod.exports
}

const originalSecret = process.env.SESSION_SECRET
process.env.SESSION_SECRET = 'htpr-7158-local-session-fixture'
test.after(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = originalSecret
})
const session = load('src/lib/auth/session.ts')

function revocations(redis, getRedis = async () => redis) {
  return load('src/lib/auth/sessionRevocation.ts', {
    '@/lib/auth/session': session,
    '@/lib/redis': { getRedis },
  })
}

function fakeRedis() {
  const store = new Map()
  const calls = { get: [], set: [] }
  return {
    store, calls,
    get: async (key) => { calls.get.push(key); return store.get(key) ?? null },
    set: async (...args) => { calls.set.push(args); store.set(args[0], args[1]); return 'OK' },
  }
}

function legacyToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function signatureAlias(token, mask = 1) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  return token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)) ^ mask]
}

test('new same-second sessions have independent 12-byte jti claims without changing verifier output', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 })
  const user = { id: 7, email: 'fixture@example.test', agentId: 'agent-fixture' }
  const first = session.signSession(user)
  const second = session.signSession(user)
  assert.notEqual(first, second)
  const payload = JSON.parse(Buffer.from(first.split('.')[0], 'base64url'))
  assert.equal(payload.iat, 1800000000)
  assert.equal(Buffer.from(payload.jti, 'base64url').length, 12)
  assert.deepEqual(session.verifySession(first), user)
  assert.equal(session.verifiedSessionExpiry(first), payload.exp)
})

test('legacy cookies without jti still verify and can be revoked', async () => {
  const token = legacyToken({ id: 7, iat: 1, exp: Math.floor(Date.now() / 1000) + 90 })
  const helper = revocations(fakeRedis())
  assert.deepEqual(session.verifySession(token), { id: 7 })
  await helper.revokeSessionToken(token)
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), true)
})

test('all unused-signature-bit aliases share the fingerprint and revocation', async () => {
  const token = session.signSession({ id: 7 })
  const helper = revocations(fakeRedis())
  const fingerprint = createHash('sha256').update(token.split('.')[0]).digest('hex')
  assert.equal(helper.sessionTokenFingerprint(token), fingerprint)
  await helper.revokeSessionToken(token)
  for (const mask of [1, 2, 3]) {
    const alias = signatureAlias(token, mask)
    assert.notEqual(alias, token)
    assert.deepEqual(session.verifySession(alias), { id: 7 })
    assert.equal(helper.sessionTokenFingerprint(alias), fingerprint)
    assert.equal(await helper.isSessionTokenRevoked(alias, { failClosed: true }), true)
  }
  assert.equal(session.verifySession(signatureAlias(token, 16)), null)
})

test('invalid and expired cookies never generate a fingerprint or a Redis operation', async () => {
  const redis = fakeRedis()
  const helper = revocations(redis)
  const valid = session.signSession({ id: 7 })
  const forgedPayload = Buffer.from(JSON.stringify({ id: 8, exp: 9999999999 })).toString('base64url')
  for (const token of [undefined, '', 'garbage', `${forgedPayload}.${valid.split('.')[1]}`, signatureAlias(valid, 16), session.signSession({ id: 7 }, -1)]) {
    assert.equal(helper.sessionTokenFingerprint(token), null)
    assert.equal(session.verifiedSessionExpiry(token), null)
    await helper.revokeSessionToken(token)
    assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: true }), false)
  }
  assert.deepEqual(redis.calls, { get: [], set: [] })
})

test('revoke stores only the payload fingerprint with TTL equal to verified exp minus now', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 })
  const token = session.signSession({ id: 7 }, 120)
  const redis = fakeRedis()
  const helper = revocations(redis)
  t.mock.timers.tick(7000)
  await helper.revokeSessionToken(token)
  assert.deepEqual(redis.calls.set, [[`ht_session:revoked:${helper.sessionTokenFingerprint(token)}`, '1', 'EX', 113]])
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), true)
})

test('another module instance immediately sees revocation after a prior negative lookup', async () => {
  const redis = fakeRedis()
  const a = revocations(redis)
  const b = revocations(redis)
  const token = session.signSession({ id: 7 })
  assert.equal(await a.isSessionTokenRevoked(token, { failClosed: true }), false)
  assert.equal(await a.isSessionTokenRevoked(token, { failClosed: false }), false)
  await b.revokeSessionToken(token)
  assert.equal(await a.isSessionTokenRevoked(token, { failClosed: false }), true)
  assert.equal(redis.calls.get.length, 3)
})

test('only confirmed revocations survive an outage, and expired tokens are ignored', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 })
  const redis = fakeRedis()
  const helper = revocations(redis)
  const token = session.signSession({ id: 7 }, 2)
  await revocations(redis).revokeSessionToken(token)
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), true)
  redis.get = async () => { throw new Error('fake outage') }
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), true)
  t.mock.timers.tick(2000)
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: true }), false)
})

test('Redis errors honor the caller failClosed policy and recovery is not negatively cached', async () => {
  const redis = fakeRedis()
  const helper = revocations(redis)
  const token = session.signSession({ id: 7 })
  redis.get = async () => { throw new Error('fake outage') }
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), false)
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: true }), true)
  redis.get = async () => '1'
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: false }), true)
})

test('Redis GET hangs are deadline bounded in both policies, including client acquisition', async () => {
  for (const failClosed of [false, true]) {
    const helper = revocations({ get: () => new Promise(() => {}) })
    const start = performance.now()
    assert.equal(await helper.isSessionTokenRevoked(session.signSession({ id: 7 }), { failClosed }), failClosed)
    assert.ok(performance.now() - start < 1000)
  }
  const helper = revocations(null, () => new Promise(() => {}))
  const start = performance.now()
  assert.equal(await helper.isSessionTokenRevoked(session.signSession({ id: 7 }), { failClosed: true }), true)
  assert.ok(performance.now() - start < 1000)
})

test('a failed SET retries once and a successful retry confirms revocation', async () => {
  const redis = fakeRedis()
  const set = redis.set
  let attempts = 0
  redis.set = async (...args) => {
    if (++attempts === 1) throw new Error('fake outage')
    return set(...args)
  }
  const helper = revocations(redis)
  const token = session.signSession({ id: 7 })
  await helper.revokeSessionToken(token)
  assert.equal(attempts, 2)
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: true }), true)
})

test('failed writes never throw, log after one retry, and do not falsely cache revocation', async (t) => {
  let attempts = 0
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args))
  const helper = revocations({
    set: async () => { attempts++; throw new Error('fake outage') },
    get: async () => null,
  })
  const token = session.signSession({ id: 7 })
  await assert.doesNotReject(helper.revokeSessionToken(token))
  assert.equal(attempts, 2)
  assert.deepEqual(errors, [['Session token revocation failed after retry']])
  assert.equal(await helper.isSessionTokenRevoked(token, { failClosed: true }), false)
})

test('hanging SETs are bounded across the one retry and logout still completes', async (t) => {
  let attempts = 0
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args))
  const helper = revocations({ set: () => { attempts++; return new Promise(() => {}) } })
  const start = performance.now()
  await helper.revokeSessionToken(session.signSession({ id: 7 }))
  assert.equal(attempts, 2)
  assert.ok(performance.now() - start < 1800)
  assert.equal(errors.length, 1)
})


test('same-second re-login after revocation produces a usable new cookie for the same account', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 })
  const helper = revocations(fakeRedis())
  const oldToken = session.signSession({ id: 7 })
  await helper.revokeSessionToken(oldToken)
  const newToken = session.signSession({ id: 7 })
  assert.deepEqual(session.verifySession(newToken), { id: 7 })
  assert.equal(await helper.isSessionTokenRevoked(oldToken, { failClosed: true }), true)
  assert.equal(await helper.isSessionTokenRevoked(newToken, { failClosed: true }), false)
})
