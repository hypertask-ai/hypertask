import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { BetterAuthOptions } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { withOAuthTokenStorage } from '../src/lib/auth/oauthTokenStorage'
import { decodeOAuthToken, encodeOAuthToken, OAUTH_TOKEN_FIELDS, OAUTH_TOKEN_PREFIX } from '../src/lib/auth/oauthTokenCipher'
import { oauthTokenPrisma } from './helpers/oauth-token-prisma'

let original: string | undefined
beforeEach(() => { original = process.env.BYOK_CIPHER_SECRET; process.env.BYOK_CIPHER_SECRET = 'synthetic-cipher-root-aaaaaaaaaaaa' })
afterEach(() => { if (original === undefined) delete process.env.BYOK_CIPHER_SECRET; else process.env.BYOK_CIPHER_SECRET = original })
const tokens = { accessToken: 'synthetic-access-token-79e616d6', refreshToken: 'synthetic-refresh-token-aaaaaaaa', idToken: 'synthetic-id-token-20529236' }
const options: BetterAuthOptions = {
  user: { modelName: 'User', additionalFields: { accessToken: { type: 'string', required: false } } },
  account: { modelName: 'BetterAuthAccount', encryptOAuthTokens: false, additionalFields: { counter: { type: 'number', defaultValue: 0 } } },
  advanced: { database: { generateId: 'serial' } },
}
function fixture(transaction = false, joins = false) {
  const h = oauthTokenPrisma()
  const config = { ...options, experimental: { joins } }
  const rawAdapter = prismaAdapter(h.db, { provider: 'postgresql', transaction, debugLogs: false })(config)
  return { ...h, config, rawAdapter, adapter: withOAuthTokenStorage(rawAdapter, config) }
}
const where = [{ field: 'id', value: '1' }]
const accountData = { accountId: 'google-sub', providerId: 'google', userId: '1', createdAt: new Date(), updatedAt: new Date(), ...tokens }
function assertStored(h: ReturnType<typeof fixture>, expected = tokens) {
  for (const field of OAUTH_TOKEN_FIELDS) {
    const raw = h.tables.BetterAuthAccount[0][field]
    assert.ok(raw.startsWith(OAUTH_TOKEN_PREFIX))
    assert.notEqual(raw, expected[field])
    assert.equal(decodeOAuthToken(field, raw), expected[field])
  }
}

test('transform evaluation: schema transforms protect writes but fail the mandatory token-predicate rejection', async () => {
  const h = oauthTokenPrisma()
  const config: BetterAuthOptions = { ...options, plugins: [{
    id: 'evaluate-oauth-transforms', schema: { account: { fields: Object.fromEntries(OAUTH_TOKEN_FIELDS.map(field => [field, {
      type: 'string' as const, required: false,
      transform: { input: (value: unknown) => encodeOAuthToken(field, value as string), output: (value: unknown) => decodeOAuthToken(field, value as string) },
    }])) } },
  }] }
  const adapter = prismaAdapter(h.db, { provider: 'postgresql', debugLogs: false })(config)
  const result = await adapter.create<any>({ model: 'account', data: accountData })
  assert.equal(result.accessToken, tokens.accessToken)
  assert.ok(h.tables.BetterAuthAccount[0].accessToken.startsWith(OAUTH_TOKEN_PREFIX))
  const matched = await adapter.findOne({ model: 'account', where: [{ field: 'accessToken', value: tokens.accessToken }] })
  assert.equal(matched, null)
  assert.equal(h.calls.at(-1)?.operation, 'findFirst')
  assert.equal(h.calls.at(-1)?.args.where.accessToken.equals, tokens.accessToken)
})

for (const transaction of [false, true]) {
  test(`still allowed: installed Prisma adapter transaction=${transaction} encrypts all writes and decodes reads and atomic results`, async () => {
    const h = fixture(transaction)
    await h.adapter.transaction(async tx => {
      const account = await tx.create<any>({ model: 'account', data: accountData })
      assert.equal(account.idToken, tokens.idToken)
      assertStored(h)
    })
    assert.equal(h.calls.find(call => call.operation === 'create')?.transaction, transaction)
    assert.equal((await h.adapter.findOne<any>({ model: 'account', where }))?.accessToken, tokens.accessToken)
    assert.equal((await h.adapter.findMany<any>({ model: 'account' }))[0].refreshToken, tokens.refreshToken)
    assert.equal(await h.adapter.count({ model: 'account' }), 1)
    const selected = await h.adapter.findOne<any>({ model: 'account', where, select: ['idToken'] })
    assert.deepEqual(selected, { idToken: tokens.idToken })
    assert.equal(await h.adapter.updateMany({ model: 'account', where, update: tokens }), 1)
    assertStored(h)
    const updated = await h.adapter.update<any>({ model: 'account', where, update: { accessToken: tokens.accessToken } })
    assert.equal(updated.refreshToken, tokens.refreshToken)
    const atomic = await h.adapter.incrementOne<any>({ model: 'account', where, increment: { counter: 1 }, set: tokens })
    assert.equal(atomic.counter, 1)
    assert.equal(atomic.idToken, tokens.idToken)
    assertStored(h)
    const consumed = await h.adapter.consumeOne<any>({ model: 'account', where })
    assert.equal(consumed.accessToken, tokens.accessToken)
    assert.equal(h.tables.BetterAuthAccount.length, 0)
    assert.equal(await h.adapter.consumeOne({ model: 'account', where }), null)
    assert.equal(await h.adapter.incrementOne({ model: 'account', where, increment: { counter: 1 }, set: tokens }), null)
    assert.equal(await h.adapter.update({ model: 'account', where, update: tokens }), null)
  })
}

