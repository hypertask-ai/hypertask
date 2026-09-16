import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { handleMcpHttp } from '../src/lib/mcp-server/mcp-http'
import {
  handleStatelessMcpRequest,
  type PortableTool,
} from '../src/lib/mcp-server/stateless-http'

const echoTool: PortableTool = {
  name: 'echo',
  description: 'Repeat the text',
  parameters: z.object({ text: z.string() }),
  execute: async (args, token) => {
    const text = typeof args === 'object' && args && 'text' in args ? String(args.text) : ''
    return JSON.stringify({ text, token })
  },
}

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  options: {
    id?: string | number
    token?: string | null
    sessionId?: string
    accept?: string
  } = {}
): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: options.accept ?? 'application/json, text/event-stream',
  })
  if (options.token !== null) {
    headers.set('Authorization', `Bearer ${options.token ?? 'test-token'}`)
  }
  if (options.sessionId) headers.set('Mcp-Session-Id', options.sessionId)
  return new Request('https://mcp.hypertask.ai/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: options.id ?? 1,
      method,
      params,
    }),
  })
}

function instance() {
  return (request: Request) =>
    handleStatelessMcpRequest(request, { token: 'test-token', clientId: '6' }, [echoTool])
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

test('two isolated instances interleave initialize, tools/list, and tools/call without session state', async () => {
  const instanceA = instance()
  const instanceB = instance()

  const initialize = await instanceA(
    rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'connector-check', version: '1' },
    })
  )
  assert.equal(initialize.status, 200)
  assert.equal(initialize.headers.get('mcp-session-id'), null)
  const initialized = await json(initialize)
  assert.equal(initialized.result.protocolVersion, '2025-03-26')
  assert.equal(initialized.result.serverInfo.name, 'hyperTask')

  const listed = await instanceB(
    rpc('tools/list', {}, { id: 2, sessionId: 'session-from-another-host' })
  )
  assert.equal(listed.status, 200)
  assert.equal(listed.headers.get('mcp-session-id'), null)
  const tools = await json(listed)
  assert.equal(tools.result.tools[0].name, 'echo')

  const callOnA = await instanceA(
    rpc('tools/call', { name: 'echo', arguments: { text: 'alpha' } }, { id: 3 })
  )
  const callOnB = await instanceB(
    rpc('tools/call', { name: 'echo', arguments: { text: 'beta' } }, { id: 4 })
  )
  assert.equal(callOnA.status, 200)
  assert.equal(callOnB.status, 200)
  assert.match((await json(callOnA)).result.content[0].text, /alpha/)
  assert.match((await json(callOnB)).result.content[0].text, /beta/)
})

test('connector-style probe: POST /mcp without a token is 401 and does not require a session', async () => {
  const response = await handleStatelessMcpRequest(
    rpc(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'directory', version: '1' },
      },
      { token: null }
    ),
    null,
    [echoTool]
  )
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('mcp-session-id'), null)
  const challenge = response.headers.get('www-authenticate') ?? ''
  assert.match(challenge, /Bearer/)
  assert.match(challenge, /resource_metadata=/)
})

test('GET and DELETE are 405 once authenticated because there is no session to resume or cancel', async () => {
  const auth = { token: 'test-token', clientId: '6' }
  const headers = { Authorization: 'Bearer test-token' }
  const get = await handleStatelessMcpRequest(
    new Request('https://mcp.hypertask.ai/mcp', { method: 'GET', headers }),
    auth,
    [echoTool]
  )
  const del = await handleStatelessMcpRequest(
    new Request('https://mcp.hypertask.ai/mcp', { method: 'DELETE', headers }),
    auth,
    [echoTool]
  )
  assert.equal(get.status, 405)
  assert.equal(del.status, 405)
})

