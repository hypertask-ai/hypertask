import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { decodeOAuthToken, OAUTH_TOKEN_FIELDS, OAUTH_TOKEN_PREFIX } from '../src/lib/auth/oauthTokenCipher'
import { oauthAuthFixture } from './helpers/oauth-token-auth'

let original: string | undefined
beforeEach(() => { original = process.env.BYOK_CIPHER_SECRET; process.env.BYOK_CIPHER_SECRET = 'synthetic-cipher-root-aaaaaaaaaaaa' })
afterEach(() => { if (original === undefined) delete process.env.BYOK_CIPHER_SECRET; else process.env.BYOK_CIPHER_SECRET = original })

function storedTokens(h: Awaited<ReturnType<typeof oauthAuthFixture>>, expected: Record<string, any> = h.tokens, index = 0) {
  for (const field of OAUTH_TOKEN_FIELDS) {
    const raw = h.tables.BetterAuthAccount[index][field]
    assert.ok(raw.startsWith(OAUTH_TOKEN_PREFIX))
    assert.notEqual(raw, expected[field])
    assert.equal(decodeOAuthToken(field, raw), expected[field])
  }
}

for (const transaction of [false, true]) {
  test(`still allowed: real OAuth callback signup and returning sign-in transaction=${transaction} keep usable sessions with ciphertext at rest`, async () => {
    const h = await oauthAuthFixture(transaction)
    const signedIn = await h.callback()
    assert.equal(signedIn.response.status, 302)
    assert.equal(signedIn.response.headers.get('location'), 'https://auth.example.invalid/done')
    assert.equal(h.tables.User.length, 1)
    assert.ok(h.tables.User[0].uid.startsWith('ba_'))
    assert.equal(h.tables.BetterAuthSession.length, 1)
    assert.equal(h.calls.find(call => call.model === 'BetterAuthAccount' && call.operation === 'create')?.transaction, transaction)
    storedTokens(h)
    const session = await h.auth.api.getSession({ headers: signedIn.headers })
    assert.equal(session?.user.email, 'synthetic-user@example.invalid')
    const token = await h.auth.api.getAccessToken({ headers: signedIn.headers, body: { providerId: 'google' } })
    assert.equal(token.accessToken, h.tokens.accessToken)
    assert.equal(token.idToken, h.tokens.idToken)
    const info = await h.auth.api.accountInfo({ headers: signedIn.headers, query: { accountId: 'google-sub', providerId: 'google' } })
    assert.equal(info?.user.email, 'synthetic-user@example.invalid')
    const received: any = h.providerInputs.at(-1)
    assert.equal(received.accessToken, h.tokens.accessToken)
    assert.equal(received.idToken, h.tokens.idToken)
    await h.callback()
    assert.equal(h.tables.User.length, 1)
    assert.equal(h.tables.BetterAuthAccount.length, 1)
    storedTokens(h)
    const listed = await h.auth.api.listUserAccounts({ headers: signedIn.headers })
    for (const field of [...OAUTH_TOKEN_FIELDS, 'password']) assert.equal(Object.hasOwn(listed[0], field), false)
  })

  test(`now refused: missing and short key stop OAuth signup before user.create transaction=${transaction}`, async () => {
    for (const secret of [undefined, 'synthetic-short']) {
      const h = await oauthAuthFixture(transaction)
      if (secret === undefined) delete process.env.BYOK_CIPHER_SECRET
      else process.env.BYOK_CIPHER_SECRET = secret
      const result = await h.callback()
      assert.equal(result.response.status, 302)
      assert.ok(result.response.headers.get('location')?.includes('error='))
      assert.equal(h.calls.filter(call => call.model === 'User' && call.operation === 'create').length, 0)
      assert.equal(h.tables.User.length, 0)
      assert.equal(h.tables.BetterAuthAccount.length, 0)
      assert.equal(h.tables.BetterAuthSession.length, 0)
    }
  })
}

