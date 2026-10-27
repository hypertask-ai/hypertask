const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const fixture = require('./fixtures/htpr-7341-igsh-266.json')
const flag = 'htpr-7341-agent-chatter-to-log'
const routing = load('src/lib/mcp/operations/comments/agentChatterRouting.ts', {})

const { setup } = require('./helpers/comment-routing.cjs')

function assertComment(response, calls, kind) {
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.visibleToPeople, true)
  assert.equal(response.body.comment.kind, kind ?? null)
  assert.equal(calls.comments.length, 1)
  assert.equal(calls.comments[0].kind, kind)
  assert.equal(calls.activities.length, 0)
  assert.equal(calls.broadcasts.length, 1)
}

test('flag on refuses chatter as a comment and writes a parsed thought without comment notifications', async () => {
  const { post, calls } = setup()
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.match(response.body.notice, /agent log, not the ticket thread/)
  assert.match(response.body.notice, /people do not see it/)
  assert.match(response.body.notice, /Resend with kind \(question\|qa\|done\)/)
  assert.equal(response.body.url, 'https://app.hypertask.ai/detail/project-15/7341')
  assert.ok(response.body.activity.id)
  assert.equal(response.body.activity.type, 'thought')
  assert.equal(response.body.activity.text, 'Progress & next step')
  assert.equal(response.body.comment, undefined)
  assert.equal(calls.comments.length, 0)
  assert.equal(calls.broadcasts.length, 0)
  assert.equal(calls.urls.length, 0)
  assert.deepEqual(calls.runs, [[{ userId: 6, agentId: 'agent-1', teamScope: null, displayName: 'Owner', source: 'agent' }, { taskId: 99, title: null, source: 'runtime' }]])
  assert.equal(calls.activities[0][2].type, 'THOUGHT')
  assert.deepEqual(calls.flags, [{ key: flag, userId: 6 }])
})

for (const kind of routing.COMMENT_KINDS) {
  test(`flag on still allows agent kind ${kind} as a persisted comment`, async () => {
    const { post, calls } = setup()
    assertComment(await post({ kind }), calls, kind)
    assert.equal(calls.runs.length, 0)
  })
}

test('human posts remain comments with flag on', async () => {
  const { post, calls } = setup({ human: true })
  assertComment(await post(), calls)
})

for (const field of ['reply_to_comment_id', 'reply_to_invocation_id']) {
  test(`${field} agent mention replies remain comments`, async () => {
    const { post, calls } = setup()
    assertComment(await post({ [field]: 12 }), calls)
    assert.equal(calls.comments[0][field === 'reply_to_comment_id' ? 'directReplySourceCommentId' : 'directReplyInvocationId'], 12)
  })
}

test('agent Question that @mentions a person in the text stays a comment without a kind', async () => {
  const { post, calls } = setup({ textMentions: ['6'] })
  assertComment(await post({ text: '<p>Question: Switch htpr-7290-durable-signup-identify to Owner + QA?</p>' }), calls)
  assert.equal(calls.runs.length, 0)
})

test('agent post with a mentions list stays a comment without a kind', async () => {
  const { post, calls } = setup()
  assertComment(await post({ mentions: [{ user_id: 6, display_name: 'Valentin Yeo' }] }), calls)
  assert.equal(calls.runs.length, 0)
})

test('flag off still allows untyped agent comments exactly as before', async () => {
  const { post, calls } = setup({ flag: false })
  assertComment(await post(), calls)
  assert.equal(calls.runs.length, 0)
})

for (const kind of ['chatter', null, '', 1]) {
  test(`invalid kind ${JSON.stringify(kind)} is rejected without writes`, async () => {
    const { post, calls } = setup()
    const response = await post({ kind })
    assert.equal(response.status, 400)
    assert.equal(response.body.field, 'kind')
    assert.equal(response.body.code, 'invalid_field')
    assert.deepEqual(response.body.allowed_values, ['question', 'qa', 'done'])
    assert.equal(calls.comments.length + calls.activities.length + calls.runs.length, 0)
  })
}

