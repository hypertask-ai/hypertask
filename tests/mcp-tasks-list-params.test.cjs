const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
  alias: { '@': path.join(root, 'src') },
})
const { parseSortOrderParam, findParamWithNulByte, findIdParamOutOfRange } = jiti(path.join(root, 'src/lib/mcp/listParams.ts'))

// HTPR-7344: sort_order=DESC reached Prisma unchecked and the task list answered 500.
test('sort_order accepts asc and desc in any case', () => {
  assert.equal(parseSortOrderParam('desc', 'desc'), 'desc')
  assert.equal(parseSortOrderParam('asc', 'desc'), 'asc')
  assert.equal(parseSortOrderParam('DESC', 'asc'), 'desc')
  assert.equal(parseSortOrderParam(' Asc ', 'desc'), 'asc')
})

test('missing or blank sort_order falls back to the default', () => {
  assert.equal(parseSortOrderParam(null, 'desc'), 'desc')
  assert.equal(parseSortOrderParam('', 'desc'), 'desc')
  assert.equal(parseSortOrderParam('  ', 'asc'), 'asc')
})

test('unknown sort_order values are rejected', () => {
  assert.equal(parseSortOrderParam('foo', 'desc'), null)
  assert.equal(parseSortOrderParam('ascending', 'desc'), null)
})

// HTPR-7344: Postgres refuses NUL bytes in text, so search=%00 answered 500.
test('a NUL byte in any value or key is found and named', () => {
  assert.equal(findParamWithNulByte(new URLSearchParams('project_id=15&search=%00')), 'search')
  assert.equal(findParamWithNulByte(new URLSearchParams('section=Bu%00gs')), 'section')
  assert.equal(findParamWithNulByte(new URLSearchParams('se%00arch=x')), 'search')
})

test('ordinary params pass the NUL check', () => {
  assert.equal(findParamWithNulByte(new URLSearchParams('project_id=15&search=ai%20feedback&labels=bug')), null)
  assert.equal(findParamWithNulByte(new URLSearchParams('')), null)
})

test('ids past the database integer range are found and named (HTPR-7345 log: task_id=99999999999 answered 500)', () => {
  assert.equal(findIdParamOutOfRange({ task_id: [1, 99999999999] }), 'task_id')
  assert.equal(findIdParamOutOfRange({ cursor: null, created_by: 2147483648 }), 'created_by')
  assert.equal(findIdParamOutOfRange({ section_id: -99999999999 }), 'section_id')
})

test('ids inside the database integer range pass', () => {
  assert.equal(findIdParamOutOfRange({ task_id: [64140], cursor: 2147483647, created_by: null, section_id: undefined, assigned_to: [] }), null)
})
