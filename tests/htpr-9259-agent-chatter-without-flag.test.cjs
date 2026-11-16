const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { setup } = require('./helpers/comment-routing.cjs')

const routing = load('src/lib/mcp/operations/comments/agentChatterRouting.ts', {})

test('untyped agent progress reaches the log with no safety switch left to read', async () => {
  const { post, calls } = setup({ writing: false })
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(calls.comments.length, 0)
  assert.equal(calls.activities.length, 1)
  assert.equal(calls.flags.some(({ key }) => key === 'htpr-7341-agent-chatter-to-log'), false)
})

test('legacy routing sends untyped agent progress to the log without a flag field', () => {
  assert.equal(
    routing.routeComment({ agentId: 'agent-1', legacy: { mentionsPerson: false, hasImages: false } }),
    'log',
  )
})

test('legacy routing still keeps replies, mentions and images as comments', () => {
  assert.equal(
    routing.routeComment({ agentId: 'agent-1', legacy: { replyToCommentId: 12, mentionsPerson: false, hasImages: false } }),
    'comments',
  )
  assert.equal(
    routing.routeComment({ agentId: 'agent-1', legacy: { mentionsPerson: true, hasImages: false } }),
    'comments',
  )
  assert.equal(
    routing.routeComment({ agentId: 'agent-1', legacy: { mentionsPerson: false, hasImages: true } }),
    'comments',
  )
})
