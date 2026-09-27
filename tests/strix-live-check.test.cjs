const test = require('node:test')
const assert = require('node:assert/strict')

test('only authenticated errors prove rejection in live probes', async () => {
  const { isAuthRejection } = await import('../scripts/strix-auth-response.mjs')
  for (const status of [200, 400, 404, 429, 500]) {
    assert.equal(await isAuthRejection(new Response('error', { status })), false, `HTTP ${status}`)
  }
  assert.equal(await isAuthRejection(new Response('unauthorized', { status: 401 })), true)
  assert.equal(await isAuthRejection(new Response('forbidden', { status: 403 })), true)
  assert.equal(await isAuthRejection(new Response(JSON.stringify({ success: false, error: 'Validation error' }), { status: 400 }), 'Invalid or expired token'), false)
  assert.equal(await isAuthRejection(new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), { status: 400 })), false)
  assert.equal(await isAuthRejection(new Response('not JSON', { status: 400 }), 'Invalid or expired token'), false)
  const expected = new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), { status: 400 })
  assert.equal(await isAuthRejection(expected, 'Invalid or expired token'), true)
  assert.equal(expected.bodyUsed, true)
})