test('still allowed: implicit and redirect linking encrypt all tokens for the existing owner', async () => {
  const h = await oauthAuthFixture()
  await h.context.internalAdapter.createUser({ name: 'Synthetic', email: 'synthetic-user@example.invalid', emailVerified: true })
  const signedIn = await h.callback()
  assert.equal(signedIn.response.headers.get('location'), 'https://auth.example.invalid/done')
  assert.equal(h.tables.User.length, 1)
  storedTokens(h)
  h.setProviderUser({ id: 'google-linked-sub', name: 'Synthetic', email: 'synthetic-user@example.invalid', emailVerified: true })
  const linked = await h.callback(signedIn.headers, true)
  assert.equal(linked.response.headers.get('location'), 'https://auth.example.invalid/done')
  assert.equal(h.tables.BetterAuthAccount.length, 2)
  storedTokens(h, h.tokens, 1)
})

test('still allowed: direct ID-token linking stores access, refresh and ID only as ciphertext', async () => {
  const h = await oauthAuthFixture()
  const signedIn = await h.callback()
  h.setProviderUser({ id: 'google-direct-link-sub', name: 'Synthetic', email: 'synthetic-user@example.invalid', emailVerified: true })
  const linked = await h.auth.api.linkSocialAccount({ headers: signedIn.headers, body: {
    provider: 'google', idToken: { token: h.tokens.idToken, accessToken: h.tokens.accessToken, refreshToken: h.tokens.refreshToken },
  } })
  assert.equal(linked.status, true)
  assert.equal(h.tables.BetterAuthAccount.length, 2)
  storedTokens(h, h.tokens, 1)
})

test('now refused: direct ID-token linking still denies different-email accounts without an account write', async () => {
  const h = await oauthAuthFixture()
  const signedIn = await h.callback()
  h.setProviderUser({ id: 'google-other-sub', name: 'Other', email: 'other-synthetic@example.invalid', emailVerified: true })
  const writes = h.calls.filter(call => call.model === 'BetterAuthAccount' && call.operation === 'create').length
  await assert.rejects(h.auth.api.linkSocialAccount({ headers: signedIn.headers, body: { provider: 'google', idToken: { token: h.tokens.idToken } } }))
  assert.equal(h.calls.filter(call => call.model === 'BetterAuthAccount' && call.operation === 'create').length, writes)
})

test('still allowed: refresh rotation and automatic get-access-token refresh use plaintext at the provider boundary', async () => {
  const h = await oauthAuthFixture()
  const signedIn = await h.callback()
  const rotated: any = await h.auth.api.refreshToken({ headers: signedIn.headers, body: { providerId: 'google' } })
  assert.equal(h.providerInputs.at(-1), h.tokens.refreshToken)
  assert.ok(rotated.accessToken.startsWith('synthetic-rotated-access-token-'))
  storedTokens(h, rotated)
  h.setRotation({ accessToken: 'synthetic-second-access-token-3ac588d1', accessTokenExpiresAt: new Date(Date.now() + 3_600_000) })
  const retained: any = await h.auth.api.refreshToken({ headers: signedIn.headers, body: { providerId: 'google' } })
  assert.equal(retained.refreshToken, rotated.refreshToken)
  assert.equal(retained.idToken, rotated.idToken)
  storedTokens(h, retained)
  h.tables.BetterAuthAccount[0].accessTokenExpiresAt = new Date(0)
  const refreshed = await h.auth.api.getAccessToken({ headers: signedIn.headers, body: { providerId: 'google' } })
  assert.equal(refreshed.accessToken, retained.accessToken)
  assert.equal(refreshed.idToken, retained.idToken)
  assert.equal(h.providerInputs.at(-1), rotated.refreshToken)
  storedTokens(h, retained)
})

test('now refused: corrupt stored tokens never reach get-access-token or the account-info provider', async () => {
  const h = await oauthAuthFixture()
  const signedIn = await h.callback()
  h.tables.BetterAuthAccount[0].idToken = `${OAUTH_TOKEN_PREFIX}synthetic-corrupt-id-token`
  const reads = h.providerInputs.length
  await assert.rejects(h.auth.api.getAccessToken({ headers: signedIn.headers, body: { providerId: 'google' } }))
  await assert.rejects(h.auth.api.accountInfo({ headers: signedIn.headers, query: { accountId: 'google-sub', providerId: 'google' } }))
  assert.equal(h.providerInputs.length, reads)
})
