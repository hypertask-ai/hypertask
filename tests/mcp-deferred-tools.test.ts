import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'node:fs'
import { TOOL_SUMMARIES, summaryForToolName } from '../src/lib/mcp-server/config/tool-summaries'
import {
  describeToolCatalog,
  estimateTokens,
  firstSentence,
  listToolsDeferred,
  listToolsFull,
  parseStructuredContent,
  searchToolCatalog,
  toolsForConnect,
} from '../src/lib/mcp-server/deferred-tools'
import { withSharedDefs } from '../src/lib/mcp-server/schema-defs'
import {
  handleStatelessMcpRequest,
  type PortableTool,
} from '../src/lib/mcp-server/stateless-http'

const catalog: PortableTool[] = [
  {
    name: 'hypertask_list_tasks',
    description: `${TOOL_SUMMARIES.LIST_TASKS}\n\nLists tasks with filters and pagination.`,
    parameters: z.object({
      project_id: z.number().optional(),
      priority: z.enum(['None', 'Urgent', 'High', 'Medium', 'Low']).optional(),
      status: z.enum(['Normal', 'Archive', 'Deleted']).optional(),
    }),
    execute: async () => JSON.stringify({ tasks: [{ id: 1 }] }),
  },
  {
    name: 'hypertask_create_task',
    description: `${TOOL_SUMMARIES.CREATE_TASK}\n\nCreates a task. Requires project_id and title.`,
    parameters: z.object({
      project_id: z.number(),
      title: z.string(),
    }),
    execute: async () => JSON.stringify({ id: 2, title: 'New' }),
  },
]

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
  url = 'https://mcp.hypertask.ai/mcp'
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}

test('every tool summary is under 100 characters and states what it returns', () => {
  for (const [key, summary] of Object.entries(TOOL_SUMMARIES)) {
    assert.ok(summary.length <= 100, `${key} summary is ${summary.length} chars`)
    assert.match(summary, /Returns /)
    assert.equal(firstSentence(`${summary}\n\nMore detail.`), summary)
  }
})

test('summary lookup uses the real MCP tool names, including overrides', () => {
  assert.equal(summaryForToolName('hypertask_list_tasks', 'x'), TOOL_SUMMARIES.LIST_TASKS)
  assert.equal(summaryForToolName('hypertask_section', 'x'), TOOL_SUMMARIES.SECTION_CRUD)
  assert.equal(summaryForToolName('hypertask_get_comments_for_task', 'x'), TOOL_SUMMARIES.GET_COMMENTS)
  assert.equal(summaryForToolName('hypertask_add_comment_to_task', 'x'), TOOL_SUMMARIES.ADD_COMMENT)
  assert.equal(summaryForToolName('hypertask_report', 'x'), TOOL_SUMMARIES.REPORT_CRUD)
  assert.equal(summaryForToolName('hypertask_draft', 'x'), TOOL_SUMMARIES.DRAFT_CRUD)
  assert.equal(summaryForToolName('hypertask_search_tools', 'x'), TOOL_SUMMARIES.SEARCH_TOOLS)
})

