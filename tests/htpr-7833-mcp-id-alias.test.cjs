const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const shared = load('src/lib/mcp-server/validations/common/task-identification.ts', {})
const tasks = load('src/lib/mcp-server/validations/task.validation.ts', {})
const { normalizeTaskInput } = load('src/lib/mcp-server/utils/normalize-task-input.ts', {})
const schemas = [
  ['base', shared.createTaskIdentificationBaseSchema(), {}],
  ['single', shared.createTaskIdentificationSchema(), {}],
  ['array', shared.createTaskIdentificationArraySchema(), {}],
  ['get base', tasks.getGetTasksBaseSchema(), {}],
  ['get', tasks.getGetTasksInputSchema(), {}],
  ['related', tasks.getFindRelatedTasksInputSchema(), {}],
  ['update', tasks.getUpdateTaskInputSchema(), { title: 'Updated' }],
  ['assign', tasks.getAssignUserInputSchema(), { user_id: 7 }],
  ['move', tasks.getMoveTaskBetweenBoardsInputSchema(), { target_project_id: 16 }],
]
const conflictMessage = 'id and task_id must identify the same task when both are provided'

for (const [name, schema, fields] of schemas) {
  test(`${name}: numeric id alone satisfies task identification`, () => {
    const parsed = schema.parse({ ...fields, id: 42 })
    assert.equal(parsed.id, 42)
    const normalized = normalizeTaskInput(parsed)
    assert.equal(normalized.task_id, 42)
    assert.equal(Object.hasOwn(normalized, 'id'), false)
    assert.equal(parsed.id, 42)
  })

  test(`${name}: string id is coerced like task_id`, () => {
    const parsed = schema.parse({ ...fields, id: '42' })
    assert.equal(parsed.id, 42)
    assert.equal(normalizeTaskInput(parsed).task_id, 42)
    for (const id of [0, -1, 1.5, 'invalid']) {
      assert.equal(schema.safeParse({ ...fields, id }).success, false)
    }
  })

  test(`${name}: matching id and task_id pass and id is stripped`, () => {
    const parsed = schema.parse({ ...fields, id: '42', task_id: '42' })
    const normalized = normalizeTaskInput(parsed)
    assert.deepEqual(normalized.task_id, parsed.task_id)
    assert.equal(Object.hasOwn(normalized, 'id'), false)
  })

  test(`${name}: conflicting id and task_id answer a mapped input refusal`, () => {
    const parsed = schema.parse({ ...fields, id: 42, task_id: 43 })
    assert.throws(() => normalizeTaskInput(parsed), (error) => {
      assert.equal(error.name, 'ZodError')
      const [issue] = error.issues
      assert.equal(issue.code, 'custom')
      assert.deepEqual(issue.path, ['task_id'])
      assert.equal(issue.message, conflictMessage)
      return true
    })
  })

  test(`${name}: unknown keys still fail with unrecognized_keys`, () => {
    const parsed = schema.safeParse({ ...fields, id: 42, unexpected: true })
    assert.equal(parsed.success, false)
    assert.ok(parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys' && issue.keys.includes('unexpected')))
  })

  test(`${name}: legacy identifiers and project coercion are unchanged`, () => {
    for (const identifier of [
      { task_id: '42' },
      { ticket_number: 'HTPR-7833' },
      { unique_index: '7833', project_id: '15' },
    ]) {
      const parsed = schema.parse({ ...fields, ...identifier })
      assert.deepEqual(normalizeTaskInput(parsed), parsed)
      if (identifier.project_id) {
        assert.equal(parsed.project_id, 15)
        assert.equal(parsed.unique_index, 7833)
      }
    }
  })
}

test('refined schemas still require exactly one identification method', () => {
  for (const [name, schema, fields] of schemas.filter(([name]) => !['base', 'get base'].includes(name))) {
    for (const identifier of [{}, { project_id: 15 }, { unique_index: 7833 }, { id: 42, ticket_number: 'HTPR-7833' }, { id: 42, project_id: 15, unique_index: 7833 }]) {
      assert.equal(schema.safeParse({ ...fields, ...identifier }).success, false, `${name}: ${JSON.stringify(identifier)}`)
    }
  }
})

test('array task and ticket inputs keep their existing coercion and cardinality', () => {
  const schema = shared.createTaskIdentificationArraySchema()
  assert.deepEqual(schema.parse({ task_id: ['42', 43] }), { task_id: [42, 43] })
  assert.deepEqual(schema.parse({ ticket_number: ['HTPR-7833', 'HTPR-7834'] }), { ticket_number: ['HTPR-7833', 'HTPR-7834'] })
  assert.equal(schema.safeParse({ task_id: [] }).success, false)
  assert.equal(schema.safeParse({ ticket_number: [] }).success, false)
  assert.throws(() => normalizeTaskInput(schema.parse({ id: 42, task_id: [42, 43] })), { message: conflictMessage })
})

test('normalizer accepts raw numeric strings, preserves input, and rejects raw conflicts', () => {
  const input = { id: '42', project_id: '15' }
  assert.deepEqual(normalizeTaskInput(input), { task_id: 42, project_id: 15 })
  assert.deepEqual(input, { id: '42', project_id: '15' })
  assert.deepEqual(normalizeTaskInput({ id: '42', task_id: 42 }), { task_id: 42 })
  assert.throws(() => normalizeTaskInput({ id: '42', task_id: '43' }), { message: conflictMessage })
  assert.deepEqual(normalizeTaskInput({ task_id: '42', unknown: true }), { task_id: 42, unknown: true })
})

test('ticket URL normalization and text-only related lookup remain unchanged', () => {
  assert.deepEqual(normalizeTaskInput({ ticket_number: 'https://app.hypertask.ai/detail/project-15/7833' }), { project_id: 15, unique_index: 7833 })
  assert.deepEqual(tasks.getFindRelatedTasksInputSchema().parse({ text: 'Related work' }), { text: 'Related work' })
})
