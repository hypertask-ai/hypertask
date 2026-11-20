import assert from 'node:assert/strict'
import test from 'node:test'
import { betterAuth } from 'better-auth'
import { google } from '@better-auth/core/social-providers'
import { oauthTokenPrisma } from './helpers/oauth-token-prisma'
import { productionAuthOptions } from './helpers/oauth-token-auth'

process.env.GOOGLE_ID = 'htpr-7799-account-chooser-test-client'
process.env.GOOGLE_SECRET = 'htpr-7799-account-chooser-test-secret'

async function signInUrl() {
  const h = oauthTokenPrisma()
  const { hooks, ...options } = productionAuthOptions(h.db)
  const auth = betterAuth({
    ...options,
    baseURL: 'https://app.hypertask.ai',
    secret: 'htpr-7799-account-chooser-test-secret-aaaaaaaa',
    telemetry: { enabled: false },
    logger: { disabled: true },
  })
  const started: any = await auth.api.signInSocial({ body: { provider: 'google', callbackURL: '/' } })
  return { url: new URL(started.url), verifications: h.tables.BetterAuthVerification }
}

test('Continue with Google asks which account every time', async () => {
  const { url, verifications } = await signInUrl()
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('prompt'), 'select_account')
  assert.ok(url.searchParams.get('state'))
  assert.match(url.searchParams.get('scope') ?? '', /email/)
  assert.equal(verifications.length, 1, 'a sign-in that asks for an account still stores its one-time state')
})

test('the configured Google provider is what sends prompt', async () => {
  const configured = productionAuthOptions({}).socialProviders?.google
  assert.ok(configured)
  const url = await google(configured as Parameters<typeof google>[0]).createAuthorizationURL({
    state: 'htpr-7799',
    codeVerifier: 'htpr-7799-code-verifier-aaaaaaaaaaaaaaaaaaaaaaaa',
    redirectURI: 'https://app.hypertask.ai/api/auth/callback/google',
  })
  assert.equal(url.searchParams.get('prompt'), 'select_account')
})