test('TOOL_METADATA descriptions stay unprefixed when the flag is off', () => {
  const source = readFileSync(
    new URL('../src/lib/mcp-server/config/tool-metadata.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /export const TOOL_METADATA = RAW_TOOL_METADATA/)
  assert.doesNotMatch(source, /function withSummaries/)
  assert.doesNotMatch(source, /\$\{summary\}\\n\\n\$\{meta\.description\}/)
})

test('meta-only connect stays under 1,500 tokens and the short catalog stays protocol-valid', () => {
  const catalog = Object.entries(TOOL_SUMMARIES)
    .filter(([key]) => key !== 'SEARCH_TOOLS' && key !== 'DESCRIBE_TOOL')
    .map(([key, summary]) => ({
      name: `hypertask_${key.toLowerCase()}`,
      description: `${summary}\n\nLonger detail for ${key} that clients should not load on connect.`,
      parameters: z.object({ extra: z.string().optional() }),
      execute: async () => '{}',
    }))
  const connectedTools = toolsForConnect(catalog, true)
  const listed = listToolsDeferred(connectedTools)
  const metaOnly = listToolsDeferred(connectedTools, true)
  const tokens = estimateTokens({ tools: listed })
  const metaTokens = estimateTokens({ tools: metaOnly })
  const fullTokens = estimateTokens({ tools: listToolsFull(catalog) })

  assert.equal(listed.length, catalog.length + 2)
  assert.deepEqual(
    metaOnly.map((tool) => tool.name),
    ['hypertask_search_tools', 'hypertask_describe_tool']
  )
  assert.ok(metaTokens < 1500, `meta-only list used ${metaTokens} tokens`)
  assert.ok(tokens * 2 < fullTokens, `full list ${fullTokens} should be more than twice deferred ${tokens}`)
  for (const tool of listed) {
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} is missing a protocol inputSchema`)
  }
  for (const tool of metaOnly) {
    assert.equal(tool.outputSchema?.type, 'object', `${tool.name} is missing an outputSchema`)
  }
  assert.equal(ListToolsResultSchema.safeParse({ tools: metaOnly }).success, true)
})

test('search_tools matches names first and describe_tool returns shared $defs', () => {
  const hits = searchToolCatalog(catalog, 'list')
  assert.equal(hits[0]?.name, 'hypertask_list_tasks')
  assert.equal(hits[0]?.description, TOOL_SUMMARIES.LIST_TASKS)

  const described = describeToolCatalog(catalog, 'hypertask_list_tasks')
  assert.ok(described)
  assert.equal(described.description, catalog[0].description)
  const schema = described.inputSchema as Record<string, unknown>
  assert.ok(schema.$defs)
  const defs = schema.$defs as Record<string, unknown>
  assert.ok(defs.priorityName)
  assert.ok(JSON.stringify(schema).includes('#/$defs/priorityName'))
})

test('shared $defs replace duplicated enums', () => {
  const schema = withSharedDefs({
    type: 'object',
    properties: {
      priority: { type: 'string', enum: ['None', 'Urgent', 'High', 'Medium', 'Low'] },
      status: { type: 'string', enum: ['Normal', 'Archive', 'Deleted'] },
      other: { type: 'string' },
    },
  })
  const properties = schema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.priority, { $ref: '#/$defs/priorityName' })
  assert.deepEqual(properties.status, { $ref: '#/$defs/taskStatus' })
  assert.equal(properties.other.type, 'string')
})

test('stateless tools/list and describe_tool honor the deferred flag', async () => {
  const auth = { token: 'test-token', clientId: '6' }
  const deferredList = await handleStatelessMcpRequest(
    rpc('tools/list'),
    auth,
    catalog,
    { deferred: true }
  )
  const deferredBody = (await deferredList.json()) as {
    result: {
      tools: Array<{
        name: string
        description: string
        inputSchema: { type: string }
        outputSchema?: { type: string }
      }>
    }
  }
  const listed = deferredBody.result.tools
  assert.equal(
    listed.find((tool) => tool.name === 'hypertask_list_tasks')?.description,
    TOOL_SUMMARIES.LIST_TASKS
  )
  assert.deepEqual(
    listed.find((tool) => tool.name === 'hypertask_list_tasks')?.inputSchema,
    { type: 'object' }
  )

  const metaList = await handleStatelessMcpRequest(
    rpc('tools/list', {}, 2, 'https://mcp.hypertask.ai/mcp?tools=meta'),
    auth,
    catalog,
    { deferred: true }
  )
  const metaBody = (await metaList.json()) as typeof deferredBody
  assert.deepEqual(
    metaBody.result.tools.map((tool) => tool.name),
    ['hypertask_search_tools', 'hypertask_describe_tool']
  )
  const metaTokens = estimateTokens(metaBody.result)
  assert.ok(metaTokens < 1500, `meta-only tools/list used ${metaTokens} tokens`)
  assert.equal(ListToolsResultSchema.safeParse(metaBody.result).success, true)
  assert.equal(metaBody.result.tools.every((tool) => tool.outputSchema?.type === 'object'), true)

  const described = await handleStatelessMcpRequest(
    rpc(
      'tools/call',
      { name: 'hypertask_describe_tool', arguments: { name: 'hypertask_list_tasks' } },
      2
    ),
    auth,
    catalog,
    { deferred: true }
  )
  const describedBody = (await described.json()) as {
    result: { content: Array<{ text: string }>; structuredContent?: { name: string } }
  }
  const payload = JSON.parse(describedBody.result.content[0].text) as {
    name: string
    inputSchema: { $defs?: unknown }
  }
  assert.equal(payload.name, 'hypertask_list_tasks')
  assert.ok(payload.inputSchema.$defs)
  assert.equal(describedBody.result.structuredContent?.name, 'hypertask_list_tasks')

  const called = await handleStatelessMcpRequest(
    rpc(
      'tools/call',
      { name: 'hypertask_list_tasks', arguments: {} },
      3,
      'https://mcp.hypertask.ai/mcp?tools=meta'
    ),
    auth,
    catalog,
    { deferred: true }
  )
  const calledBody = (await called.json()) as {
    result: { structuredContent?: { tasks: Array<{ id: number }> } }
  }
  assert.equal(calledBody.result.structuredContent?.tasks[0]?.id, 1)

  const flagOff = await handleStatelessMcpRequest(
    rpc('tools/list', {}, 3, 'https://mcp.hypertask.ai/mcp?tools=meta'),
    auth,
    catalog
  )
  const flagOffBody = (await flagOff.json()) as {
    result: { tools: Array<{ name: string; description: string }> }
  }
  assert.ok(
    flagOffBody.result.tools.find((tool) => tool.name === 'hypertask_list_tasks')
      ?.description.includes('Lists tasks with filters')
  )
  assert.equal(
    flagOffBody.result.tools.some((tool) => tool.name === 'hypertask_search_tools'),
    false
  )
})

test('parseStructuredContent only accepts JSON objects', () => {
  assert.deepEqual(parseStructuredContent('{"ok":true}'), { ok: true })
  assert.equal(parseStructuredContent('not json'), undefined)
  assert.equal(parseStructuredContent('[1]'), undefined)
})
