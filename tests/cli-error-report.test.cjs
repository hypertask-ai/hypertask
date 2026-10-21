const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { NextRequest } = require('next/server')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let authorized, userId, counts, calls, redisFails, authRequests
stub('src/lib/mcp/auth.ts', {
  validateMcpAuth: async (request, options) => {
    assert.deepEqual(options, { deferManagementPermissionCheck: true })
    authRequests.push(request)
    return authorized ? { user: { id: userId, email: 'private@example.test' }, agentId: 'private-agent' } : null
  },
  mcpUnauthorizedResponse: (request) => {
    assert.equal(request, authRequests.at(-1))
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  },
})
stub('src/lib/redis.ts', { getRedis: async () => {
  if (redisFails) throw new Error('private redis connection details')
  return { eval: async (script, keys, key) => {
    assert.equal(keys, 1)
    assert.match(script, /local count = redis.call\('INCR', KEYS\[1\]\)/)
    assert.match(script, /if count == 1 then redis.call\('EXPIRE', KEYS\[1\], 3600\) end/)
    assert.match(script, /return count/)
    assert.equal(key, `cli-error:quota:${userId}`)
    calls.push(key)
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    return count
  } }
} })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const cli = jiti('../src/app/api/mcp/cli-error/route.ts')
const report = { command: 'task create', error: 'ApiFailure', status: 503, version: '0.2.0', os: 'linux' }
const request = (body = report) => new NextRequest('https://api.hypertask.ai/api/mcp/cli-error', {
  method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test.beforeEach(() => { authorized = true; userId = 42; counts = new Map(); calls = []; redisFails = false; authRequests = [] })

test('valid report returns empty 204 and exactly one privacy-limited single-string log', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  const response = await cli.POST(request())
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [['[cli-error] task create: ApiFailure (HTTP 503) v0.2.0 linux']])
  assert.deepEqual(calls, ['cli-error:quota:42'])
})

test('extra keys including free text, ids and ticket content return 400 without logging or quota use', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (const extra of [{ note: 'private content' }, { userId: 6 }, { ticketId: 123 }, { arguments: {} }]) {
    const response = await cli.POST(request({ ...report, ...extra }))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Invalid CLI error report' })
  }
  assert.equal(log.mock.callCount(), 0)
  assert.deepEqual(calls, [])
})

test('CLI alias still accepts the exact contract without status', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  const { status, ...body } = report
  assert.equal((await cli.POST(request(body))).status, 204)
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [['[cli-error] task create: ApiFailure v0.2.0 linux']])
})

test('free text, excess words, excess length and line breaks in command return 400', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (const command of ['', 'task create "private title"', 'task create private title', 'Task create', 'task\ncreate', 'task create\n', 'task  create', 'task/create', 'a'.repeat(61)]) {
    assert.equal((await cli.POST(request({ ...report, command }))).status, 400, JSON.stringify(command))
  }
  assert.equal(log.mock.callCount(), 0)
  assert.deepEqual(calls, [])
})

test('one to three lowercase command words and boundary lengths are still allowed', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (const command of ['login', 'task create', 'agent run list', 'task-2 get', 'a'.repeat(60)]) {
    assert.equal((await cli.POST(request({ ...report, command }))).status, 204, command)
  }
  assert.equal(log.mock.callCount(), 5)
})

test('unauthenticated callers receive the MCP 401 without logging or quota use', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  authorized = false
  assert.equal((await cli.POST(request())).status, 401)
  assert.equal(log.mock.callCount(), 0)
  assert.deepEqual(calls, [])
})

test('authenticated non-owner agent callers remain allowed with deferred management checks', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  userId = 999
  assert.equal((await cli.POST(request())).status, 204)
  assert.equal(log.mock.callCount(), 1)
  assert.deepEqual(calls, ['cli-error:quota:999'])
})

test('only the first 30 reports per user log; over quota is an empty 204', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (let i = 0; i < 31; i++) {
    const response = await cli.POST(request())
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
  }
  assert.equal(log.mock.callCount(), 30)
  assert.equal(counts.get('cli-error:quota:42'), 31)
})

test('a separate user is still allowed after another exhausts their quota', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  counts.set('cli-error:quota:42', 30)
  assert.equal((await cli.POST(request())).status, 204)
  assert.equal(log.mock.callCount(), 0)
  userId = 43
  assert.equal((await cli.POST(request())).status, 204)
  assert.equal(log.mock.callCount(), 1)
  assert.deepEqual(calls, ['cli-error:quota:42', 'cli-error:quota:43'])
})

test('invalid errors, statuses, versions, OSes and malformed JSON return 400 without logging', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  const invalid = [
    ...['', '1Failure', 'Api_Failure', 'private error text', 'A'.repeat(65), 'ApiFailure\n'].map(error => ({ ...report, error })),
    ...[99, 600, 503.5, '503', null].map(status => ({ ...report, status })),
    ...['', '0.2', 'private text', '0.2.0\n', `0.2.0-${'a'.repeat(27)}`].map(version => ({ ...report, version })),
    ...['darwin', 'Linux', 'linux\n', null].map(os => ({ ...report, os })),
    {}, null, [], '{',
  ]
  for (const body of invalid) assert.equal((await cli.POST(request(body))).status, 400, JSON.stringify(body))
  assert.equal(log.mock.callCount(), 0)
  assert.deepEqual(calls, [])
})

test('valid Zig names, status boundaries, semver metadata and every OS remain allowed', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (const os of ['linux', 'macos', 'windows', 'other']) {
    assert.equal((await cli.POST(request({ ...report, os, error: 'A'.repeat(64), status: 100, version: '0.2.0-beta.1+abc' }))).status, 204)
  }
  assert.equal((await cli.POST(request({ ...report, status: 599, version: `0.2.0-${'a'.repeat(26)}` }))).status, 204)
  assert.equal(log.mock.callCount(), 5)
})

test('quota storage failure returns safe 503 without logging submitted data or connection details', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  redisFails = true
  const response = await cli.POST(request())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'Unable to report CLI error' })
  assert.equal(log.mock.callCount(), 0)
})
