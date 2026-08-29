const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-session.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { normalizeSessionStatus } = jiti(
  path.join(root, 'src/lib/mcp/tasks/sessionStatus.ts')
)

test('normalizes session status from enum name or lowercase', () => {
  assert.equal(normalizeSessionStatus('Active'), 'Active')
  assert.equal(normalizeSessionStatus('idle'), 'Idle')
  assert.equal(normalizeSessionStatus('DEAD'), 'Dead')
})

test('defaults absent/null status to Active', () => {
  assert.equal(normalizeSessionStatus(), 'Active')
  assert.equal(normalizeSessionStatus(null), 'Active')
})

test('rejects an unknown status', () => {
  assert.equal(normalizeSessionStatus('running'), null)
  assert.equal(normalizeSessionStatus(3), null)
})
