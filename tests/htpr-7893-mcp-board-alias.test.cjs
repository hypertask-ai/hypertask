const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { load } = require('./task-route-loader.cjs')

const stubs = {}
const tasks = load('src/lib/mcp-server/validations/task.validation.ts', stubs)
const comments = load('src/lib/mcp-server/validations/comment.validation.ts', stubs)
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts', stubs)
const { executeToolResult, actionableToolError } = load('src/lib/mcp-server/tool-response.ts', stubs)
const variants = [
  ['list', 'hypertask_list_tasks', tasks.getListTasksInputSchema(), {}],
  ['get', 'hypertask_get_tasks', tasks.getGetTasksInputSchema(), { unique_index: 7893 }],
  ['create', 'hypertask_create_task', tasks.getCreateTaskInputSchema(), { title: 'Board alias' }],
  ['update', 'hypertask_update_task', tasks.getUpdateTaskInputSchema(), { unique_index: 7893, title: 'Updated' }],
  ['move', 'hypertask_move_task_between_boards', tasks.getMoveTaskBetweenBoardsInputSchema(), { unique_index: 7893, target_project_id: 16 }],
  ['add', 'hypertask_add_comment_to_task', comments.getAddCommentCrudBaseSchema(), { unique_index: 7893, text: 'Comment' }],
]

function harness(flatSchema = false, boardAlias = true) {
  const tools = selectMcpTools(variants.map(([, name, parameters]) => ({
    name, parameters, description: name,
    execute: async (args) => JSON.stringify({ success: true, args }),
  })), true, {}, true, flatSchema, false, boardAlias)
  return (action) => tools.find((tool) => tool.name === (action === 'add' ? 'hypertask_comments' : 'hypertask_tasks'))
}

for (const flatSchema of [false, true]) {
  for (const [action, , , fields] of variants) {
    test(`${action}, flat=${flatSchema}: board_id dispatches the same validated input as project_id`, async () => {
      const tool = harness(flatSchema)(action)
      const input = { ...fields, board_id: 15 }
      const result = JSON.parse(await tool.execute({ action, input, response_format: 'detailed' }, 'fixture'))
      assert.equal(result.data.success, true)
      assert.equal(result.data.args.project_id, 15)
      assert.equal(Object.hasOwn(result.data.args, 'board_id'), false)
      assert.deepEqual(input, { ...fields, board_id: 15 })
      assert.deepEqual(result, JSON.parse(await tool.execute({ action, input: { ...fields, project_id: 15 }, response_format: 'detailed' }, 'fixture')))
      const matching = JSON.parse(await tool.execute({ action, input: { ...fields, board_id: '15', project_id: 15 }, response_format: 'detailed' }, 'fixture'))
      assert.deepEqual(matching, result)
    })
  }
}

test('get keeps the project_id + unique_index requirement and single identification method', async () => {
  const tool = harness()('get')
  for (const input of [{ unique_index: 7893 }, { board_id: 15 }, { board_id: 15, unique_index: 7893, task_id: 42 }]) {
    await assert.rejects(tool.execute({ action: 'get', input }, 'fixture'), z.ZodError)
  }
  const valid = JSON.parse(await tool.execute({ action: 'get', input: { board_id: 15, unique_index: 7893 } }, 'fixture'))
  assert.deepEqual(valid.data.args, { project_id: 15, unique_index: 7893 })
})

for (const [action, , , fields] of variants) {
  test(`${action}: unknown fields stay unrecognized_keys and conflicting boards fail clearly`, async () => {
    const tool = harness()(action)
    for (const input of [{ ...fields, project_id: 15, board_ids: [15] }, { ...fields, board_id: 15, board_ids: [15] }]) {
      await assert.rejects(tool.execute({ action, input }, 'fixture'), (error) => {
        assert.ok(error instanceof z.ZodError)
        const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
        assert.deepEqual(issue.keys, ['board_ids'])
        assert.deepEqual(issue.path, ['input'])
        return true
      })
    }
    const conflict = await executeToolResult(tool, { action, input: { ...fields, board_id: 15, project_id: 16 } }, 'fixture')
    assert.equal(conflict.isError, true)
    assert.match(conflict.content[0].text, /board_id and project_id must identify the same board/)
  })
}

