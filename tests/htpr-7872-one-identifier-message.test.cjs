const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const shared = load('src/lib/mcp-server/validations/common/task-identification.ts', {})
const tasks = load('src/lib/mcp-server/validations/task.validation.ts', {})
const inbox = load('src/lib/mcp-server/validations/inbox.validation.ts', {})
const pages = load('src/lib/mcp-server/validations/page.validation.ts', {})

function messages(schema, input) {
  const parsed = schema.safeParse(input)
  assert.equal(parsed.success, false)
  return parsed.error.issues.map((issue) => issue.message)
}

const missing = 'Either task_id, ticket_number, or (project_id + unique_index) must be provided'
const multiple = /^Cannot provide multiple/

const schemas = [
  ['shared single', shared.createTaskIdentificationSchema(), {}],
  ['shared array', shared.createTaskIdentificationArraySchema(), {}],
  ['assign', tasks.getAssignUserInputSchema(), { user_id: 6 }],
  ['get', tasks.getGetTasksInputSchema(), {}],
  ['update', tasks.getUpdateTaskInputSchema(), { title: 'Updated' }],
  ['move', tasks.getMoveTaskBetweenBoardsInputSchema(), { target_project_id: 16 }],
  ['inbox move', inbox.getMoveTaskToInboxInputSchema(), { user_id: 6 }],
]

for (const [name, schema, extra] of schemas) {
  test(`${name}: a missing identifier reads as missing, never as more than one`, () => {
    const found = messages(schema, { ...extra })
    assert.ok(found.includes(missing), `expected the missing-identifier message in ${JSON.stringify(found)}`)
    assert.equal(found.filter((message) => multiple.test(message)).length, 0, `no multiple-identifier message for empty input: ${JSON.stringify(found)}`)
  })

  test(`${name}: two identifiers still read as more than one`, () => {
    const found = messages(schema, { ...extra, task_id: 1, ticket_number: 'HTPR-1' })
    assert.equal(found.filter((message) => message === missing).length, 0)
    assert.equal(found.filter((message) => multiple.test(message)).length, 1, JSON.stringify(found))
  })
}

test('the link tool keeps its single exactly-one message', () => {
  const found = messages(tasks.getLinkTasksInputSchema(), { action: 'link', relation_type: 'RelatedTo' })
  assert.deepEqual(found, ['Provide exactly one task identifier for the selected action', 'Provide exactly one target task identifier'])
})

test('the page tool keeps its single exactly-one message', () => {
  const found = messages(pages.getCreatePageInputSchema ? pages.getCreatePageInputSchema() : pages.CreatePageInputSchema, { content: '<p>x</p>' })
  assert.deepEqual(found, ['Provide exactly one of task_id, ticket_number, or (project_id + unique_index)'])
})