for (const options of [{ noRun: true }, { runtime: false }, { noActivity: true }, { formattedText: '<p><img src="https://example.com/a.png"></p>' }]) {
  test(`unavailable log falls back to a comment: ${JSON.stringify(options)}`, async () => {
    const { post, calls } = setup(options)
    const response = await post()
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'comments')
    assert.equal(response.body.visibleToPeople, true)
    assert.equal(calls.comments.length, 1)
  })
}

test('dry run reports routing without run, activity or comment writes', async () => {
  for (const [options, body, routedTo] of [[{}, {}, 'log'], [{ flag: false }, {}, 'comments'], [{}, { kind: 'question' }, 'comments'], [{ runtime: false }, {}, 'comments']]) {
    const { post, calls } = setup(options)
    const response = await post({ ...body, dry_run: true })
    assert.equal(response.status, 200)
    assert.equal(response.body.would.routedTo, routedTo)
    assert.equal(calls.comments.length + calls.activities.length + calls.runs.length, 0)
    assert.equal(calls.idempotency.length, 0)
  }
})

test('agent progress post with images stays a comment so the images are kept', async () => {
  const { post, calls } = setup()
  assertComment(await post({ images: ['https://example.com/shot.png'] }), calls)
  assert.equal(calls.runs.length, 0)
})

test('logged text keeps link destinations', async () => {
  const { post, calls } = setup()
  const response = await post({ text: '<p>PR <a href="https://example.com/pull/1650">#1650</a> opened, see <a href="https://example.com/x">https://example.com/x</a></p>' })
  assert.equal(response.body.routedTo, 'log')
  assert.equal(calls.activities[0][2].text, 'PR #1650 (https://example.com/pull/1650) opened, see https://example.com/x')
})

test('idempotent retry writes the thought once and passes the client key through', async () => {
  const { post, calls } = setup()
  const first = await post({}, 'request-1')
  const retry = await post({}, 'request-1')
  assert.equal(first.body.routedTo, 'log')
  assert.equal(retry.body.routedTo, 'log')
  assert.equal(retry.body.visibleToPeople, false)
  assert.equal(retry.body.notice, first.body.notice)
  assert.equal(retry.body.idempotent_replayed, true)
  assert.equal(calls.runs.length, 1)
  assert.equal(calls.activities.length, 1)
  assert.equal(calls.activities[0][3], 'request-1')
  assert.equal(calls.comments.length, 0)
})

test('plain activity text is truncated at the real parser limit without splitting a surrogate pair', async () => {
  const { AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH: max } = load('src/lib/agentRuns/model.ts', {})
  const { post, calls } = setup({ formattedText: `<p>${'x'.repeat(max - 1)}😀end</p>` })
  const response = await post()
  assert.equal(response.body.routedTo, 'log')
  assert.equal(calls.activities[0][2].text, 'x'.repeat(max - 1))
})

test('task access denial happens before logging', async () => {
  const { post, calls } = setup({ noTask: true })
  assert.equal((await post()).status, 404)
  assert.equal(calls.comments.length + calls.runs.length + calls.activities.length, 0)
})

test('all six real IGSH-266 texts replay to the log, never comments', async () => {
  const { post, calls } = setup()
  let logCount = 0
  for (const { text } of fixture.comments) {
    const response = await post({ text })
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'log')
    logCount += response.body.routedTo === 'log' ? 1 : 0
  }
  assert.equal(logCount, 6)
  assert.equal(calls.activities.length, 6)
  assert.equal(calls.comments.length, 0)
})

test('pure routing accepts only declared kinds and preserves both direct reply forms', () => {
  assert.equal(routing.parseCommentKind(undefined), undefined)
  assert.throws(() => routing.parseCommentKind('chatter'), /question, qa, done/)
  assert.equal(routing.routeComment({ flagEnabled: true, agentId: 'agent' }), 'log')
  assert.equal(routing.routeComment({ flagEnabled: true, agentId: 'agent', replyToInvocationId: 1 }), 'comments')
  assert.equal(routing.routeComment({ flagEnabled: true, agentId: 'agent', mentionsPerson: true }), 'comments')
  assert.equal(routing.routeComment({ flagEnabled: true, agentId: 'agent', hasImages: true }), 'comments')
})

