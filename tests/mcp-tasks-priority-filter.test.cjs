const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
  alias: { '@': path.join(root, 'src') },
})
const { parsePriorityFilter } = jiti(path.join(root, 'src/lib/mcp/priorityFilter.ts'))

// HTPR-6799: `hypertask tasks list --priority urgent` sends priority=1 and got nothing.
test('priority numbers from the CLI resolve to the stored index', () => {
  assert.deepEqual(parsePriorityFilter(['1']), [1])
  assert.deepEqual(parsePriorityFilter(['1', '2']), [1, 2])
})

test('priority names resolve case-insensitively', () => {
  assert.deepEqual(parsePriorityFilter(['Urgent']), [1])
  assert.deepEqual(parsePriorityFilter(['high,low']), [2, 4])
  assert.deepEqual(parsePriorityFilter(['none']), [0])
  assert.deepEqual(parsePriorityFilter(['No Priority']), [0])
})

test('no priority param means no filter', () => {
  assert.deepEqual(parsePriorityFilter([]), [])
})

test('unknown priorities are rejected', () => {
  assert.equal(parsePriorityFilter(['eventually']), null)
  assert.equal(parsePriorityFilter(['9']), null)
})
