const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { z } = require('zod')
const { loader } = require('./htpr-6927-fixtures.cjs')

const keyShaped = (prefix, rest) => [prefix, rest].join('_')
const htkFixture = keyShaped('htk', 'secret123')
const vckFixture = keyShaped('vck', 'secret123')
const mixedFixture = keyShaped('abc', ['x7Yz', '9QwE'].join(''))
const privateArgs = { project_id: 'private-project-value', title: 'private-title-value', token: keyShaped('htk', 'private123') }

function setup({ plain = true } = {}) {
  const created = [], reports = [], pending = [], comments = []
  const reportModule = {}
  const db = {
    section: { findMany: async () => [] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ displayName: 'Robin' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => created.find(row => row.description.includes(where.description_.is.content.contains)) ?? null },
    comment: {
      findFirst: async ({ where }) => comments.find(row => row.taskId === where.taskId && row.text.includes(where.text.contains)) ?? null,
      update: async ({ where, data }) => Object.assign(comments.find(row => row.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async run => run(db),
  }
  const load = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/prisma': { __esModule: true, default: db },
    './enabled': { aiFeedbackEnabled: async () => true },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
    '@/lib/flags': { isFeatureEnabled: async () => plain },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async options => {
      const task = { ...options, id: created.length + 1, ticketNumber: `HTPR-${8001 + created.length}`, uniqueIndex: 8001 + created.length }
      created.push(task)
      return { task }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async options => {
      const comment = { ...options, id: comments.length + 1 }
      comments.push(comment)
      return comment
    } },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
    '@/lib/mcp/directOperationClient': { createDirectOperationClient: () => ({}) },
    '@/lib/mcp/operationContext': { getMcpExecutionContext: () => ({ user: { id: 42 }, agentDisplayName: 'Fable' }), withMcpExecutionContext: (t, a, fn) => fn() },
    '@/lib/aiFeedback/clientInfo': { getFeedbackClient: async () => undefined },
    '../config/tool-metadata': { TOOL_METADATA: { REPORT_FEEDBACK: { name: 'hypertask_report_feedback' } } },
    '../config/tool-annotations': { TOOL_ANNOTATIONS: { hypertask_report_feedback: {} } },
    './report': reportModule,
    '@/lib/aiFeedback/report': reportModule,
  })
  const report = load('src/lib/aiFeedback/report.ts')
  Object.assign(reportModule, report, { fileAiFeedback: async (...args) => {
    reports.push(args)
    return report.fileAiFeedback(...args)
  } })
  return { load, created, reports, pending, ...report, ...load('src/lib/aiFeedback/automatic.ts') }
}

async function observe(error, options) {
  const f = setup(options)
  const [tool] = f.observeFeedbackTools([{
    name: 'hypertask_tasks', parameters: z.object({}), execute: async () => { throw error },
  }], 42)
  await assert.rejects(tool.execute(privateArgs, 'private-auth-token'), original => original === error)
  await Promise.all(f.pending)
  assert.equal(f.created.length, 1)
  assert.equal(f.reports.length, 1)
  assert.equal(f.reports[0][1], 42)
  assert.deepEqual(f.reports[0][2], { origin: 'automatic' })
  const filed = JSON.stringify(f.created)
  for (const secret of [...Object.values(privateArgs), 'private-auth-token', 'private-error-message']) assert.equal(filed.includes(secret), false, secret)
  return { ...f, input: f.reports[0][0], description: f.created[0].description }
}

for (const plain of [false, true]) {
  test(`automatic first Zod invalid_type keeps project_id and renders both engineer fields (plain=${plain})`, async () => {
    const result = z.object({ project_id: z.number(), title: z.number() }).safeParse(privateArgs)
    assert.equal(result.success, false)
    const f = await observe(result.error, { plain })
    assert.deepEqual(f.input, {
      surface: 'mcp', tool: 'hypertask_tasks', status: 400, errorCode: 'invalid_type', field: 'project_id', category: 'call_failed',
    })
    assert.match(f.description, /<p>Error code: invalid_type<\/p><p>Field: project_id<\/p>/)
    assert.equal(f.description.includes('<h2>Details for engineers</h2>'), plain)
  })
}

test('automatic nested Zod issue preserves tasks.0.title without its input value or message', async () => {
  const result = z.object({ tasks: z.array(z.object({ title: z.string() })) }).safeParse({ tasks: [{ title: 12 }] })
  const f = await observe(result.error)
  assert.equal(f.input.errorCode, 'invalid_type')
  assert.equal(f.input.field, 'tasks.0.title')
  assert.match(f.description, /Field: tasks\.0\.title/)
  assert.equal(f.description.includes(result.error.issues[0].message), false)
})

test('automatic Zod too_small and unrecognized_keys keep only the first issue code and refused key', async () => {
  for (const [schema, args, code, field] of [
    [z.object({ title: z.string().min(2) }), { title: '' }, 'too_small', 'title'],
    [z.object({}).strict(), { project_id: 'private-project-value', title: 'private-title-value' }, 'unrecognized_keys', 'project_id'],
  ]) {
    const result = schema.safeParse(args)
    const f = await observe(result.error)
    assert.equal(f.input.errorCode, code)
    assert.equal(f.input.field, field)
  }
})

test('automatic root Zod issues keep their code without inventing a field', async () => {
  const result = z.number().safeParse('private-project-value')
  const f = await observe(result.error)
  assert.equal(f.input.errorCode, 'invalid_type')
  assert.equal(f.input.field, undefined)
  assert.doesNotMatch(f.description, /<p>Field:/)
})

for (const [name, wrap] of [
  ['root', details => ({ details })],
  ['data', details => ({ data: { details } })],
  ['error', details => ({ error: { details } })],
  ['details', details => ({ details: { details } })],
  ['mixed depth three', details => ({ data: { error: { details: { details } } } })],
]) {
  test(`automatic structured details at ${name} keep field and code, never messages`, async () => {
    const error = Object.assign(new Error('private-error-message'), { status: 400 }, wrap({ field: 'project_id', code: 'invalid_type', message: 'private-error-message', value: privateArgs }))
    const f = await observe(error)
    assert.equal(f.input.status, 400)
    assert.equal(f.input.errorCode, 'invalid_type')
    assert.equal(f.input.field, 'project_id')
    assert.match(f.description, /Error code: invalid_type<\/p><p>Field: project_id/)
  })
}

test('automatic structured details traversal stops at depth four and terminates on cycles', async () => {
  const cyclic = { status: 400 }
  cyclic.data = cyclic
  const deep = { status: 400, data: { data: { data: { data: { details: { field: 'project_id', code: 'invalid_type' } } } } } }
  for (const error of [deep, cyclic]) {
    const f = await observe(error)
    assert.equal(f.input.errorCode, 'tool-exception')
    assert.equal(f.input.field, undefined)
  }
})

const unsafeFields = [
  htkFixture, vckFixture, mixedFixture, ['eyJ', 'payload'].join(''), 'Bearer', 'title.private123456',
  'private field value', 'user@example.test', 'tasks[0].title', '0.title', 'a.b.c.d.e.f',
  Array(5).fill('a'.repeat(16)).join('.'), 42, { title: 'private-title-value' },
]
const unsafeCodes = [htkFixture, mixedFixture, 'Bearer', 'private error message', 'a'.repeat(41), 42]

for (const [name, details] of [
  ...unsafeFields.map(field => [`field ${JSON.stringify(field)}`, { field, code: 'invalid_type' }]),
  ...unsafeCodes.map(code => [`code ${JSON.stringify(code)}`, { field: 'project_id', code }]),
]) {
  test(`automatic unsafe ${name} falls back to tool-exception with no field`, async () => {
    const f = await observe({ status: 400, details })
    assert.equal(f.input.errorCode, 'tool-exception')
    assert.equal(f.input.field, undefined)
    assert.doesNotMatch(f.description, /<p>Field:/)
  })
}

test('automatic credential-shaped and free-text Zod paths never enter the filed report', async () => {
  for (const field of [htkFixture, 'private field value']) {
    const result = z.object({ [field]: z.number() }).safeParse({ [field]: privateArgs.title })
    const f = await observe(result.error)
    assert.equal(f.input.errorCode, 'tool-exception')
    assert.equal(f.input.field, undefined)
    assert.equal(f.description.includes(field), false)
  }
})

test('automatic unstructured errors and hostile details getters keep the original error and fallback metadata', async () => {
  const hostile = new Error('private-error-message')
  Object.defineProperty(hostile, 'details', { get() { throw new Error('private-error-message') } })
  for (const error of [new Error('private-error-message'), hostile]) {
    const f = await observe(error)
    assert.equal(f.input.status, 500)
    assert.equal(f.input.errorCode, 'tool-exception')
    assert.equal(f.input.field, undefined)
  }
})

test('automatic field schema permits bounded schema paths and queue sanitation drops unsafe fields', async () => {
  const f = setup()
  const { automaticFeedbackSchema } = f.load('src/lib/aiFeedback/input.ts')
  const base = { surface: 'mcp', tool: 'hypertask_tasks', status: 500, errorCode: 'tool-exception' }
  for (const field of ['project_id', 'tasks.0.title', '_input.item_2', Array(4).fill('a'.repeat(15)).concat('b'.repeat(16)).join('.')]) {
    assert.equal(automaticFeedbackSchema.safeParse({ ...base, field }).success, true, field)
  }
  for (const field of unsafeFields) assert.equal(automaticFeedbackSchema.safeParse({ ...base, field }).success, false, JSON.stringify(field))
  f.queueAiFeedback({ ...base, field: 'private field value' }, 42)
  await Promise.all(f.pending)
  assert.equal(f.created.length, 1)
  assert.equal(f.reports[0][0].field, undefined)
  assert.doesNotMatch(f.created[0].description, /<p>Field:|private field value/)
})

test('fingerprints without field preserve the exact legacy hash and fields distinguish refused parameters', () => {
  const { feedbackFingerprint } = setup().load('src/lib/aiFeedback/input.ts')
  for (const [input, legacy] of [
    [{ surface: 'mcp', tool: 'Hypertask_TASKS', status: 400, errorCode: 'INVALID_TYPE', category: 'call_failed' }, 'mcp|hypertask_tasks|400|invalid_type|call_failed'],
    [{ surface: 'api' }, 'api||||other'],
    [{ surface: 'cli', category: 'call_failed' }, 'cli||||call_failed'],
  ]) {
    const expected = createHash('sha256').update(legacy).digest('hex')
    assert.equal(feedbackFingerprint(input), expected)
    assert.equal(feedbackFingerprint({ ...input, field: undefined }), expected)
    assert.notEqual(feedbackFingerprint({ ...input, field: 'project_id' }), expected)
    assert.notEqual(feedbackFingerprint({ ...input, field: 'project_id' }), feedbackFingerprint({ ...input, field: 'title' }))
    assert.equal(feedbackFingerprint({ ...input, field: 'PROJECT_ID' }), feedbackFingerprint({ ...input, field: 'project_id' }))
  }
})

test('automatic reports without field still tally the same open legacy fingerprint', async () => {
  const f = setup()
  const base = { surface: 'mcp', tool: 'hypertask_tasks', status: 400, errorCode: 'tool-exception', category: 'call_failed' }
  const legacy = await f.fileAiFeedback(base, 42, { origin: 'automatic' })
  const repeated = await f.fileAiFeedback(base, 42, { origin: 'automatic' })
  assert.equal(f.created.length, 1)
  assert.equal(repeated.ticketNumber, legacy.ticketNumber)
  assert.equal(repeated.deduped, true)
  assert.equal(repeated.count, 2)
  const distinct = await f.fileAiFeedback({ ...base, field: 'project_id' }, 42, { origin: 'automatic' })
  assert.equal(f.created.length, 2)
  assert.equal(distinct.deduped, false)
  assert.notEqual(distinct.ticketNumber, legacy.ticketNumber)
})

test('public feedback schema and hypertask_report_feedback still reject unknown field exactly as before', async () => {
  const f = setup()
  const { aiFeedbackSchema } = f.load('src/lib/aiFeedback/input.ts')
  const { reportFeedbackTool } = f.load('src/lib/mcp-server/tools/report-feedback.tool.ts')
  assert.equal(Object.hasOwn(aiFeedbackSchema.shape, 'field'), false)
  assert.equal(Object.hasOwn(reportFeedbackTool.parameters.shape, 'field'), false)
  const result = reportFeedbackTool.parameters.safeParse({ status: 500, field: 'project_id' })
  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].code, 'unrecognized_keys')
  assert.deepEqual(result.error.issues[0].keys, ['field'])
  await assert.rejects(reportFeedbackTool.execute({ status: 500, field: 'project_id' }, 'fixture'), z.ZodError)
  await assert.rejects(f.fileAiFeedback({ surface: 'mcp', status: 500, field: 'project_id' }, 42, { origin: 'agent' }), error => error.status === 400)
  assert.equal(f.created.length, 0)
})

