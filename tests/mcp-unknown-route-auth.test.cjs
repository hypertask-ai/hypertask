const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const routePath = path.join(root, 'src/app/api/mcp/[...notFound]/route.ts')

function loadRoute(authContext) {
  const javascript = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const calls = { auth: 0, unauthorized: 0 }
  const stubs = {
    'next/server': {
      NextResponse: {
        json: (body, init = {}) => ({
          body,
          status: init.status ?? 200,
          headers: init.headers ?? {},
        }),
      },
    },
    '@/lib/mcp/auth': {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => {
        calls.auth += 1
        return authContext
      },
      mcpUnauthorizedResponse: async () => {
        calls.unauthorized += 1
        return {
          body: { success: false, reason: 'missing_token' },
          status: 401,
        }
      },
    },
  }
  const routeModule = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(
    routeModule,
    routeModule.exports,
    (request) => {
      if (stubs[request]) return stubs[request]
      throw new Error(`Unexpected import: ${request}`)
    }
  )
  return { ...routeModule.exports, calls }
}

const request = { headers: new Headers() }

test('an anonymous caller cannot distinguish an unknown MCP path from a real one', async () => {
  const route = loadRoute(null)

  const response = await route.GET(request)

  assert.equal(response.status, 401)
  assert.equal(response.body.reason, 'missing_token')
  assert.equal(route.calls.auth, 1)
  assert.equal(route.calls.unauthorized, 1)
})

test('an authenticated caller still receives not found for an unknown MCP path', async () => {
  const route = loadRoute({ user: { id: 6, email: 'user@example.com' }, agentId: null })

  const response = await route.GET(request)

  assert.equal(response.status, 404)
  assert.deepEqual(response.body, { error: 'not found' })
  assert.equal(route.calls.auth, 1)
  assert.equal(route.calls.unauthorized, 0)
})
