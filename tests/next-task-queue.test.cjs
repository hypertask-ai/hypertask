const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/next-task-queue.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { priorityScore } = jiti(
  path.join(root, 'src/lib/mcp/tasks/priorityScore.ts')
)

const now = new Date('2026-07-20T12:00:00.000Z')

test('urgent priority scores higher than low priority', () => {
  assert.ok(priorityScore('Urgent', null, now) > priorityScore('Low', null, now))
})

test('overdue tasks receive a two-point bonus', () => {
  const overdue = new Date(now.getTime() - 1)
  assert.equal(priorityScore('Medium', overdue, now), 4)
})

test('tasks due within 24 hours receive a one-point bonus', () => {
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  assert.equal(priorityScore('Medium', dueSoon, now), 3)
})

test('tasks without priority or due date score zero', () => {
  assert.equal(priorityScore(null, null, now), 0)
})
