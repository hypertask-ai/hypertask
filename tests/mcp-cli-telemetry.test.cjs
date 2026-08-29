const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})

const {
  identifyMcpCli,
  logMcpCliUsage,
} = jiti(path.join(root, 'src/lib/mcp/clientTelemetry.ts'))

const context = {
  user: { id: 6, email: 'owner@example.test' },
  agentId: 'agent-123',
}

function request(userAgent) {
  return new Request('https://app.hypertask.ai/api/mcp/tasks?project_id=15', {
    method: 'GET',
    headers: userAgent ? { 'User-Agent': userAgent } : {},
  })
}

test('only exact versioned Hypertask CLI user agents are identified', () => {
  assert.deepEqual(identifyMcpCli('hypertask-cli/1.13.29'), {
    client: 'hypertask-cli',
    version: '1.13.29',
  })
  assert.deepEqual(identifyMcpCli('htz/0.2.0'), {
    client: 'htz',
    version: '0.2.0',
  })

  for (const userAgent of [
    null,
    '',
    'axios/1.7.0',
    'hypertask-cli',
    'hypertask-cli/latest',
    'htz/0.2.0 injected',
  ]) {
    assert.equal(identifyMcpCli(userAgent), null)
  }
})

test('CLI usage logs a stable fingerprint and authenticated principal without the bearer token', () => {
  const token = 'test-bearer-token-that-must-not-be-logged'
  const calls = []
  const originalInfo = console.info
  console.info = (...args) => calls.push(args)
  try {
    logMcpCliUsage(request('hypertask-cli/1.13.29'), token, context)
  } finally {
    console.info = originalInfo
  }

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '[MCP CLI Usage]')
  assert.deepEqual(calls[0][1], {
    event: 'mcp_cli_usage',
    client: 'hypertask-cli',
    version: '1.13.29',
    tokenFingerprint: createHash('sha256').update(token).digest('hex'),
    userId: 6,
    agentId: 'agent-123',
    method: 'GET',
    path: '/api/mcp/tasks',
  })
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(token))
})

test('unknown clients do not create CLI usage logs', () => {
  const calls = []
  const originalInfo = console.info
  console.info = (...args) => calls.push(args)
  try {
    logMcpCliUsage(request('Mozilla/5.0'), 'test-token', context)
  } finally {
    console.info = originalInfo
  }
  assert.deepEqual(calls, [])
})
