const test = require('node:test')
const assert = require('node:assert/strict')
const { load, withStubs } = require('./task-route-loader.cjs')

function crashReporter() {
  const reports = []
  let pending = null
  const module = load('src/lib/mcp/operationCrashReport.ts', withStubs({
    '@vercel/functions': { waitUntil: (promise) => { pending = promise } },
    '@/lib/errors/prismaErrorDiagnostics': { prismaErrorDiagnostics: () => ({}) },
    '@/lib/errors/reportError': { reportError: async (report) => { reports.push(report) } },
  }))
  const settle = async () => { for (let i = 0; i < 20 && pending; i++) { const current = pending; pending = null; await current; await new Promise(resolve => setImmediate(resolve)) } }
  return { module, reports, settle }
}

function request(path = '/api/mcp/comments') {
  return { method: 'POST', url: `https://app.test${path}` }
}

test('a 5xx other than 500 is reported with its status and route', async () => {
  const { module, reports, settle } = crashReporter()
  module.reportUnexplainedMcpServerError(request(), 503)
  await settle()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].url, '/api/mcp/comments')
  assert.equal(reports[0].source, 'server')
  assert.match(reports[0].message, /MCP POST \/api\/mcp\/comments answered 503 without reporting its cause/)
  assert.equal(reports[0].extra.status, 503)
  assert.equal(reports[0].extra.route, '/api/mcp/comments')
  assert.equal(reports[0].fingerprintKey, 'mcp:POST:/api/mcp/comments:McpServerErrorWithoutCause:503')
})

test('500 keeps its own Message and fingerprint', async () => {
  const { module, reports, settle } = crashReporter()
  module.reportUnexplainedMcpServerError(request(), 500)
  await settle()
  assert.equal(reports.length, 1)
  assert.match(reports[0].message, /answered 500 without reporting its cause/)
  assert.equal(reports[0].fingerprintKey, 'mcp:POST:/api/mcp/comments:McpServerErrorWithoutCause:500')
})

test('502 and 504 are reported separately from 500', async () => {
  const { module, reports, settle } = crashReporter()
  module.reportUnexplainedMcpServerError(request(), 502)
  await settle()
  module.reportUnexplainedMcpServerError(request(), 504)
  await settle()
  assert.deepEqual(reports.map(report => report.extra.status), [502, 504])
})

test('client errors below 500 and a repeated request are never reported', async () => {
  const { module, reports, settle } = crashReporter()
  module.reportUnexplainedMcpServerError(request(), 404)
  module.reportUnexplainedMcpServerError(request(), 429)
  await settle()
  assert.deepEqual(reports, [])

  const once = request()
  module.reportUnexplainedMcpServerError(once, 503)
  module.reportUnexplainedMcpServerError(once, 502)
  await settle()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].extra.status, 503)
})

test('a thrown operation crash still reports its own error name', async () => {
  const { module, reports, settle } = crashReporter()
  module.reportMcpOperationCrash(request('/api/mcp/comments/8229'), new TypeError('boom'))
  await settle()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].url, '/api/mcp/comments/:id')
  assert.match(reports[0].message, /failed with TypeError/)
  assert.equal(reports[0].extra.status, undefined)
})
