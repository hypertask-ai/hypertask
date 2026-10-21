const { NextRequest } = require('next/server')
const { load } = require('../task-route-loader.cjs')

const SESSION_SECRET = 'htpr-7158-local-session-fixture'
function sessionModules() {
  process.env.SESSION_SECRET = SESSION_SECRET
  return {
    session: load('src/lib/auth/session.ts', {}),
    edge: load('src/lib/auth/sessionEdge.ts', {}),
  }
}

function harness({ enforce = false, captureError = false, revoked = false } = {}) {
  const { session, edge } = sessionModules()
  const captures = []
  const calls = { verify: 0, revocation: 0, flags: 0 }
  const verifiedEdge = { verifySessionEdge: async (token) => { calls.verify++; return edge.verifySessionEdge(token) } }
  const proxy = load('src/proxy.ts', {
    './utils/edgeHelpers': { isValidUser: (value) => {
      try { const user = JSON.parse(value); return { isValid: !!user?.id, user } }
      catch { return { isValid: false, user: null } }
    } },
    './utils/serverActions': { isMobileDevice: () => false },
    './utils/helperFunctions/helperFunctions': { canAccessTrialPage: () => true },
    '@/lib/auth/sessionEdge': verifiedEdge,
    '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => { calls.revocation++; return revoked } },
    '@/lib/flags': { isFeatureEnabled: async () => { calls.flags++; return enforce } },
    '@/lib/telemetry/signupAnalytics': { recordServerCapture: (capture, options) => {
      captures.push(capture)
      if (captureError === 'throw') throw new Error('fixture capture failed')
      if (captureError) options.onError(new Error('fixture capture failed'))
    } },
  }).default
  function request(pathname, { method = 'GET', kind = 'agent', agentId = 'bridge-agent', bearer = false, profile = true, cookies = {}, host = 'app.hypertask.ai' } = {}) {
    const token = kind === 'none' ? undefined : kind === 'invalid' ? 'invalid' : session.signSession({ id: 7, ...(kind === 'agent' ? { agentId } : {}) })
    const values = {
      ...(token ? { ht_session: token } : {}),
      ...(profile && kind !== 'none' ? { nookies_user: JSON.stringify({ id: 7, UserSetting: { onboardingTourStatus: true } }) } : {}),
      ...cookies,
    }
    return new NextRequest(`https://${host}${pathname}`, {
      method, headers: {
        host,
        cookie: Object.entries(values).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; '),
        ...(bearer ? { Authorization: 'Bearer bogus-independent-credential' } : {}),
      },
    })
  }
  return { proxy, request, captures, calls, session }
}

module.exports = { harness, sessionModules, load }