test('unknown board_ids remains a 400 unrecognized_keys failure in automatic MCP feedback', async () => {
  const reports = []
  const pending = []
  const { observeFeedbackTools } = load('src/lib/aiFeedback/automatic.ts', {
    '@vercel/functions': { waitUntil: (promise) => pending.push(promise) },
    './report': { fileAiFeedback: async (report) => reports.push(report) },
  })
  const [tool] = observeFeedbackTools([harness()('list')], 985)
  await assert.rejects(tool.execute({ action: 'list', input: { board_id: 15, board_ids: [15] } }, 'fixture'), z.ZodError)
  await Promise.all(pending)
  assert.equal(reports.length, 1)
  assert.equal(reports[0].status, 400)
  assert.equal(reports[0].errorCode, 'unrecognized_keys')
  assert.equal(reports[0].field, 'board_ids')
})

for (const key of ['board_id', 'boardId', 'board']) {
  test(`unsupported ${key} tells the model the canonical board field`, () => {
    const error = z.strictObject({ project_id: z.number() }).safeParse({ project_id: 15, [key]: 15 }).error
    assert.equal(actionableToolError(error), `Remove unsupported fields ${key} from input; use only fields documented for this action. This tool calls the board field project_id.`)
  })
}

test('unrelated unknown fields keep their original model-facing error', () => {
  const error = z.strictObject({}).safeParse({ board_ids: [15] }).error
  assert.equal(actionableToolError(error), 'Remove unsupported fields board_ids from input; use only fields documented for this action.')
})

test('board_id keeps each action schema’s existing numeric coercion and validation', async () => {
  const toolFor = harness()
  for (const [action, , , fields] of variants) {
    const tool = toolFor(action)
    for (const value of ['15', 0, -1, 1.5, 'invalid', null]) {
      const alias = await executeToolResult(tool, { action, input: { ...fields, board_id: value }, response_format: 'detailed' }, 'fixture')
      const canonical = await executeToolResult(tool, { action, input: { ...fields, project_id: value }, response_format: 'detailed' }, 'fixture')
      assert.deepEqual(alias, canonical)
      if (value === '15' && action !== 'list') {
        assert.equal(alias.structuredContent.data.args.project_id, 15)
      } else {
        assert.equal(alias.isError, true)
      }
    }
  }
})

for (const flatSchema of [false, true]) {
  for (const [action, , , fields] of variants) {
    test(`${action}, flat=${flatSchema}: flag Off rejects board_id with a 400 and keeps project_id working`, async () => {
      const reports = []
      const pending = []
      const { observeFeedbackTools } = load('src/lib/aiFeedback/automatic.ts', {
        '@vercel/functions': { waitUntil: (promise) => pending.push(promise) },
        './report': { fileAiFeedback: async (report) => reports.push(report) },
      })
      const [tool] = observeFeedbackTools([harness(flatSchema, false)(action)], 985)
      for (const input of [{ ...fields, project_id: 15, board_id: 15 }, { ...fields, project_id: 15, board_id: 16 }]) {
        const original = { ...input }
        await assert.rejects(tool.execute({ action, input }, 'fixture'), (error) => {
          assert.ok(error instanceof z.ZodError)
          const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
          assert.deepEqual(issue.keys, ['board_id'])
          assert.deepEqual(issue.path, ['input'])
          return true
        })
        assert.deepEqual(input, original)
      }
      await Promise.all(pending)
      assert.equal(reports.length, 2)
      for (const report of reports) {
        assert.equal(report.status, 400)
        assert.equal(report.errorCode, 'unrecognized_keys')
        assert.equal(report.field, 'board_id')
      }
      const canonical = JSON.parse(await tool.execute({ action, input: { ...fields, project_id: 15 }, response_format: 'detailed' }, 'fixture'))
      assert.equal(canonical.data.success, true)
      assert.equal(canonical.data.args.project_id, 15)
    })
  }
  for (const action of ['list', 'add']) {
    test(`${action}, flat=${flatSchema}: only flag On describes the board_id alias`, () => {
      assert.match(harness(flatSchema, true)(action).description, /board_id is an alias for project_id/)
      assert.doesNotMatch(harness(flatSchema, false)(action).description, /board_id/)
    })
  }
}

test('without a per-user flag decision the catalog defaults to refusing board_id', async () => {
  const tool = selectMcpTools([{
    name: 'hypertask_list_tasks', parameters: tasks.getListTasksInputSchema(), description: 'List tasks',
    execute: async () => { assert.fail('board_id must not reach the legacy tool') },
  }], true).find((tool) => tool.name === 'hypertask_tasks')
  assert.doesNotMatch(tool.description, /board_id/)
  await assert.rejects(tool.execute({ action: 'list', input: { board_id: 15 } }, 'fixture'), (error) => {
    assert.ok(error instanceof z.ZodError)
    assert.deepEqual(error.issues.find((issue) => issue.code === 'unrecognized_keys').keys, ['board_id'])
    return true
  })
})
