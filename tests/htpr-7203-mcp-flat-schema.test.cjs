const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Ajv = require('ajv')
const Ajv2020 = require('ajv/dist/2020')
const { root, loader, sample } = require('./htpr-6927-fixtures.cjs')

for (const [file, exports] of [
  ['src/lib/prisma.ts', { __esModule: true, default: {} }],
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null }],
]) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const load = (file) => jiti(path.join(root, file))
const { MCP_TOOLS } = load('src/lib/mcp-server/tools/index.ts')
const { resolvePortableTools } = load('src/lib/mcp-server/listQueryContract.ts')
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const { CONSOLIDATED_TOOL_DESCRIPTIONS: definitions } = load('src/lib/mcp-server/config/consolidated-descriptions.ts')
const legacy = resolvePortableTools(MCP_TOOLS)
const visible = (tools) => tools.filter((tool) => !tool.hidden)
const forbidden = ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'enum', 'const']
const key = 'htpr-7203-mcp-flat-schema'

for (const Validator of [Ajv, Ajv2020]) {
  test(`${Validator.name}: every advertised consolidated schema is flat, valid and retains all action variants`, () => {
    const ajv = new Validator({ strict: false })
    require('ajv-formats')(ajv)
    const tools = visible(selectMcpTools(legacy, true, {}, true, true))
    assert.equal(tools.length, definitions.length)
    for (const tool of tools) {
      const schema = tool.inputSchema
      assert.equal(schema.type, 'object', tool.name)
      for (const keyword of forbidden) assert.equal(Object.hasOwn(schema, keyword), false, `${tool.name}/${keyword}`)
      assert.deepEqual(schema.required, ['action'], tool.name)
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(Object.keys(schema.properties), ['action', 'input', 'response_format', 'limit', 'offset', 'page'])
      const names = Object.keys(definitions.find((definition) => definition.name === tool.name).actions)
      assert.deepEqual(schema.properties.action.enum, names)
      assert.equal(schema.properties.input.type, 'object')
      assert.match(schema.properties.input.description, /Fields depend on action; use the variant whose title is the action\./)
      assert.deepEqual(schema.properties.input.anyOf.map((variant) => variant.title), names)
      const validate = ajv.compile(schema)
      for (const variant of schema.properties.input.anyOf) {
        assert.equal(validate({ action: variant.title, input: sample(variant) }), true, `${tool.name}/${variant.title}: ${JSON.stringify(validate.errors)}`)
      }
    }
  })
}

test('flag Off preserves the old schema exactly, including each action input schema', () => {
  const previous = loader({ './config/consolidated-descriptions': { CONSOLIDATED_TOOL_DESCRIPTIONS: definitions } }, true)('src/lib/mcp-server/consolidated-tools.ts')
  const before = visible(previous.selectMcpTools(legacy, true, {}, true))
  const off = visible(selectMcpTools(legacy, true, {}, true, false))
  const on = visible(selectMcpTools(legacy, true, {}, true, true))
  const withoutFeedback = (tools) => tools.filter((tool) => tool.name !== 'hypertask_report_feedback').map((tool) => tool.inputSchema)
  assert.deepEqual(withoutFeedback(off), withoutFeedback(before))
  const feedback = off.find((tool) => tool.name === 'hypertask_report_feedback').inputSchema
  assert.equal(feedback.properties.action.default, 'report')
  assert.equal(feedback.required, undefined)
  assert.deepEqual(visible(selectMcpTools(legacy, true, {}, true)).map((tool) => tool.inputSchema), off.map((tool) => tool.inputSchema))
  for (const [index, tool] of off.entries()) {
    assert.ok(tool.inputSchema.oneOf.length)
    assert.equal(tool.inputSchema.properties.input.anyOf, undefined)
    assert.deepEqual(on[index].inputSchema.properties.input.anyOf, tool.inputSchema.oneOf.map((variant) => ({ title: variant.properties.action.const, ...variant.properties.input })))
  }
})

