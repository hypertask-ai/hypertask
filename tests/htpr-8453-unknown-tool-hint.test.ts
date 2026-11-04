import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { handleStatelessMcpRequest, type PortableTool } from '../src/lib/mcp-server/stateless-http'
import { nearestToolName, unknownToolMessage } from '../src/lib/mcp-server/nearest-tool'

const listTool: PortableTool = {
  name: 'hypertask_list_tasks',
  description: 'List tasks',
  parameters: z.object({}),
  inputSchema: { type: 'object', properties: {} },
  execute: async () => JSON.stringify({ items: [] }),
}

const ADVERTISED = [
  'hypertask_add_comment_to_task',
  'hypertask_get_tasks',
  'hypertask_get_view',
  'hypertask_list_tasks',
  'hypertask_search_tools',
]

const legacy = 'Unknown tool hypertask-ticket-view. Refresh tools/list and choose an advertised tool name'

function call(name: string, unknownToolHint?: boolean): Request {
  return new Request('https://mcp.hypertask.ai/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
  })
}

async function refusal(name: string, unknownToolHint?: boolean) {
  const response = await handleStatelessMcpRequest(
    call(name, unknownToolHint),
    { token: 'test-token', clientId: '6' },
    [listTool],
    unknownToolHint === undefined ? {} : { unknownToolHint }
  )
  return response.json() as Promise<Record<string, any>>
}

test('flag off keeps the sentence and the shape byte for byte', async () => {
  const off = await refusal('hypertask-ticket-view', false)
  assert.equal(off.result.content[0].text, legacy)
  assert.equal(off.result.isError, true)
  assert.deepEqual(await refusal('hypertask-ticket-view'), off)
})

test('a separator or case variant names the real tool', async () => {
  const result = await refusal('Hypertask-List-Tasks', true)
  assert.equal(result.result.content[0].text.startsWith('Unknown tool Hypertask-List-Tasks. Did you mean hypertask_list_tasks?'), true)
})

test('a typo within two edits names the real tool', () => {
  assert.equal(nearestToolName('hypertask_list_task', ADVERTISED), 'hypertask_list_tasks')
  assert.equal(nearestToolName('hypertask-get-tasks', ADVERTISED), 'hypertask_get_tasks')
})

test('an invented name never gets a misleading guess and points at the search', async () => {
  const result = await refusal('hypertask-ticket-view', true)
  const text = result.result.content[0].text
  assert.equal(text.includes('Did you mean'), false)
  assert.equal(text.startsWith('Unknown tool hypertask-ticket-view.'), true)
  assert.equal(text.includes('hypertask_search_tools'), true)
  assert.equal(text.includes('hypertask_describe_tool'), true)
  assert.equal(nearestToolName('hypertask-ticket-view', ADVERTISED), undefined)
})

test('a missing name and an empty catalog still answer plainly', async () => {
  assert.equal(unknownToolMessage('', ['hypertask_list_tasks'], false), 'Unknown tool (missing). Refresh tools/list and choose an advertised tool name')
  assert.equal(unknownToolMessage('', ['hypertask_list_tasks'], true), 'Unknown tool (missing). Tool names are snake_case, like hypertask_list_tasks; refresh tools/list or search it with hypertask_search_tools and hypertask_describe_tool.')
  assert.equal(unknownToolMessage('nope', [], true), 'Unknown tool nope. Tool names are snake_case; refresh tools/list or search it with hypertask_search_tools and hypertask_describe_tool.')
})

test('a tie between two candidates refuses to guess', () => {
  assert.equal(nearestToolName('hypertask_ab', ['hypertask_ac', 'hypertask_ad']), undefined)
})

test('a real tool call is untouched by the hint', async () => {
  const on = await refusal('hypertask_list_tasks', true)
  const off = await refusal('hypertask_list_tasks', false)
  assert.equal(on.result.isError, undefined)
  assert.deepEqual(on, off)
})
