const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const retry = load('src/lib/aiFeedback/retryQuiet.ts', {})

test('a call that fails then succeeds with the same arguments files nothing', async () => {
  let filed = 0
  const key = retry.failureKey('hypertask_tasks', { board: 'project-15', limit: 5 })
  const pending = retry.deferFailure(key, async () => { filed++ }, 60)
  assert.equal(retry.noteSuccess(key), true)
  await pending
  assert.equal(filed, 0)
})

test('a failure with no successful retry still files once the window ends', async () => {
  let filed = 0
  await retry.deferFailure(retry.failureKey('hypertask_tasks', { limit: 1 }), async () => { filed++ }, 20)
  assert.equal(filed, 1)
})

test('the same call failing twice files at once instead of waiting again', async () => {
  let filed = 0
  const key = retry.failureKey('hypertask_comment_add', { text: 'x' })
  const first = retry.deferFailure(key, async () => { filed++ }, 5000)
  await retry.deferFailure(key, async () => { filed++ }, 5000)
  await first
  assert.equal(filed, 1)
})

test('the failure key ignores argument order and names the tool', () => {
  assert.equal(
    retry.failureKey('tool', { a: 1, b: { c: 2, d: [3, 4] } }),
    retry.failureKey('tool', { b: { d: [3, 4], c: 2 }, a: 1 }),
  )
  assert.notEqual(retry.failureKey('tool', { a: 1 }), retry.failureKey('other', { a: 1 }))
  assert.notEqual(retry.failureKey('tool', { a: 1 }), retry.failureKey('tool', { a: 2 }))
})

test('a quiet window of zero files at once, and nothing stays pending', async () => {
  let filed = 0
  await retry.deferFailure(retry.failureKey('tool', {}), async () => { filed++ }, 0)
  assert.equal(filed, 1)
  assert.equal(retry.pendingFailures(), 0)
})
