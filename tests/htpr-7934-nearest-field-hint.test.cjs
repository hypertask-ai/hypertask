const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { load } = require('./task-route-loader.cjs')

const stubs = {}
const comments = load('src/lib/mcp-server/validations/comment.validation.ts', stubs)
const { nearestFieldName } = load('src/lib/mcp-server/nearest-field.ts', stubs)
const { actionableToolError, executeToolResult } = load('src/lib/mcp-server/tool-response.ts', stubs)
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts', stubs)
const accepted = Object.keys(comments.getAddCommentCrudBaseSchema().shape)

function tool(hint) {
  return selectMcpTools([{
    name: 'hypertask_add_comment_to_task',
    description: 'add',
    parameters: comments.getAddCommentCrudBaseSchema(),
    execute: async (args) => JSON.stringify({ success: true, args }),
  }], true, {}, false, false, false, false, false, false, false, false, false, hint)[0]
}

async function refusal(hint, input) {
  const result = await executeToolResult(tool(hint), { action: 'add', input }, 'fixture')
  assert.equal(result.isError, true)
  return result.content[0].text
}

for (const key of ['contnet', 'comment']) {
  test(`${key} in comment input keeps the refusal and suggests text`, async () => {
    const message = await refusal(true, { task_id: 42, [key]: 'Comment' })
    const original = `Remove unsupported fields ${key} from input; use only fields documented for this action.`
    assert.ok(message.startsWith(original))
    assert.equal(message, `${original} Did you mean text?`)
  })
}

test('an unlike comment field keeps the old refusal without a suggestion', async () => {
  const message = await refusal(true, { task_id: 42, flibbertigibbet: 'Comment' })
  assert.equal(message, 'Remove unsupported fields flibbertigibbet from input; use only fields documented for this action.')
  assert.doesNotMatch(message, /Did you mean/)
})

test('flag off keeps the contnet refusal byte for byte', async () => {
  const message = await refusal(false, { task_id: 42, contnet: 'Comment' })
  assert.equal(message, 'Remove unsupported fields contnet from input; use only fields documented for this action.')
  assert.doesNotMatch(message, /Did you mean/)
})

test('nearestFieldName handles comment aliases, typos and unrelated keys', () => {
  assert.equal(nearestFieldName('contnet', accepted), 'text')
  assert.equal(nearestFieldName('comment', accepted), 'text')
  assert.equal(nearestFieldName('flibbertigibbet', accepted), undefined)
  assert.equal(nearestFieldName('content', ['text']), 'text')
  assert.equal(nearestFieldName('text', ['text']), undefined)
  assert.equal(nearestFieldName('titel', ['title']), 'title')
})

test('nearestFieldName normalizes keys and recognizes real fields before aliases', () => {
  assert.equal(nearestFieldName(' CoMmEnT ', accepted), 'text')
  assert.equal(nearestFieldName(' CONTNET ', accepted), 'text')
  assert.equal(nearestFieldName(' TEXT ', ['text']), undefined)
  assert.equal(nearestFieldName('content', ['content', 'text']), undefined)
  assert.equal(nearestFieldName('CONTENT', ['Content', 'text']), undefined)
  for (const key of ['content', 'body', 'comment', 'message', 'note']) {
    assert.equal(nearestFieldName(key, ['text']), 'text')
  }
  for (const key of ['title_text', 'name', 'heading']) {
    assert.equal(nearestFieldName(key, ['title']), 'title')
  }
})

test('nearestFieldName refuses ties, absent alias targets and weak fuzzy matches', () => {
  assert.equal(nearestFieldName('titel', ['title']), 'title')
  assert.equal(nearestFieldName('tast', ['test', 'tost']), undefined)
  assert.equal(nearestFieldName('content', ['title']), undefined)
  assert.equal(nearestFieldName('contnet', ['title']), undefined)
  assert.equal(nearestFieldName('te', ['text']), undefined)
  assert.equal(nearestFieldName('bext', ['text']), undefined)
  assert.equal(nearestFieldName('txxxx', ['title']), undefined)
  assert.equal(nearestFieldName('', accepted), undefined)
})

test('the real unrecognized_keys issue keeps its message and adds ordered field hints only when on', async () => {
  const input = { task_id: 42, contnet: 'Comment', task_if: 42 }
  const parsed = comments.getAddCommentCrudBaseSchema().safeParse({ action: 'add', ...input })
  assert.equal(parsed.success, false)
  const original = parsed.error.issues.find((issue) => issue.code === 'unrecognized_keys')
  assert.ok(original)
  for (const hint of [false, true]) {
    await assert.rejects(tool(hint).execute({ action: 'add', input }, 'fixture'), (error) => {
      assert.ok(error instanceof z.ZodError)
      const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
      assert.deepEqual(issue.keys, ['contnet', 'task_if'])
      assert.deepEqual(issue.path, ['input'])
      assert.equal(issue.message, original.message)
      assert.equal(issue.fieldHint, hint ? 'Did you mean text or task_id?' : undefined)
      return true
    })
  }
  assert.equal(await refusal(true, input), 'Remove unsupported fields contnet, task_if from input; use only fields documented for this action. Did you mean text or task_id?')
})

test('the renderer appends field hints after board guidance only when enabled and non-empty', () => {
  const error = comments.getAddCommentCrudBaseSchema().safeParse({ board_id: 15 }).error
  const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
  assert.ok(issue)
  const original = 'Remove unsupported fields board_id from input; use only fields documented for this action. This tool calls the board field project_id.'
  issue.fieldHint = 'Did you mean project_id?'
  assert.equal(actionableToolError(error, { nearestField: true }), `${original} Did you mean project_id?`)
  assert.equal(actionableToolError(error, { nearestField: false }), original)
  for (const value of [undefined, '', ' ', 42]) {
    issue.fieldHint = value
    assert.equal(actionableToolError(error, { nearestField: true }), original)
  }
})

test('the catalog carries the nearest-field hint only when the flag is passed in', () => {
  assert.deepEqual(tool(true).errorHints, { nearestField: true })
  assert.equal(tool(false).errorHints, undefined)
})

test('a correctly shaped comment add call is untouched by the hint', async () => {
  const args = { action: 'add', input: { task_id: 42, text: 'Comment' } }
  const result = await executeToolResult(tool(true), args, 'fixture')
  assert.equal(result.isError, undefined)
  assert.equal(JSON.parse(result.content[0].text).data.success, true)
  assert.equal(JSON.parse(result.content[0].text).data.args.text, 'Comment')
  assert.deepEqual(result, await executeToolResult(tool(false), args, 'fixture'))
})


test('nearest and renamed field hints coexist without replacing board guidance', () => {
  const error = comments.getAddCommentCrudBaseSchema().safeParse({ taskId: 42 }).error
  const issue = error.issues.find((issue) => issue.code === 'unrecognized_keys')
  issue.fieldHint = 'Did you mean task_id?'
  assert.equal(actionableToolError(error, { nearestField: true, renamedField: true, fields: ['task_id'] }), 'Remove unsupported fields taskId from input; use only fields documented for this action. Use task_id instead of taskId. Did you mean task_id?')
})
