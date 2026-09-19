import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { MCP_TOOLS } from '../src/lib/mcp-server/tools'
import {
  anthropicDirectoryToolAnnotations,
  directoryProfileFromUrl,
  openAiDirectoryToolAnnotations,
  toolsForDirectoryProfile,
} from '../src/lib/mcp-server/tool-annotations'
import {
  handleStatelessMcpRequest,
  type PortableTool,
} from '../src/lib/mcp-server/stateless-http'

const root = process.cwd()
const tools = MCP_TOOLS as PortableTool[]
const openAiTools = toolsForDirectoryProfile(tools, 'openai')
const anthropicTools = toolsForDirectoryProfile(tools, 'anthropic')

function toolsListRequest(url = 'https://mcp.hypertask.ai/mcp'): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

test('OpenAI profile annotates every tool with all three explicit safety hints', () => {
  assert.equal(openAiTools.length, tools.length)
  for (const tool of openAiTools) {
    assert.ok(tool.annotations.title, `${tool.name} needs a title`)
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`)
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} destructiveHint`)
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} openWorldHint`)
    if (tool.annotations.readOnlyHint) {
      assert.equal(tool.annotations.destructiveHint, false, `${tool.name} cannot be read-only and destructive`)
    }
  }
})

test('OpenAI annotations distinguish reads, writes, destructive actions, and public network access', () => {
  assert.deepEqual(openAiDirectoryToolAnnotations('hypertask_list_tasks'), {
    title: 'List Tasks',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  })
  assert.deepEqual(openAiDirectoryToolAnnotations('hypertask_create_label'), {
    title: 'Create Label',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  })
  assert.deepEqual(openAiDirectoryToolAnnotations('hypertask_delete_agent'), {
    title: 'Delete Agent',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  })
  assert.deepEqual(openAiDirectoryToolAnnotations('hypertask_attach_files'), {
    title: 'Attach Files',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  })
  assert.throws(
    () => openAiDirectoryToolAnnotations('hypertask_unclassified_tool'),
    /Missing directory annotations/
  )
})

test('Anthropic profile exposes only single-purpose tools with neutral descriptions', () => {
  assert.ok(anthropicTools.length > 0)
  assert.ok(anthropicTools.length < tools.length)

  for (const tool of anthropicTools) {
    assert.ok(tool.name.length <= 64, `${tool.name} exceeds 64 characters`)
    assert.ok(tool.annotations.title, `${tool.name} needs a title`)
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} openWorldHint`)
    assert.notEqual(
      tool.annotations.readOnlyHint,
      tool.annotations.destructiveHint,
      `${tool.name} must be either read-only or destructive`
    )
    assert.doesNotMatch(
      tool.description,
      /\b(use|call|must|should|before|after|first|do not|don't)\b/i,
      `${tool.name} description must describe behavior, not instruct Claude`
    )
  }

  assert.equal(
    anthropicTools.some((tool) => tool.name === 'hypertask_add_comment_to_task'),
    false,
    'mixed read/write comment tool must not be submitted to Anthropic'
  )
  assert.deepEqual(anthropicDirectoryToolAnnotations('hypertask_create_task'), {
    title: 'Create Task',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  })
})

test('directory profiles are selected only by an explicit recognized URL parameter', () => {
  assert.equal(directoryProfileFromUrl('https://mcp.hypertask.ai/mcp'), undefined)
  assert.equal(
    directoryProfileFromUrl('https://mcp.hypertask.ai/mcp?directory=anthropic'),
    'anthropic'
  )
  assert.equal(directoryProfileFromUrl('https://mcp.hypertask.ai/mcp?directory=openai'), 'openai')
  assert.equal(directoryProfileFromUrl('https://mcp.hypertask.ai/mcp?directory=other'), undefined)
})

test('stateless tools/list advertises annotations only for a selected directory profile', async () => {
  const auth = { token: 'test-token', clientId: '985' }
  const enabled = await handleStatelessMcpRequest(
    toolsListRequest('https://mcp.hypertask.ai/mcp?directory=openai'),
    auth,
    openAiTools
  )
  const enabledBody = (await enabled.json()) as Record<string, any>
  assert.deepEqual(
    enabledBody.result.tools.find((tool: { name: string }) => tool.name === 'hypertask_list_tasks')
      .annotations,
    openAiDirectoryToolAnnotations('hypertask_list_tasks')
  )

  const disabled = await handleStatelessMcpRequest(toolsListRequest(), auth, tools)
  const disabledBody = (await disabled.json()) as Record<string, any>
  assert.equal(
    disabledBody.result.tools.find((tool: { name: string }) => tool.name === 'hypertask_list_tasks')
      .annotations,
    undefined
  )
})

test('directory profiles and the OpenAI challenge are behind the ticket feature flag', () => {
  const keys = readFileSync(path.join(root, 'src/lib/flags/keys.ts'), 'utf8')
  const flags = readFileSync(path.join(root, 'src/lib/flags.ts'), 'utf8')
  const handler = readFileSync(path.join(root, 'src/lib/mcp-server/handler.ts'), 'utf8')
  const challenge = readFileSync(
    path.join(root, 'src/app/.well-known/openai-apps-challenge/route.ts'),
    'utf8'
  )
  assert.match(keys, /HTPR_4638_AI_DIRECTORY_METADATA_FLAG/)
  assert.match(flags, /key: HTPR_4638_AI_DIRECTORY_METADATA_FLAG/)
  assert.match(handler, /isFeatureEnabled\(HTPR_4638_AI_DIRECTORY_METADATA_FLAG, userId\)/)
  assert.match(handler, /directoryProfileFromUrl\(working\.url\)/)
  assert.match(handler, /toolsForDirectoryProfile\(requestTools, directoryProfile\)/)
  assert.match(challenge, /OPENAI_APPS_CHALLENGE_TOKEN/)
  assert.match(challenge, /if \(!enabled \|\| !token\) return new Response\('Not found', \{ status: 404 \}\)/)
  assert.match(challenge, /'Content-Type': 'text\/plain; charset=utf-8'/)
})
