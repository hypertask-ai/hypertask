const test = require('node:test')
const assert = require('node:assert/strict')

test('only authenticated errors prove rejection in live probes', async () => {
  const { isAuthRejection } = await import('../scripts/strix-auth-response.mjs')
  for (const status of [200, 400, 404, 429, 500]) {
    assert.equal(isAuthRejection(status), false, `HTTP ${status}`)
  }
  assert.equal(isAuthRejection(401), true)
  assert.equal(isAuthRejection(403), true)
  assert.equal(isAuthRejection(400, { success: false, error: 'Validation error' }, 'Invalid or expired token'), false)
  assert.equal(isAuthRejection(400, { success: false, error: 'Invalid or expired token' }), false)
  assert.equal(isAuthRejection(400, { success: false, error: 'Invalid or expired token' }, 'Invalid or expired token'), true)
})
