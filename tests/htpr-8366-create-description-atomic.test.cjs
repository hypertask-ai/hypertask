const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const verbose = '<p>This deliberately long sentence contains far too many words for a brief update that people can scan easily.</p>'
const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

function harness() {
  const calls = { transactions: 0, descriptions: [], joinedTransaction: [] }
  const transaction = { scope: 'task-create-transaction' }
  const createdRow = {
    id: 42,
    ticketNumber: 'QA-1',
    projectId: 15,
    title: 'Saved views stay put',
    status: 'Normal',
    dueDate: null,
    startDate: null,
    sectionId: 1,
    section: 'Todo',
    priority: null,
    project: { teamId: null, firstTaskPointerTaskId: null },
  }
  const writeTask = async (db, actor, createTask) => {
    calls.transactions += 1
    const created = await createTask(transaction)
    return { result: created.result, boardWebhookDeliveryIds: [] }
  }
  const stubs = {
    '@/lib/prisma': {
      default: {
        $transaction: async (run) => run({ task: { create: async ({ data }) => ({ ...createdRow, ...data }) } }),
        task: { findFirst: async () => null },
        team_Activity: { update: async () => {} },
        drafts: { create: async () => {} },
      },
    },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@vercel/functions': { waitUntil: () => {} },
    './create': { getUniqueTaskCount: async () => 0 },
    '@/utils/generateRank': { default: () => 'A1' },
    '@/utils/controllers/description/common-description-create': {
      default: async (data, joined) => {
        calls.descriptions.push(data)
        calls.joinedTransaction.push(joined === transaction)
        return { id: 'description-1', taskId: data.taskId, content: data.content }
      },
    },
    '@/lib/constants/constants': { PriorityConstants: [], EstimateConstants: [] },
    '@/utils/controllers/assignees/autoAssignForSection': { autoAssignForSection: async () => 'ready' },
    '@/lib/mcp/webhooks/taskEvents': {
      createTaskWithBoardWebhookOutbox: writeTask,
      createProvisionedTaskWithBoardWebhookOutbox: writeTask,
    },
    '@/lib/mcp/webhooks/outbox': { publishBoardWebhookDeliveries: async () => {} },
    '@/lib/agentWebhooks/outbox': {
      emitAgentTaskCreatedWebhook: async () => {},
      markAgentTaskCreatedReady: async () => {},
      persistAgentTaskCreatedPending: async () => {},
    },
    '@/lib/agents/writingEnforcement': {
      enforceAgentWriting: async (userId, agentId, fields) => assertAgentWriting(agentId, fields),
    },
  }
  const { createTaskCore } = load('src/utils/controllers/tasks/createTaskCore.ts', stubs)
  const options = {
    title: 'Saved views stay put',
    description: '<p>Saved views stay unchanged.</p>',
    userId: 6,
    actingAgentId: 'agent',
    creationChannel: 'agent',
    projectId: 15,
    sectionId: 1,
    sectionTitle: 'Todo',
    projectIdentifier: 'QA',
  }
  return { calls, create: (body) => createTaskCore({ ...options, ...body }) }
}

test('a refused description starts no task write and writes no description', async () => {
  const h = harness()
  await assert.rejects(
    h.create({ description: verbose }),
    (error) => error.field === 'description' && error.status === 400 && /twelve words/.test(error.message),
  )
  assert.equal(h.calls.transactions, 0, 'the task write must not start')
  assert.equal(h.calls.descriptions.length, 0, 'the description must not be written')
})

test('the description is written in the task transaction, so a refusal rolls the task back', async () => {
  const h = harness()
  const { task, description } = await h.create({})
  assert.equal(h.calls.transactions, 1)
  assert.deepEqual(h.calls.joinedTransaction, [true], 'the description write must join the task transaction')
  assert.equal(h.calls.descriptions[0].taskId, 42)
  assert.equal(task.id, 42)
  assert.equal(description.content, '<p>Saved views stay unchanged.</p>')
})