test('null bodies and null batch entries return JSON-RPC -32600 without dropping valid siblings', async () => {
  const auth = { token: 'test-token', clientId: '6' }
  const headers = {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const topLevelNull = await handleStatelessMcpRequest(
    new Request('https://mcp.hypertask.ai/mcp', { method: 'POST', headers, body: 'null' }),
    auth,
    [echoTool]
  )
  assert.equal(topLevelNull.status, 400)
  assert.equal((await json(topLevelNull)).error.code, -32600)

  const batch = await handleStatelessMcpRequest(
    new Request('https://mcp.hypertask.ai/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify([null, { jsonrpc: '2.0', id: 1, method: 'ping' }]),
    }),
    auth,
    [echoTool]
  )
  assert.equal(batch.status, 200)
  const batchBody = (await batch.json()) as Array<Record<string, any>>
  assert.equal(batchBody.length, 2)
  assert.equal(batchBody[0].error.code, -32600)
  assert.deepEqual(batchBody[1].result, {})
})

test('stateless tools/call omits client Mcp-Session-Id from the tool invocation', async () => {
  let invocation:
    | { requestId: string; clientFingerprint: string; sessionId?: string }
    | undefined
  const probe: PortableTool = {
    name: 'probe',
    description: 'Capture invocation',
    parameters: z.object({}),
    execute: async (_args, _token, next) => {
      invocation = next
      return 'ok'
    },
  }
  const response = await handleStatelessMcpRequest(
    rpc('tools/call', { name: 'probe', arguments: {} }, { sessionId: 'legacy-session' }),
    { token: 'test-token', clientId: '6' },
    [probe]
  )
  assert.equal(response.status, 200)
  assert.equal(invocation?.sessionId, undefined)
  assert.ok(invocation?.requestId)
  assert.ok(invocation?.clientFingerprint)
})

function publicHandler(options: { deferred?: boolean } = {}) {
  return (request: Request) =>
    handleMcpHttp(request, {
      authenticate: async (_request, token) =>
        token ? { token, clientId: '985' } : null,
      tools: [echoTool],
      deferredEnabled: async () => options.deferred === true,
    })
}

test('flagged stateless HTTP wrapper interleaves two isolated instances', async () => {
  const instanceA = publicHandler()
  const instanceB = publicHandler()

  const initialize = await instanceA(
    rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'connector-check', version: '1' },
    })
  )
  assert.equal(initialize.status, 200)
  assert.equal(initialize.headers.get('mcp-session-id'), null)

  const listed = await instanceB(
    rpc('tools/list', {}, { id: 2, sessionId: 'session-from-another-host' })
  )
  assert.equal(listed.status, 200)
  assert.equal(listed.headers.get('mcp-session-id'), null)
  assert.equal((await json(listed)).result.tools[0].name, 'echo')

  const callOnA = await instanceA(
    rpc('tools/call', { name: 'echo', arguments: { text: 'alpha' } }, { id: 3 })
  )
  const callOnB = await instanceB(
    rpc('tools/call', { name: 'echo', arguments: { text: 'beta' } }, { id: 4 })
  )
  assert.equal(callOnA.status, 200)
  assert.equal(callOnB.status, 200)
  assert.match((await json(callOnA)).result.content[0].text, /alpha/)
  assert.match((await json(callOnB)).result.content[0].text, /beta/)
})

test('public /mcp connector probe: no token is 401 with WWW-Authenticate and no session cookie', async () => {
  const response = await handleMcpHttp(
    rpc(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'directory', version: '1' },
      },
      { token: null }
    ),
    {
      authenticate: async () => null,
      tools: [echoTool],
      deferredEnabled: async () => false,
    }
  )
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('mcp-session-id'), null)
  assert.equal(response.headers.get('set-cookie'), null)
  const challenge = response.headers.get('www-authenticate') ?? ''
  assert.match(challenge, /Bearer/)
  assert.match(challenge, /resource_metadata=/)
})

test('a notification returns 202 and a long-call client that only accepts SSE still gets the JSON-RPC payload', async () => {
  const auth = { token: 'test-token', clientId: '6' }
  const notified = await handleStatelessMcpRequest(
    new Request('https://mcp.hypertask.ai/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    }),
    auth,
    [echoTool]
  )
  assert.equal(notified.status, 202)

  const streamed = await handleStatelessMcpRequest(
    rpc('ping', {}, { accept: 'text/event-stream', id: 9 }),
    auth,
    [echoTool]
  )
  assert.equal(streamed.status, 200)
  assert.match(streamed.headers.get('content-type') ?? '', /text\/event-stream/)
  const body = await streamed.text()
  assert.match(body, /event: message/)
  assert.match(body, /"jsonrpc":"2.0"/)
})
