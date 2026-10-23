import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import * as cipher from '../../src/lib/auth/oauthTokenCipher'
import { withOAuthTokenStorage } from '../../src/lib/auth/oauthTokenStorage'
import { oauthTokenPrisma } from './oauth-token-prisma'

export function productionAuthOptions(db: unknown = {}): BetterAuthOptions {
  const filename = path.resolve(__dirname, '../../src/lib/auth/betterAuth.ts')
  const inertPlugin = () => ({})
  const mocks: Record<string, unknown> = {
    'better-auth': { betterAuth: (options: BetterAuthOptions) => options },
    'better-auth/adapters/prisma': { prismaAdapter },
    'better-auth/plugins': { emailOTP: inertPlugin, magicLink: inertPlugin, multiSession: inertPlugin },
    '@better-auth/api-key': { apiKey: () => ({ schema: { apikey: { fields: { referenceId: {} } } } }) },
    '@better-auth/infra': { dash: inertPlugin },
    '@better-auth/passkey': { passkey: inertPlugin },
    'better-auth/api': { createAuthMiddleware: (fn: unknown) => fn },
    '@/lib/auth/oauthTokenCipher': cipher,
    '@/lib/auth/oauthTokenStorage': { withOAuthTokenStorage },
    '@/lib/auth/bridgePlugin': { bridgeSessionPlugin: inertPlugin },
    '@/lib/auth/legacyCookiePlugin': { legacyCookiePlugin: inertPlugin },
    '@/lib/prisma': { __esModule: true, default: db },
    'crypto': { randomUUID },
  }
  const output = { exports: {} as { auth: BetterAuthOptions } }
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, {
    module: output, exports: output.exports, process, console,
    require: (specifier: string) => mocks[specifier] ?? {},
  }, { filename })
  return output.exports.auth
}

export async function oauthAuthFixture(transaction = false) {
  const h = oauthTokenPrisma()
  const production = productionAuthOptions(h.db)
  const options: BetterAuthOptions = {
    baseURL: 'https://auth.example.invalid',
    secret: 'synthetic-better-auth-secret-aaaaaaaaaaaaaaaa',
    database: transaction
      ? opts => withOAuthTokenStorage(prismaAdapter(h.db, { provider: 'postgresql', transaction, debugLogs: false })(opts), opts)
      : production.database,
    user: { modelName: 'User', additionalFields: production.user?.additionalFields },
    account: { modelName: 'BetterAuthAccount', encryptOAuthTokens: production.account?.encryptOAuthTokens, accountLinking: { trustedProviders: ['google'] } },
    session: { modelName: 'BetterAuthSession' },
    verification: { modelName: 'BetterAuthVerification' },
    socialProviders: { google: { clientId: 'synthetic-google-client', clientSecret: 'synthetic-google-secret' } },
    advanced: { database: { generateId: 'serial' } },
    databaseHooks: { user: { create: { before: production.databaseHooks!.user!.create!.before } } },
    telemetry: { enabled: false },
    logger: { disabled: true },
  }
  const auth = betterAuth(options)
  const context = await auth.$context
  const tokens = { accessToken: 'synthetic-access-token-cb5a24be', refreshToken: 'synthetic-refresh-token-228ea214', idToken: 'synthetic-id-token-d53a8a98', accessTokenExpiresAt: new Date(Date.now() + 3_600_000), scopes: ['openid', 'email'] }
  let providerUser = { id: 'google-sub', name: 'Synthetic', email: 'synthetic-user@example.invalid', emailVerified: true }
  const providerInputs: unknown[] = []
  let rotation: any = { ...tokens, accessToken: 'synthetic-rotated-access-token-e0adffb4', refreshToken: 'synthetic-rotated-refresh-token-aaaaaaaa', idToken: 'synthetic-rotated-id-token-aaaaaaaa' }
  const provider: any = {
    id: 'google', options: {}, verifyIdToken: async () => true,
    createAuthorizationURL: async ({ state }: any) => new URL(`https://provider.example.invalid/authorize?state=${state}`),
    validateAuthorizationCode: async () => tokens,
    getUserInfo: async (input: unknown) => { providerInputs.push(input); return { user: providerUser, data: {} } },
    refreshAccessToken: async (input: unknown) => { providerInputs.push(input); return rotation },
  }
  context.socialProviders = [provider]
  const cookies = (headers: Headers) => new Headers({ cookie: headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') })
  async function callback(existingHeaders?: Headers, link = false) {
    const start: any = link
      ? await auth.api.linkSocialAccount({ headers: existingHeaders!, body: { provider: 'google', callbackURL: 'https://auth.example.invalid/done' }, returnHeaders: true })
      : await auth.api.signInSocial({ body: { provider: 'google', callbackURL: 'https://auth.example.invalid/done' }, returnHeaders: true })
    const state = new URL(start.response.url).searchParams.get('state')!
    const headers = cookies(start.headers)
    const response = await auth.handler(new Request(`https://auth.example.invalid/api/auth/callback/google?code=synthetic-authorization-code-161b0643&state=${state}`, { headers }))
    return { response, headers: cookies(response.headers) }
  }
  return { ...h, auth, context, tokens, providerInputs, callback, cookies, setProviderUser: (value: typeof providerUser) => { providerUser = value }, setRotation: (value: any) => { rotation = value } }
}
