const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { setup } = require('./helpers/comment-routing.cjs')

const definition = load('src/lib/flags/definitions/htpr-8437-people-comment-needs-kind.ts', {})

test('the untyped comment rule ships for everyone with release-risk metadata', () => {
  assert.equal(definition.HTPR_8437_PEOPLE_COMMENT_NEEDS_KIND_FLAG, 'htpr-8437-people-comment-needs-kind')
  assert.equal(definition.default.key, 'htpr-8437-people-comment-needs-kind')
  assert.equal(definition.default.kind, 'bugfix')
  assert.equal(definition.default.defaultMode, 'EVERYONE')
  assert.match(definition.default.shippedOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(definition.default.releaseRisk.highRisk, undefined)
  assert.ok(definition.default.releaseRisk.reason.trim())
  assert.ok(definition.default.description.trim())
})

test('a token without an agent log cannot publish robot status as a people comment', async () => {
  const { post, calls } = setup({ human: true })
  const response = await post()
  assert.equal(response.status, 400)
  assert.equal(response.body.field, 'kind')
  assert.equal(response.body.code, 'missing_field')
  assert.deepEqual(response.body.allowed_values, ['question', 'qa', 'done'])
  assert.match(response.body.error, /Text with no kind belongs in an agent log/)
  assert.equal(calls.comments.length + calls.broadcasts.length + calls.urls.length, 0)
})

for (const kind of ['question', 'qa', 'done']) {
  test(`a token without an agent log still posts a people comment with kind ${kind}`, async () => {
    const { post, calls } = setup({ human: true })
    const response = await post({ kind })
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'comments')
    assert.equal(response.body.comment.kind, kind)
    assert.equal(calls.comments.length, 1)
    assert.equal(calls.comments[0].kind, kind)
  })
}

test('switching the rule off accepts the same untyped comment again', async () => {
  const { post, calls } = setup({ human: true, kindRequired: false })
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.visibleToPeople, true)
  assert.equal(calls.comments.length, 1)
})

test('agent text with no kind still goes to the hidden agent log', async () => {
  const { post, calls } = setup()
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(calls.comments.length, 0)
})

test('a dry run still reports where an untyped comment would land', async () => {
  const { post, calls } = setup({ human: true })
  const response = await post({ dry_run: true })
  assert.equal(response.status, 200)
  assert.equal(response.body.would.routedTo, 'comments')
  assert.equal(calls.comments.length, 0)
})