test('kind is stored on the real comment persistence create payload', async () => {
  const { persistComment } = load('src/utils/controllers/comments/persistComment.ts', {
    './agentCommentFanout': {},
  })
  const stop = new Error('persistence payload captured')
  for (const kind of routing.COMMENT_KINDS) {
    let stored
    const tx = {
      $queryRaw: async () => [{ id: 99 }],
      task: { findFirst: async () => ({ id: 99 }) },
      comment: { create: async ({ data }) => { stored = data; throw stop } },
    }
    await assert.rejects(persistComment({ prisma: { $transaction: (fn) => fn(tx) }, taskWriteAccessWhere: () => ({}) }, {
      kind, taskId: 99, creatorId: 6, currentUser: { id: 6 },
    }, 'Decision', 6, 10, []), (error) => error === stop)
    assert.equal(stored.kind, kind)
    assert.equal(stored.text, 'Decision')
  }
})

test('real MCP schemas accept kind for add and reject invalid or non-add kinds', () => {
  const schemas = load('src/lib/mcp-server/validations/comment.validation.ts', {})
  for (const kind of routing.COMMENT_KINDS) {
    assert.equal(schemas.validateAndSanitizeAddCommentInput({ task_id: 99, text: 'Summary', kind }).kind, kind)
    assert.equal(schemas.validateAndSanitizeAddCommentCrudInput({ action: 'add', task_id: 99, text: 'Summary', kind }).kind, kind)
  }
  assert.throws(() => schemas.validateAndSanitizeAddCommentInput({ task_id: 99, text: 'Summary', kind: 'chatter' }))
  assert.throws(() => schemas.validateAndSanitizeAddCommentCrudInput({ action: 'update', comment_id: 42, text: 'Summary', kind: 'done' }))
})

test('real add-comment MCP tool forwards kind to its service', async () => {
  let params
  const { addCommentTool } = load('src/lib/mcp-server/tools/add-comment.tool.ts', {
    '../lib/services/comment.service': { CommentService: class {} },
    '../utils/executeWithService': { executeWithService: async (_ctx, _service, handler) => handler({ addComment: async (input) => { params = input; return { success: true } } }) },
  })
  await addCommentTool.execute({ action: 'add', task_id: 99, text: 'Decision?', kind: 'question' }, 'token')
  assert.equal(params.kind, 'question')
})

test('ticket flag is registered by generated keys and definitions with the requested metadata', () => {
  const keys = require('./helpers/flag-files.cjs').load('src/lib/flags/keys.ts')
  const definitions = require('./helpers/flag-files.cjs').definitions()
  assert.equal(keys.HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG, flag)
  const definition = definitions.find(({ key }) => key === flag)
  assert.equal(definition.kind, 'feature')
  assert.equal(definition.defaultMode, undefined)
  assert.equal(definition.shippedOn, '2026-10-19')
  assert.ok(definition.releaseRisk.reason)
})

for (const enabled of [false, true]) {
  test(`image routing ignores forged booleans and uses same-call attachments, flag ${enabled}`, async () => {
    const forged = setup({ inlineImages: enabled });
    assert.equal((await forged.post({ has_image_attachments: true })).body.routedTo, "log");
    const image = setup({ inlineImages: enabled });
    const response = await image.post({ attachments: [{ filename: "image.png", content_type: "image/png", url: "https://files.hypertask.app/image.png" }] });
    assert.equal(response.body.routedTo, enabled ? "comments" : "log");
    const document = setup({ inlineImages: enabled });
    assert.equal((await document.post({ attachments: [{ filename: "report.pdf", content_type: "application/pdf", url: "https://files.hypertask.app/report.pdf" }] })).body.routedTo, "log");
    const invalid = setup({ inlineImages: enabled });
    assert.equal((await invalid.post({ attachments: [{ filename: "image.png", content_type: "image/png" }] })).status, enabled ? 400 : 201);
  });
}