for (const joins of [false, true]) {
  test(`still allowed: ${joins ? 'native' : 'fallback'} user-to-account joins decode only the account relation`, async () => {
    const h = fixture(false, joins)
    await h.adapter.create({ model: 'user', data: { email: 'synthetic-user@example.invalid', name: 'Synthetic', emailVerified: true, accessToken: tokens.accessToken } })
    await h.adapter.create({ model: 'account', data: accountData })
    const user = await h.adapter.findOne<any>({ model: 'user', where, join: { account: true } })
    assert.equal(user.accessToken, tokens.accessToken)
    assert.equal(h.tables.User[0].accessToken, tokens.accessToken)
    assert.equal(user.account[0].accessToken, tokens.accessToken)
    assertStored(h)
    const users = await h.adapter.findMany<any>({ model: 'user', join: { account: true } })
    assert.equal(users[0].account[0].idToken, tokens.idToken)
  })
}

test('still allowed: marker-looking writer input, legacy hex and omitted/null/empty fields preserve semantics', async () => {
  const h = fixture()
  await h.adapter.create({ model: 'account', data: { ...accountData, accessToken: `${OAUTH_TOKEN_PREFIX}synthetic-plaintext`, refreshToken: '', idToken: null } })
  const account = await h.adapter.findOne<any>({ model: 'account', where })
  assert.equal(account.accessToken, `${OAUTH_TOKEN_PREFIX}synthetic-plaintext`)
  assert.equal(account.refreshToken, '')
  assert.equal(account.idToken, null)
  h.tables.BetterAuthAccount[0].accessToken = 'deadbeef'
  assert.equal((await h.adapter.findOne<any>({ model: 'account', where }))?.accessToken, 'deadbeef')
  await h.adapter.update({ model: 'account', where, update: { scope: 'openid' } })
  assert.equal(h.tables.BetterAuthAccount[0].accessToken, 'deadbeef')
})

for (const method of ['findOne', 'findMany', 'count', 'update', 'updateMany', 'delete', 'deleteMany', 'consumeOne', 'incrementOne'] as const) {
  test(`now refused: ${method} rejects every token-field predicate before persistence`, async () => {
    const h = fixture()
    for (const field of OAUTH_TOKEN_FIELDS) {
      await assert.rejects((h.adapter[method] as any)({ model: 'account', where: [{ field, value: tokens[field] }], update: tokens, increment: { counter: 1 }, set: tokens }), /^Error: oauth_token_storage_failed$/)
    }
    assert.equal(h.calls.length, 0)
  })
}

test('now refused: numeric token increments, token sorting and non-string token writes never reach Prisma', async () => {
  const h = fixture()
  for (const field of OAUTH_TOKEN_FIELDS) {
    await assert.rejects(h.adapter.incrementOne({ model: 'account', where, increment: { [field]: 1 } }), /^Error: oauth_token_storage_failed$/)
    await assert.rejects(h.adapter.findMany({ model: 'account', sortBy: { field, direction: 'asc' } }), /^Error: oauth_token_storage_failed$/)
    await assert.rejects(h.adapter.update({ model: 'account', where, update: { [field]: { set: tokens[field] } } }), /^Error: oauth_token_storage_failed$/)
  }
  assert.equal(h.calls.length, 0)
})

test('now refused: tampered stored ciphertext and injected database failures expose only sanitized categories', async t => {
  const h = fixture()
  const logs: unknown[] = []
  for (const method of ['log', 'warn', 'error', 'debug'] as const) t.mock.method(console, method, (...args) => { logs.push(args) })
  await h.adapter.create({ model: 'account', data: accountData })
  h.tables.BetterAuthAccount[0].accessToken = `${OAUTH_TOKEN_PREFIX}synthetic-invalid-envelope`
  await assert.rejects(h.adapter.findOne({ model: 'account', where }), error => error instanceof Error && error.message === 'oauth_token_storage_failed' && !error.cause)
  h.setFailure(new Error(tokens.accessToken))
  await assert.rejects(h.adapter.update({ model: 'account', where, update: tokens }), /^Error: oauth_token_storage_failed$/)
  for (const raw of Object.values(tokens)) assert.equal(JSON.stringify(logs).includes(raw), false)
})

test('installed adapter method inventory and option identity stay inside the reviewed boundary', () => {
  const h = fixture()
  assert.equal(h.adapter.options, h.rawAdapter.options)
  assert.deepEqual(Object.keys(h.rawAdapter).filter(key => typeof (h.rawAdapter as any)[key] === 'function').sort(), [
    'consumeOne', 'count', 'create', 'delete', 'deleteMany', 'findMany', 'findOne', 'incrementOne', 'transaction', 'update', 'updateMany',
  ])
})

test('now refused: stored field swaps fail closed through the installed account adapter', async () => {
  const h = fixture()
  await h.adapter.create({ model: 'account', data: accountData })
  h.tables.BetterAuthAccount[0].idToken = h.tables.BetterAuthAccount[0].accessToken
  await assert.rejects(h.adapter.findOne({ model: 'account', where }), /^Error: oauth_token_storage_failed$/)
})
