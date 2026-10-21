const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/comment-routing.cjs')
const { load } = require('./task-route-loader.cjs')

function assertComment(response, calls, kind = null) {
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.comment.id, 42)
  assert.equal(response.body.comment.kind, kind)
  assert.equal(calls.comments.length, 1)
  assert.equal(calls.activities.length, 0)
  assert.equal(calls.broadcasts.length, 1)
}

test('untyped agent post with attachment intent stays a comment with an uploadable id', async () => {
  const { post, calls } = setup()
  assertComment(await post({ has_attachments: true }), calls)
})

for (const body of [{}, { has_attachments: false }]) {
  test(`untyped agent chatter still goes to the log: ${JSON.stringify(body)}`, async () => {
    const { post, calls } = setup()
    const response = await post(body)
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'log')
    assert.equal(response.body.activity.id, 'activity-1')
    assert.equal(response.body.comment, undefined)
    assert.equal(calls.comments.length, 0)
  })
}

for (const has_attachments of ['yes', null, 1, [], {}]) {
  test(`non-boolean attachment intent is a field error: ${JSON.stringify(has_attachments)}`, async () => {
    const { post, calls } = setup()
    const response = await post({ has_attachments })
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'invalid_field')
    assert.equal(response.body.field, 'has_attachments')
    assert.equal(response.body.error, 'has_attachments must be a boolean')
    assert.equal(calls.comments.length + calls.activities.length + calls.runs.length, 0)
  })
}

for (const body of [{}, { has_attachments: true }, { has_attachments: false }]) {
  test(`human comment behavior is unchanged: ${JSON.stringify(body)}`, async () => {
    const { post, calls } = setup({ human: true })
    assertComment(await post(body), calls)
  })
  for (const kind of ['question', 'qa', 'done']) {
    test(`explicit ${kind} remains a comment: ${JSON.stringify(body)}`, async () => {
      const { post, calls } = setup()
      assertComment(await post({ ...body, kind }), calls, kind)
    })
  }
}

test('attachment-intent flag off restores agent log routing', async () => {
  const { post, calls } = setup({ attachFlag: false })
  const response = await post({ has_attachments: true })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.activity.id, 'activity-1')
  assert.equal(calls.comments.length, 0)
})

test('attachment flag does not change legacy comments or image exceptions', async () => {
  const legacy = setup({ flag: false, attachFlag: false })
  assertComment(await legacy.post({ has_attachments: true }), legacy.calls)
  const images = setup({ attachFlag: false })
  assertComment(await images.post({ images: ['https://example.com/a.png'] }), images.calls)
})

test('dry run reports attachment-intent routing without persisting', async () => {
  for (const [attachFlag, expected] of [[true, 'comments'], [false, 'log']]) {
    const { post, calls } = setup({ attachFlag })
    const response = await post({ has_attachments: true, dry_run: true })
    assert.equal(response.status, 200)
    assert.equal(response.body.would.routedTo, expected)
    assert.equal(calls.comments.length + calls.activities.length + calls.runs.length, 0)
  }
})

test('MCP add schemas accept only boolean attachment intent and reject it on other actions', () => {
  const schemas = load('src/lib/mcp-server/validations/comment.validation.ts', {})
  for (const has_attachments of [true, false]) {
    const input = { task_id: 99, text: 'Files for review', has_attachments }
    assert.equal(schemas.validateAndSanitizeAddCommentInput(input).has_attachments, has_attachments)
    assert.equal(schemas.validateAndSanitizeAddCommentCrudInput({ ...input, action: 'add' }).has_attachments, has_attachments)
  }
  assert.throws(() => schemas.validateAndSanitizeAddCommentInput({ task_id: 99, text: 'Files', has_attachments: 'yes' }))
  for (const action of ['update', 'delete']) {
    assert.throws(() => schemas.validateAndSanitizeAddCommentCrudInput({ action, comment_id: 42, text: 'Files', has_attachments: true }))
  }
})

test('MCP add tool forwards attachment intent through its validation boundary', async () => {
  let params
  const { addCommentTool } = load('src/lib/mcp-server/tools/add-comment.tool.ts', {
    '../lib/services/comment.service': { CommentService: class {} },
    '../utils/executeWithService': { executeWithService: async (_ctx, _service, handler) => handler({ addComment: async (input) => { params = input; return { success: true } } }) },
  })
  assert.deepEqual(await addCommentTool.execute({ action: 'add', task_id: 99, text: 'Files', has_attachments: true }, 'test-token'), { success: true })
  assert.equal(params.has_attachments, true)
})

test('attachment routing bugfix flag is registered with its release metadata', () => {
  const flags = require('./helpers/flag-files.cjs')
  const key = flags.load('src/lib/flags/keys.ts').HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG
  assert.equal(key, 'htpr-7512-attach-keeps-comment')
  const definition = flags.definitions().find(({ key: candidate }) => candidate === key)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.shippedOn, '2026-10-21')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.ok(definition.releaseRisk.reason)
})
