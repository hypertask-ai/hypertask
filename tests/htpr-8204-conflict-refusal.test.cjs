const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { loader } = require('./htpr-6927-fixtures.cjs')

const { normalizeTaskInput } = load('src/lib/mcp-server/utils/normalize-task-input.ts', {})

function setup() {
  const filed = [], pending = []
  const loadModule = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/flags': { isFeatureEnabled: async () => true },
    './report': { fileAiFeedback: async (input) => { filed.push(input) } },
    './callerFixable': { callerCanFixRefusal: () => false, quietFixableReports: async () => false },
  })
  return { filed, pending, observeFeedbackTools: loadModule('src/lib/aiFeedback/automatic.ts').observeFeedbackTools }
}

test('a conflicting id and task_id answers an input refusal, not a server error', async () => {
  const { filed, pending, observeFeedbackTools } = setup()
  const [tool] = observeFeedbackTools([{
    name: 'hypertask_comments',
    execute: async () => { normalizeTaskInput({ id: 42, task_id: 43 }) },
  }], 42)
  await assert.rejects(tool.execute({}, 'token'), { name: 'ZodError' })
  await Promise.all(pending)
  assert.equal(filed.length, 1)
  assert.deepEqual(filed[0], {
    surface: 'mcp', tool: 'hypertask_comments', status: 400, errorCode: 'custom', field: 'task_id', category: 'call_failed',
  })
})
