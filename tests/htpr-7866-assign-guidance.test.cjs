const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const tasks = load('src/lib/mcp-server/validations/task.validation.ts', {})
const description = require('../src/lib/mcp-server/config/descriptions/tasks.json')

test('an empty user_ids list says what to do instead', () => {
  const parsed = tasks.getAssignUserInputSchema().safeParse({ task_id: 1, user_ids: [] })
  assert.equal(parsed.success, false)
  assert.deepEqual(
    parsed.error.issues.map((issue) => issue.message),
    ['user_ids is empty: name at least one user id, or use user_id, agent_id, or assign_self']
  )
})

test('one user id and several user ids both parse', () => {
  const schema = tasks.getAssignUserInputSchema()
  assert.equal(schema.safeParse({ task_id: 1, user_id: 6 }).success, true)
  assert.equal(schema.safeParse({ task_id: 1, user_ids: [6, 7], intent: 'assign' }).success, true)
  assert.equal(schema.safeParse({ ticket_number: 'HTPR-1234', assign_self: true }).success, true)
})

test('the tool publishes worked assign examples that pass its own schema', () => {
  const examples = description.input_examples.filter((example) => example.action === 'assign')
  assert.equal(examples.length, 2)
  for (const example of examples) {
    const parsed = tasks.getAssignUserInputSchema().safeParse(example.input)
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? {} : parsed.error.issues))
  }
  assert.deepEqual(examples.map((example) => Object.keys(example.input).sort()), [
    ['ticket_number', 'user_id'],
    ['intent', 'ticket_number', 'user_ids'],
  ])
})

test('create and update examples are still there', () => {
  const actions = description.input_examples.map((example) => example.action)
  assert.deepEqual(actions.slice(0, 2), ['create', 'update'])
})
