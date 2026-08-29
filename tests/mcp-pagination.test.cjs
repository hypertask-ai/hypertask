const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-pagination.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { decodeCursor, encodeCursor } = jiti(
  path.join(root, 'src/lib/mcp/pagination/cursor.ts')
)

test('task cursor round-trips its task id', () => {
  assert.equal(decodeCursor(encodeCursor(123)), 123)
})

test('task cursor rejects malformed base64', () => {
  assert.equal(decodeCursor('not-base64!'), null)
})

test('task cursor rejects an empty value', () => {
  assert.equal(decodeCursor(''), null)
})
