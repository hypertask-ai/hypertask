import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGuidedStart } from '@/lib/mcp/hello/guidedStart'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { MCP_TOOLS } from '@/lib/mcp-server/tools'
import { resolvePortableTools } from '@/lib/mcp-server/listQueryContract'
import { selectMcpTools } from '@/lib/mcp-server/consolidated-tools'
import { handleStatelessMcpRequest } from '@/lib/mcp-server/stateless-http'

const newestBoard = { id: 9142, title: 'Product Launch', name: 'launch' }

test('starts on the newest board with 3 steps for the CLI and for MCP', () => {
  const { startBoard, nextSteps } = buildGuidedStart(newestBoard, false, 'write')
  assert.deepEqual(startBoard, {
    id: 9142,
    title: 'Product Launch',
    boardUrl: 'https://app.hypertask.ai/project?id=9142',
  })
  assert.deepEqual(
    nextSteps.map((s) => [s.step, s.command]),
    [
      ['See the board', 'hypertask task list --project 9142'],
      ['Create a first task', 'hypertask task create --project 9142 --title "My first task"'],
      ['Read the board rules', 'hypertask project playbook 9142'],
    ]
  )
})

for (const consolidated of [false, true]) {
  for (const flatSchema of [false, true]) {
    for (const agentRole of ['read', 'write'] as const) {
      test(`catalog consolidated=${consolidated}, flat=${flatSchema}, role=${agentRole}: every step is advertised and valid`, async () => {
        const tools = selectMcpTools(resolvePortableTools(MCP_TOOLS), consolidated, {
          agent: true,
          agentRole,
        }, flatSchema)
        const request = new Request('https://mcp.example.test/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        const response = await handleStatelessMcpRequest(request, { token: 'fixture-token', clientId: '6' }, tools)
        const { result: { tools: catalog } } = await response.json()
        const { nextSteps } = buildGuidedStart(newestBoard, consolidated, agentRole)
        assert.deepEqual(nextSteps.map((step) => step.step), agentRole === 'read'
          ? ['See the board', 'Read the board rules']
          : ['See the board', 'Create a first task', 'Read the board rules'])
        const ajv = new Ajv({ strict: false })
        addFormats(ajv)
        for (const step of nextSteps) {
          const tool = catalog.find((entry: { name: string }) => entry.name === step.tool)
          assert.ok(tool, `${step.tool} must be advertised`)
          const validate = ajv.compile(tool.inputSchema)
          assert.equal(validate(step.arguments), true, `${step.tool}: ${JSON.stringify(validate.errors)}`)
          assert.deepEqual(step.arguments, consolidated
            ? { action: step.step === 'See the board' ? 'list' : step.step === 'Create a first task' ? 'create' : 'playbook', input: {
                project_id: newestBoard.id,
                ...(step.step === 'Create a first task' ? { title: 'My first task' } : {}),
              } }
            : { project_id: newestBoard.id, ...(step.step === 'Create a first task' ? { title: 'My first task' } : {}) })
          assert.equal(validate({ ...step.arguments, project_id: 'invalid', input: 'invalid' }), false)
        }
      })
    }
  }
}


test('no board gives no start board and no steps', () => {
  assert.deepEqual(buildGuidedStart(null, false, 'write'), { startBoard: null, nextSteps: [] })
})