test('read agents advertise only allowed actions in both the enum and nested variants', () => {
  const tools = visible(selectMcpTools(legacy, true, { agent: true, agentRole: 'read' }, true, true))
  assert.ok(tools.length > 0)
  for (const tool of tools) {
    const definition = definitions.find((item) => item.name === tool.name)
    const names = tool.inputSchema.properties.action.enum
    assert.deepEqual(tool.inputSchema.properties.input.anyOf.map((variant) => variant.title), names)
    for (const name of names) {
      const action = definition.actions[name]
      assert.ok(action.read_only || action.permission === 'feedback', `${tool.name}/${name}`)
      assert.ok(!action.permission.startsWith('management_'))
      assert.notEqual(action.permission, 'human_data')
    }
  }
  assert.ok(tools.find((tool) => tool.name === 'hypertask_tasks').inputSchema.properties.action.enum.includes('get'))
  assert.ok(!tools.find((tool) => tool.name === 'hypertask_tasks').inputSchema.properties.action.enum.includes('create'))
})

test('bugfix flag is exported, registered, defaults Everyone and supports Off', async () => {
  for (const [mode, expected] of [[null, true], ['OFF', false]]) {
    const isolated = loader({
      '@/lib/prisma': { __esModule: true, default: {
        featureFlag: { findUnique: async ({ where }) => { assert.equal(where.key, key); return mode ? { mode } : null } },
      } },
      react: { cache: (fn) => fn },
    })
    const definition = isolated('src/lib/flags/definitions/htpr-7203-mcp-flat-schema.ts').default
    assert.equal(definition.key, key)
    assert.equal(definition.kind, 'bugfix')
    assert.ok(definition.releaseRisk.reason)
    assert.equal(isolated('src/lib/flags/keys.ts').HTPR_7203_MCP_FLAT_SCHEMA_FLAG, key)
    assert.ok(isolated('src/lib/flags/definitions.ts').FEATURE_FLAG_DEFINITIONS.some((flag) => flag.key === key))
    const flags = isolated('src/lib/flags.ts')
    assert.equal(flags.defaultFeatureFlagMode(key), 'EVERYONE')
    assert.equal(await flags.isFeatureEnabled(key, 7), expected)
  }
})

test('authenticated HTTP requests evaluate the flag for the user and advertise the selected schema', async () => {
  for (const enabled of [false, true]) {
    const calls = []
    const isolated = loader({
      './tools': { MCP_TOOLS: legacy },
      '@/lib/mcp/auth': { extractBearerToken: () => 'fixture', validateMcpAuth: async () => ({ user: { id: 7 } }) },
      '@/lib/mcp/mcpV2': { isMcpV2Enabled: async () => true },
      '@/lib/aiFeedback/enabled': { aiFeedbackEnabled: async () => true },
      '@/lib/aiFeedback/automatic': { observeFeedbackTools: (tools) => tools, queueAiFeedback: () => {} },
      '@/lib/telemetry/mcpSseAnalytics': { recordLegacyMcpRequest: () => {} },
      '@/lib/flags': { HTPR_6804_MCP_TOOLS_FLAG: 'catalog', HTPR_7203_MCP_FLAT_SCHEMA_FLAG: key, isFeatureEnabled: async (flag, userId) => {
        calls.push({ flag, userId })
        return flag === key ? enabled : true
      } },
      './mcp-http': { handleMcpHttp: async (_request, { tools }) => Response.json(visible(tools).map((tool) => tool.inputSchema)) },
    })
    const schemas = await (await isolated('src/lib/mcp-server/handler.ts').mcpHandler(new Request('https://fixture.invalid/mcp', { headers: { Authorization: 'Bearer fixture' } }))).json()
    assert.ok(calls.some((call) => call.flag === key && call.userId === 7))
    for (const schema of schemas) assert.equal(Object.hasOwn(schema, 'oneOf'), !enabled)
  }
})

test('flat advertising leaves action-specific execution validation and allowed calls unchanged', async () => {
  const calls = []
  const tools = selectMcpTools(legacy.map((tool) => ({ ...tool, execute: async (args) => {
    calls.push({ name: tool.name, args })
    return JSON.stringify({ success: true })
  } })), true, {}, true, true)
  const tasks = tools.find((tool) => tool.name === 'hypertask_tasks')
  await assert.rejects(tasks.execute({ action: 'create', input: {} }, 'fixture'), /project_id|title/)
  await assert.rejects(tasks.execute({ action: 'not_an_action', input: {} }, 'fixture'))
  assert.equal(calls.length, 0)
  await tasks.execute({ action: 'create', input: { project_id: 15, title: 'Fixture' } }, 'fixture')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'hypertask_create_task')
  assert.equal(calls[0].args.title, 'Fixture')
})
