const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-relations.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { normalizeTaskRelationType } = jiti(
  path.join(root, 'src/lib/mcp/tasks/relationType.ts')
)
const { blockerStillOpen } = jiti(
  path.join(root, 'src/lib/mcp/tasks/blockerStillOpen.ts')
)

test('normalizes supported MCP task relation types', () => {
  assert.equal(normalizeTaskRelationType('RelatedTo'), 'RelatedTo')
  assert.equal(normalizeTaskRelationType('BlockedBy'), 'BlockedBy')
  assert.equal(normalizeTaskRelationType('BlockedTo'), 'BlockedTo')
})

test('rejects unsupported MCP task relation types', () => {
  assert.equal(normalizeTaskRelationType('Duplicate'), null)
  assert.equal(normalizeTaskRelationType('blockedby'), null)
  assert.equal(normalizeTaskRelationType(123), null)
})

test('defaults a missing or null MCP task relation type to RelatedTo', () => {
  assert.equal(normalizeTaskRelationType(), 'RelatedTo')
  // explicit null (how typed JSON clients serialize an omitted optional) also defaults
  assert.equal(normalizeTaskRelationType(null), 'RelatedTo')
})

test('a blocker blocks only while genuinely open', () => {
  // active blocker in a non-done column still blocks
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'In Progress' }), true)
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'Backlog' }), true)
  // finished: archived, or sitting in a done-role column, is resolved
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'Done' }), false)
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'Shipped' }), false)
  assert.equal(blockerStillOpen({ status: 'Archive', section: 'In Progress' }), false)
  // word-boundary regression (the point of reusing columnRole): a substring match
  // would wrongly read these as done; columnRole does not, so they still block.
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'Redone' }), true)
  assert.equal(blockerStillOpen({ status: 'Normal', section: 'Incomplete' }), true)
})
