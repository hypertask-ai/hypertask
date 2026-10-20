const test = require('node:test')
const assert = require('node:assert/strict')
const { sessionModules, load } = require('./helpers/agent-cookie-bridge.cjs')

for (const enforce of [false, true]) {
  for (const current of [false, true]) {
    for (const agent of [false, true]) {
      test(`in-process bridge ${agent ? 'refuses agent' : 'allows human'} with current session=${current}, enforce=${enforce}`, async () => {
        const { session } = sessionModules()
        const events = []
        const { bridgeSessionPlugin } = load('src/lib/auth/bridgePlugin.ts', {
          '@/lib/auth/session': session,
          '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false },
          '@/lib/flags': { isFeatureEnabled: async () => enforce },
          '@/lib/appShellBootstrap/server': { getAppShellBootstrap: async () => { events.push('bootstrap'); return {} } },
          'better-auth/api': {
            APIError: { fromStatus: (status, body) => Object.assign(new Error(body.message), { status, body }) },
            createAuthEndpoint: (_path, _options, handler) => handler,
            getSessionFromCtx: async () => { events.push('current'); return current ? { user: { id: '7' } } : null },
          },
          'better-auth/cookies': { setSessionCookie: async () => events.push('cookie') },
        })
        const token = session.signSession({ id: 7, ...(agent ? { agentId: 'bridge-agent' } : {}) })
        const ctx = {
          getCookie: () => token, setHeader: () => events.push('header'), json: body => body,
          context: { internalAdapter: {
            findUserById: async () => { events.push('user'); return { id: '7' } },
            createSession: async () => { events.push('mint'); return { token: 'fixture' } },
          } },
        }
        const run = () => bridgeSessionPlugin().endpoints.bridgeSession(ctx)
        if (agent) {
          await assert.rejects(run(), { status: 'FORBIDDEN', body: { message: 'Agent cookies cannot create human sessions', code: 'AGENT_COOKIE_ROUTE' } })
          assert.deepEqual(events, [])
        } else {
          assert.deepEqual(await run(), { ok: true, bootstrap: {} })
          assert.deepEqual(events, ['header', 'header', 'bootstrap', 'user', 'current', ...(current ? [] : ['mint', 'cookie'])])
        }
      })
    }
  }
}
