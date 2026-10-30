const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')

const { AuthorizationError, ValidationError } = loader({})('src/lib/mcp-server/utils/errors.ts')

function feedbackSetup({ quiet = true } = {}) {
  const filed = [], pending = []
  const load = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/flags': { isFeatureEnabled: async key => quiet && key === 'htpr-7941-quiet-fixable-reports' },
    './report': { fileAiFeedback: async input => { filed.push(input) } },
  })
  return { filed, pending, observeFeedbackTools: load('src/lib/aiFeedback/automatic.ts').observeFeedbackTools }
}

async function report(setup, error) {
  const [tool] = setup.observeFeedbackTools([{ name: 'hypertask_projects', execute: async () => { throw error } }], 42)
  await assert.rejects(tool.execute({}, 'token'), thrown => thrown === error)
  await Promise.all(setup.pending)
  return setup.filed
}

const unsupportedAsAgent = () => new ValidationError(
  'as_agent is not supported on hypertask_projects list; send the call without as_agent.',
  { code: 'invalid_value', field: 'input.as_agent' },
)

test('an unsupported as_agent value files no bug ticket', async () => {
  assert.deepEqual(await report(feedbackSetup(), unsupportedAsAgent()), [])
})

test('a permission refusal files no bug ticket', async () => {
  assert.deepEqual(await report(feedbackSetup({ quiet: false }), new AuthorizationError('This action is not allowed by this credential.')), [])
})

test('an as_agent refusal is never reported as a Hypertask server error', async () => {
  const filed = await report(feedbackSetup({ quiet: false }), unsupportedAsAgent())
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 400)
  assert.equal(filed[0].errorCode, 'invalid_value')
  assert.equal(filed[0].field, 'input.as_agent')
  assert.equal(filed[0].category, 'call_failed')
})

test('an unavailable action is reported as a refusal, not as a server error', async () => {
  const filed = await report(feedbackSetup({ quiet: false }), new ValidationError('This action is unavailable. Refresh the tool catalog before retrying.'))
  assert.equal(filed.length, 1)
  assert.equal(filed[0].status, 400)
  assert.equal(filed[0].errorCode, 'tool-exception')
})
