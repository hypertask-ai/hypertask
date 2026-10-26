const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-7819-not-found-no-feedback'

function setup({ enabled = true, flagError = false } = {}) {
  const filed = [], pending = []
  const load = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/flags': { isFeatureEnabled: async (key) => {
      if (flagError) throw new Error('flags unavailable')
      return key === flag ? enabled : false
    } },
    './report': { fileAiFeedback: async (input) => { filed.push(input) } },
    './callerFixable': { callerCanFix: () => false, refusalFromZodIssues: () => ({}), quietFixableReports: async () => false },
  })
  const { observeFeedbackTools } = load('src/lib/aiFeedback/automatic.ts')
  return { filed, pending, observeFeedbackTools }
}

async function fail(options, error) {
  const f = setup(options)
  const [tool] = f.observeFeedbackTools([{ name: 'hypertask_tasks', execute: async () => { throw error } }], 42)
  await assert.rejects(tool.execute({}, 'token'), thrown => thrown === error)
  await Promise.all(f.pending)
  return f.filed
}

const withStatus = status => Object.assign(new Error('Task not found or access denied'), { status })

test('not found skipped: a 404 tool failure files no feedback and still reaches the caller', async () => {
  assert.deepEqual(await fail({}, withStatus(404)), [])
})

test('server error still filed: a 500 tool failure files feedback', async () => {
  const filed = await fail({}, withStatus(500))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 500)
})

test('flag off unchanged: a 404 tool failure files feedback while the flag is off', async () => {
  const filed = await fail({ enabled: false }, withStatus(404))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 404)
})

test('flag lookup failure keeps filing a 404 report', async () => {
  const filed = await fail({ flagError: true }, withStatus(404))
  assert.equal(filed.length, 1)
})

test('a 400 tool failure still files feedback', async () => {
  const filed = await fail({}, withStatus(400))
  assert.equal(filed.length, 1)
})
