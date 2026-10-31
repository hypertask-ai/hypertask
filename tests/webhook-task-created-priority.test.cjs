const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})

const { persistTaskCreatedWebhook } = jiti(
  path.join(root, 'src/lib/mcp/webhooks/taskEvents.ts')
)

function txWithPriority(priority) {
  const created = []
  return {
    created,
    task: {
      id: 7,
      ticketNumber: 'HTPR-7',
      projectId: 15,
      title: 'Created with a priority',
      status: 'Normal',
      dueDate: null,
      startDate: null,
      sectionId: null,
      section: 'To Do',
      priority,
    },
    tx: {
      webhookSubscription: {
        findMany: async () => [
          { id: 'sub-1', events: ['task.created'], projectId: 15 },
        ],
      },
      boardWebhookDelivery: {
        create: async ({ data }) => {
          created.push(data)
          return data
        },
      },
    },
  }
}

test('task.created carries the priority the task was created with', async () => {
  const { tx, task, created } = txWithPriority({
    id: 99,
    priority_index: 1,
    Priority_Value: 'Urgent',
  })
  await persistTaskCreatedWebhook(tx, task, 6, null)
  assert.equal(created.length, 1)
  const payload = created[0].payload ?? created[0].delivery ?? created[0]
  const body = JSON.stringify(payload)
  assert.match(body, /"priority":\{"id":99,"index":1,"value":"Urgent"\}/)
})

test('task.created reports no priority when the task was created without one', async () => {
  const { tx, task, created } = txWithPriority(null)
  await persistTaskCreatedWebhook(tx, task, 6, null)
  const body = JSON.stringify(created[0])
  assert.match(body, /"priority":null/)
})

test('the global create path writes the priority inside the creation transaction', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/api/task-writes/create-global.ts'),
    'utf8'
  )
  const transactionWrapper = source.indexOf(
    'createTaskWithBoardWebhookOutbox('
  )
  const priorityWrite = source.indexOf('tx.priority.create', transactionWrapper)
  const transactionResult = source.indexOf('taskId: task.id', priorityWrite)
  assert.ok(transactionWrapper > 0, 'the creation outbox wrapper is missing')
  assert.ok(priorityWrite > 0, 'priority is no longer created through the tx client')
  assert.ok(
    priorityWrite < transactionResult,
    'the priority must exist before the task.created payload is frozen'
  )
  assert.ok(
    !/prisma\.priority\.create/.test(source),
    'priority creation must not run outside the creation transaction'
  )
})

test('the global create path builds the webhook section title from a fetched Section row', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/api/task-writes/create-global.ts'),
    'utf8'
  )
  const webhookTaskBlock = source.slice(
    source.indexOf('webhookTask: {'),
    source.indexOf('},', source.indexOf('webhookTask: {')),
  )
  assert.match(
    webhookTaskBlock,
    /section:\s*sectionRow\??\.\s*section_title/,
    'webhookTask.section must come from sectionRow, not the raw request body field',
  )
  assert.doesNotMatch(
    webhookTaskBlock,
    /section:\s*task\.section\s*,/,
    'webhookTask.section must not read Task\'s own denormalized (client-supplied) section field',
  )
})
