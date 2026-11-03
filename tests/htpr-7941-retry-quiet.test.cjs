const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const retry = load('src/lib/aiFeedback/retryQuiet.ts', {})

test('a call that fails then succeeds with the same arguments files nothing', async () => {
  let filed = 0
  const key = retry.failureKey(42, 'hypertask_tasks', { board: 'project-15', limit: 5 })
  const pending = retry.deferFailure(key, async () => { filed++ }, 60)
  assert.equal(retry.noteSuccess(key), true)
  await pending
  assert.equal(filed, 0)
})

test('a failure with no successful retry still files once the window ends', async () => {
  let filed = 0
  await retry.deferFailure(retry.failureKey(42, 'hypertask_tasks', { limit: 1 }), async () => { filed++ }, 20)
  assert.equal(filed, 1)
})

test('the same call failing twice files at once instead of waiting again', async () => {
  let filed = 0
  const key = retry.failureKey(42, 'hypertask_comment_add', { text: 'x' })
  const first = retry.deferFailure(key, async () => { filed++ }, 5000)
  await retry.deferFailure(key, async () => { filed++ }, 5000)
  await first
  assert.equal(filed, 1)
})

test('the failure key ignores argument order and never crosses a caller', () => {
  assert.equal(
    retry.failureKey(42, 'tool', { a: 1, b: { c: 2, d: [3, 4] } }),
    retry.failureKey(42, 'tool', { b: { d: [3, 4], c: 2 }, a: 1 }),
  )
  assert.notEqual(retry.failureKey(42, 'tool', { a: 1 }), retry.failureKey(42, 'other', { a: 1 }))
  assert.notEqual(retry.failureKey(42, 'tool', { a: 1 }), retry.failureKey(42, 'tool', { a: 2 }))
  assert.notEqual(retry.failureKey(42, 'tool', { a: 1 }), retry.failureKey(43, 'tool', { a: 1 }))
})

test('another caller succeeding does not cancel this caller\'s pending failure', async () => {
  let filed = 0
  const mine = retry.failureKey(42, 'hypertask_tasks', { limit: 3 })
  const theirs = retry.failureKey(43, 'hypertask_tasks', { limit: 3 })
  const pending = retry.deferFailure(mine, async () => { filed++ }, 20)
  assert.equal(retry.noteSuccess(theirs), false)
  await pending
  assert.equal(filed, 1)
})

test('a quiet window of zero files at once, and nothing stays pending', async () => {
  let filed = 0
  await retry.deferFailure(retry.failureKey(42, 'tool', {}), async () => { filed++ }, 0)
  assert.equal(filed, 1)
  assert.equal(retry.pendingFailures(), 0)
})

const { loader } = require('./htpr-6927-fixtures.cjs')

function setupObserver() {
  process.env.AI_FEEDBACK_RETRY_QUIET_MS = '15'
  const filed = [], waiting = []
  const load = loader({
    '@vercel/functions': { waitUntil: work => waiting.push(work) },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    './report': { fileAiFeedback: async (input) => { filed.push(input) } },
    './callerFixable': { callerCanFixRefusal: () => false, quietFixableReports: async () => true },
  })
  const { observeFeedbackTools } = load('src/lib/aiFeedback/automatic.ts')
  return { filed, waiting, observeFeedbackTools }
}

async function call(observer, reply, userId = 42) {
  const [tool] = observer.observeFeedbackTools([{
    name: 'hypertask_tasks',
    execute: async () => JSON.stringify(reply),
  }], userId)
  return tool.execute({ limit: 5 }, 'token')
}

test('a 500 then a real success files nothing', async () => {
  const observer = setupObserver()
  await call(observer, { status: 500 })
  await call(observer, { ok: true })
  await Promise.all(observer.waiting)
  assert.equal(observer.filed.length, 0)
})

test('a 500 then another refusal still files, an error reply is not a success', async () => {
  const observer = setupObserver()
  await call(observer, { status: 500 })
  await call(observer, { status: 400 })
  await Promise.all(observer.waiting)
  assert.equal(observer.filed.length, 1)
  assert.equal(observer.filed[0].status, 500)
})

test('a 500 then the same call succeeding for another caller still files', async () => {
  const observer = setupObserver()
  await call(observer, { status: 500 }, 42)
  await call(observer, { ok: true }, 43)
  await Promise.all(observer.waiting)
  assert.equal(observer.filed.length, 1)
})
