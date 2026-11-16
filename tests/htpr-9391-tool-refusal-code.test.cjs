const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-9391-tool-refusal-code'
const { AuthenticationError } = loader({})('src/lib/mcp-server/utils/errors.ts')

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
  const [tool] = f.observeFeedbackTools([{ name: 'hypertask_user_context', execute: async () => { throw error } }], 42)
  await assert.rejects(tool.execute({}, 'token'), (thrown) => thrown === error)
  await Promise.all(f.pending)
  return f.filed
}

const withStatus = (status) => Object.assign(new Error('request failed'), { status })

test('flag is a bug fix on for everyone', () => {
  const definition = loader({})(`src/lib/flags/definitions/${flag}.ts`).default
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('a refused credential inside a tool is reported as unauthorized, not as a tool exception', async () => {
  const filed = await fail({}, new AuthenticationError('Invalid or missing authentication token.'))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 401)
  assert.equal(filed[0].errorCode, 'unauthorized')
  assert.equal(filed[0].category, 'auth_failed')
  assert.equal(filed[0].tool, 'hypertask_user_context')
})

test('flag off keeps the tool-exception code', async () => {
  const filed = await fail({ enabled: false }, new AuthenticationError('Invalid or missing authentication token.'))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 401)
  assert.equal(filed[0].errorCode, 'tool-exception')
})

test('flag lookup failure keeps the tool-exception code', async () => {
  const filed = await fail({ flagError: true }, new AuthenticationError('Invalid or missing authentication token.'))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].errorCode, 'tool-exception')
})

test('a server error keeps the tool-exception code and the 500 status', async () => {
  const filed = await fail({}, withStatus(500))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 500)
  assert.equal(filed[0].errorCode, 'tool-exception')
})

test('a field refusal keeps its own code and field', async () => {
  const error = Object.assign(new Error('request failed'), { status: 400, details: { code: 'invalid_field', field: 'description' } })
  const filed = await fail({}, error)
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 400)
  assert.equal(filed[0].errorCode, 'invalid_field')
  assert.equal(filed[0].field, 'description')
})
