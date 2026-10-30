const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-7838-conflict-no-feedback'

function setup({ enabled = true, flagError = false } = {}) {
  const filed = [], pending = []
  const load = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/flags': { isFeatureEnabled: async (key) => {
      if (flagError) throw new Error('flags unavailable')
      return key === flag ? enabled : false
    } },
    './report': { fileAiFeedback: async (input) => { filed.push(input) } },
    './callerFixable': { callerCanFixRefusal: () => false, quietFixableReports: async () => false },
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

const withStatus = status => Object.assign(new Error('request failed'), { status })

test('conflict skipped: a 409 tool failure files no feedback and still reaches the caller', async () => {
  assert.deepEqual(await fail({}, withStatus(409)), [])
})

test('server error still filed: a 500 tool failure files feedback', async () => {
  const filed = await fail({}, withStatus(500))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 500)
  assert.equal(filed[0].errorCode, 'tool-exception')
})

test('flag off unchanged: a 409 tool failure files feedback while the flag is off', async () => {
  const filed = await fail({ enabled: false }, withStatus(409))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 409)
})

test('flag lookup failure keeps filing a 409 report', async () => {
  const filed = await fail({ flagError: true }, withStatus(409))
  assert.equal(filed.length, 1)
})

test('a 404 tool failure still files feedback', async () => {
  const filed = await fail({}, withStatus(404))
  assert.equal(filed.length, 1)
})
