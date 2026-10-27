const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
for (const [file, exports] of [['src/lib/prisma.ts', { default: {} }], ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => null }]]) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const load = (file) => jiti(path.join(root, file))
const { aiFeedbackSchema } = load('src/lib/aiFeedback/input.ts')
const { MCP_TOOLS } = load('src/lib/mcp-server/tools/index.ts')
const { resolvePortableTools } = load('src/lib/mcp-server/listQueryContract.ts')
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts')
const { toolsForConnect } = load('src/lib/mcp-server/deferred-tools.ts')
const { MCP_FEEDBACK_ROUTE_TEMPLATES } = load('src/lib/aiFeedback/routes.ts')

test('every registered legacy, consolidated and discovery MCP tool name passes the credential filter', () => {
  const legacy = resolvePortableTools(MCP_TOOLS)
  const names = new Set(MCP_TOOLS.map((tool) => tool.name))
  for (const consolidated of [false, true]) for (const tool of toolsForConnect(selectMcpTools(legacy, consolidated, {}), true)) names.add(tool.name)
  assert.ok(names.has('hypertask_report_feedback'))
  assert.ok(names.has('hypertask_search_tools'))
  assert.ok(names.has('hypertask_describe_tool'))
  for (const name of names) assert.equal(aiFeedbackSchema.safeParse({ surface: 'mcp', tool: name }).success, true, name)
  assert.equal(aiFeedbackSchema.safeParse({ surface: 'mcp', tool: 'abc_x7Yz9QwE' }).success, false)
})

test('every filesystem /api/mcp route template and the automatic registry pass the credential filter', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  const templates = walk(path.join(root, 'src/app/api/mcp')).filter((file) => file.endsWith('/route.ts')).map((file) => '/api/mcp/' + path.relative(path.join(root, 'src/app/api/mcp'), path.dirname(file)).split(path.sep).join('/').replace(/\[([^\]]+)\]/g, ':$1'))
  assert.deepEqual(new Set(templates.filter((template) => template !== '/api/mcp/:...notFound')), new Set(MCP_FEEDBACK_ROUTE_TEMPLATES))
  for (const tool of [...templates, ...MCP_FEEDBACK_ROUTE_TEMPLATES]) assert.equal(aiFeedbackSchema.safeParse({ surface: 'api', tool }).success, true, tool)
  for (const tool of ['vck_secret123', 'httk_secret123']) assert.equal(aiFeedbackSchema.safeParse({ surface: 'api', tool }).success, false)
})
