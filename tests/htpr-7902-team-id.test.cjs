const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const Ajv = require('ajv')
const { load } = require('./task-route-loader.cjs')

const ajv = new Ajv({ strict: false })
require('ajv-formats')(ajv)
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts', {})
const { executeToolResult } = load('src/lib/mcp-server/tool-response.ts', {})
const message = 'team_id must be a positive integer number or UUID string'

async function harness(enabled, flatSchema = false, consolidated = true) {
  const calls = []
  const flagReads = []
  class PresenceService {
    async getPresence(input) {
      calls.push(input)
      return { success: true, agents: [] }
    }
  }
  const { getAgentPresenceTool, agentPresenceTool } = load('src/lib/mcp-server/tools/agent-presence.tool.ts', {
    '@/lib/flags': {
      isFeatureEnabled: async (key, userId) => {
        flagReads.push({ key, userId })
        return enabled && userId === 985
      },
    },
    '../lib/services/presence.service': { PresenceService },
    '../utils/executeWithService': {
      executeWithService: async (token, Service, execute, input) => {
        assert.equal(token, 'fixture-token')
        return JSON.stringify(await execute(new Service(), input))
      },
    },
  })
  const presence = await getAgentPresenceTool(985)
  const tool = consolidated
    ? selectMcpTools([presence], true, {}, true, flatSchema).find((tool) => tool.name === 'hypertask_agents')
    : presence
  const args = (input) => consolidated ? { action: 'presence', input, response_format: 'detailed' } : input
  return { tool, args, calls, flagReads, getAgentPresenceTool, agentPresenceTool }
}

for (const consolidated of [false, true]) {
  for (const flatSchema of consolidated ? [false, true] : [false]) {
    const mode = `consolidated=${consolidated}, flat=${flatSchema}`

    test(`${mode}: numeric team_id reaches PresenceService as a string with the caller's flag On`, async () => {
      const { tool, args, calls, flagReads } = await harness(true, flatSchema, consolidated)
      const input = { team_id: 4060 }
      const result = await executeToolResult(tool, args(input), 'fixture-token')
      assert.equal(result.isError, undefined)
      const response = JSON.parse(result.content[0].text)
      assert.deepEqual(consolidated ? response.data : response, { success: true, agents: [] })
      assert.deepEqual(calls, [{ team_id: '4060' }])
      assert.deepEqual(flagReads, [{ key: 'htpr-7902-team-id', userId: 985 }])
      assert.deepEqual(input, { team_id: 4060 })
    })

    for (const enabled of [false, true]) {
      test(`${mode}, flag=${enabled}: existing strings reach the service byte-identically`, async () => {
        const { tool, args, calls } = await harness(enabled, flatSchema, consolidated)
        const strings = ['3bce2867-a38a-4fca-9364-7f8e43c9050d', '4060', ' legacy-team ', ' ']
        for (const team_id of strings) {
          const result = await executeToolResult(tool, args({ team_id }), 'fixture-token')
          assert.equal(result.isError, undefined)
          const response = JSON.parse(result.content[0].text)
          assert.deepEqual(consolidated ? response.data : response, { success: true, agents: [] })
        }
        assert.deepEqual(calls, strings.map((team_id) => ({ team_id })))
      })
    }

    test(`${mode}: invalid team ids fail with the number-or-UUID message and never reach the service`, async () => {
      const { tool, args, calls } = await harness(true, flatSchema, consolidated)
      for (const team_id of [{}, '', null, true, [], 0, -1, 1.5]) {
        await assert.rejects(tool.execute(args({ team_id }), 'fixture-token'), (error) => {
          assert.ok(error instanceof z.ZodError)
          const issue = error.issues[0]
          assert.deepEqual(issue.path, consolidated ? ['input', 'team_id'] : ['team_id'])
          assert.equal(issue.message, message)
          return true
        })
      }
      assert.deepEqual(calls, [])
    })

    test(`${mode}: every other input stays strict`, async () => {
      const { tool, args, calls } = await harness(true, flatSchema, consolidated)
      await assert.rejects(tool.execute(args({ team_id: 4060, team_ids: [4060] }), 'fixture-token'), (error) => {
        assert.ok(error instanceof z.ZodError)
        const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
        assert.deepEqual(issue.keys, ['team_ids'])
        assert.deepEqual(issue.path, consolidated ? ['input'] : [])
        return true
      })
      assert.deepEqual(calls, [])
    })

    test(`${mode}: flag Off preserves the legacy numeric 400 invalid_type`, async () => {
      const { tool, args, calls } = await harness(false, flatSchema, consolidated)
      await assert.rejects(tool.execute(args({ team_id: 4060 }), 'fixture-token'), (error) => {
        assert.ok(error instanceof z.ZodError)
        assert.equal(error.issues[0].code, 'invalid_type')
        assert.equal(error.issues[0].expected, 'string')
        assert.deepEqual(error.issues[0].path, consolidated ? ['input', 'team_id'] : ['team_id'])
        return true
      })
      assert.deepEqual(calls, [])
    })
  }
}

for (const flatSchema of [false, true]) {
  test(`flat=${flatSchema}: published presence schema follows the flag and remains strict`, async () => {
    for (const enabled of [false, true]) {
      const { tool, args } = await harness(enabled, flatSchema)
      const validate = ajv.compile(tool.inputSchema)
      assert.equal(validate(args({ team_id: 4060 })), enabled)
      assert.equal(validate(args({ team_id: '3bce2867-a38a-4fca-9364-7f8e43c9050d' })), true)
      for (const team_id of [{}, '', null, 0, -1, 1.5]) {
        assert.equal(validate(args({ team_id })), false)
      }
      assert.equal(validate(args({ team_id: '4060', team_ids: [4060] })), false)
    }
  })
}

test('the flag decision belongs to the calling user and Off returns the original tool unchanged', async () => {
  const { getAgentPresenceTool, agentPresenceTool, flagReads } = await harness(true)
  const otherUserTool = await getAgentPresenceTool(986)
  assert.equal(otherUserTool, agentPresenceTool)
  assert.deepEqual(flagReads, [
    { key: 'htpr-7902-team-id', userId: 985 },
    { key: 'htpr-7902-team-id', userId: 986 },
  ])
  await assert.rejects(otherUserTool.execute({ team_id: 4060 }, 'fixture-token'), z.ZodError)
})
