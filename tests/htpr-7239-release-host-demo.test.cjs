const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')

function load(relativePath, imports = {}) {
  const javascript = ts.transpileModule(readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(mod, mod.exports, (name) => {
    if (name in imports) return imports[name]
    if (name === '@/lib/auth/agentCookieBridgeRoutes') return load('src/lib/auth/agentCookieBridgeRoutes.ts')
    if (name === '@/lib/telemetry/signupAnalytics') return { recordServerCapture: () => {} }
    throw new Error(`Unexpected import: ${name}`)
  })
  return mod.exports
}

const { default: proxy } = load('src/proxy.ts', {
  'next/server': { NextRequest, NextResponse },
  './utils/edgeHelpers': { isValidUser: () => ({ isValid: false, user: null }) },
  './utils/serverActions': { isMobileDevice: () => false },
  './utils/helperFunctions/helperFunctions': { canAccessTrialPage: () => true },
  '@/lib/net/contentEncoding': { refusedContentEncoding: () => undefined },
  '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
  '@/lib/auth/sessionEdge': { verifySessionEdge: async () => null },
  '@/lib/auth/cookieIdentity': { verifyCookieIdentity: async () => ({ status: 'anonymous' }) },
  '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false },
  '@/lib/routing/detailWithoutTicket': { detailWithoutTicketRedirect: () => null },
  '@/lib/tutorial/keyboardShortcutTutorial': {
    isKeyboardShortcutTutorialPath: () => false, hasKeyboardShortcutTutorialQuery: () => false,
  },
})

const RELEASE_HOST = 'hypertasks-prod-abc123-hypertaskai.vercel.app'
const originalVercelEnv = process.env.VERCEL_ENV
test.after(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = originalVercelEnv
})

function signedOut(host, route) {
  return proxy(new NextRequest(`https://${host}${route}`, { headers: { host } }))
}

test('the demo on a production release address moves to app.hypertask.ai', async () => {
  process.env.VERCEL_ENV = 'production'
  for (const route of ['/demo', '/demo?board=welcome']) {
    const response = await signedOut(RELEASE_HOST, route)
    assert.equal(response.status, 307, route)
    assert.equal(response.headers.get('location'), `https://app.hypertask.ai${route}`)
  }
})

test('the release address home still leads to its demo, which then moves to app.hypertask.ai', async () => {
  process.env.VERCEL_ENV = 'production'
  const home = await signedOut(RELEASE_HOST, '/')
  assert.equal(home.status, 307)
  const demo = new URL(home.headers.get('location'))
  assert.equal(demo.pathname, '/demo')
  const moved = await signedOut(RELEASE_HOST, demo.pathname)
  assert.equal(moved.headers.get('location'), 'https://app.hypertask.ai/demo')
})

test('the demo on app.hypertask.ai and on previews stays where it is', async () => {
  process.env.VERCEL_ENV = 'production'
  for (const host of ['app.hypertask.ai', 'demo.hypertask.ai']) {
    const response = await signedOut(host, '/demo')
    assert.equal(response.headers.get('location'), null, host)
  }
  process.env.VERCEL_ENV = 'preview'
  const preview = await signedOut('hypertasks-prod-git-branch-hypertaskai.vercel.app', '/demo')
  assert.equal(preview.headers.get('location'), null)
})

test('API calls on a production release address are not redirected', async () => {
  process.env.VERCEL_ENV = 'production'
  const response = await proxy(new NextRequest(`https://${RELEASE_HOST}/api/cron/cleanup-guests`, {
    headers: { host: RELEASE_HOST, authorization: 'Bearer cron-fixture' },
  }))
  assert.notEqual(response.headers.get('location'), 'https://app.hypertask.ai/api/cron/cleanup-guests')
})
