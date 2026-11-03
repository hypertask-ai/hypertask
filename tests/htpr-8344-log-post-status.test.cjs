const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/comment-routing.cjs')

test('a post saved to the hidden agent log answers 202, not 201', async () => {
  const { post, calls } = setup({ logStatusFlag: true })
  const response = await post()
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.status, 202)
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.comment, undefined)
  assert.equal(calls.comments.length, 0)
})

test('a people comment still answers 201', async () => {
  const { post, calls } = setup({ logStatusFlag: true })
  const response = await post({ kind: 'qa' })
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.status, 201)
  assert.equal(response.body.comment.id, 42)
  assert.equal(calls.comments.length, 1)
})

test('with the flag off a log entry keeps answering 201, as before', async () => {
  const { post } = setup()
  const response = await post()
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.status, 201)
})

test('a dry run still answers 200 and names the route it would take', async () => {
  const { post } = setup({ logStatusFlag: true })
  const response = await post({ dry_run: true })
  assert.equal(response.status, 200)
  assert.equal(response.body.would.routedTo, 'log')
})