test('public hypertask_report_feedback keeps allowed server errors and refused access reports unchanged', async t => {
  t.mock.method(console, 'info', () => {})
  const f = setup()
  const { reportFeedbackTool } = f.load('src/lib/mcp-server/tools/report-feedback.tool.ts')
  const allowed = JSON.parse(await reportFeedbackTool.execute({ status: 500 }, 'fixture'))
  assert.equal(allowed.success, true)
  assert.equal(f.created.length, 1)
  const refused = JSON.parse(await reportFeedbackTool.execute({ status: 401, errorCode: 'unauthorized' }, 'fixture'))
  assert.deepEqual(refused, { success: false, filed: false, reason: 'access_refused', error: 'Normal access refusal; no new ticket was filed.' })
  assert.equal(f.created.length, 1)
})

test('automatic REST reporting still ignores 400 responses and reports only server failures', async () => {
  const f = setup()
  const request = new Request('https://app.hypertask.ai/api/mcp/tasks')
  f.queueRestFailure(request, 400, { user: { id: 42 } })
  assert.equal(f.pending.length, 0)
  f.queueRestFailure(request, 500, { user: { id: 42 } })
  await Promise.all(f.pending)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /Error code: http-server-error/)
  assert.doesNotMatch(f.created[0].description, /<p>Field:/)
})

test('automatic input refusals open no ticket and server errors still file', async t => {
  t.mock.method(console, 'info', () => {})
  const f = setup()
  const refusal = { surface: 'mcp', tool: 'hypertask_tasks', status: 400, errorCode: 'unrecognized_keys', field: 'nonsense_field', category: 'call_failed' }
  const result = await f.fileAiFeedback(refusal, 42, { origin: 'automatic' })
  assert.deepEqual(result, { success: false, filed: false, reason: 'input_refused', error: 'Tool input refusal; no new ticket was filed.' })
  assert.equal(f.created.length, 0)
  const serverError = { surface: 'mcp', tool: 'hypertask_tasks', status: 500, errorCode: 'tool-exception', category: 'call_failed' }
  const filed = await f.fileAiFeedback(serverError, 42, { origin: 'automatic' })
  assert.equal(filed.success, true)
  assert.equal(f.created.length, 1)
})
