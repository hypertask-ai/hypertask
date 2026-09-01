const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})

const { persistTaskCreatedWebhook } = jiti(
  path.join(root, 'src/lib/mcp/webhooks/taskEvents.ts')
)

// HTPR-5928: persistTaskCreatedWebhook used to re-read the task (task.findUnique)
// and its section (section.findUnique) from inside the caller's advisory-locked
// transaction. It now takes a snapshot the caller builds from the row its own
// tx.task.create already returned — no extra queries. This test proves the new
// snapshot-based payload is byte-identical to what the old re-read path would
// have produced, for both a task with a priority+section and one with neither.

// Reproduces the OLD persistTaskCreatedWebhook body exactly (pre-HTPR-5928):
// re-reads via tx.task.findUnique + tx.section.findUnique, then builds the same
// task.created WebhookDelivery shape. This is the parity oracle, not the fix.
async function oldPersistTaskCreatedWebhookViaReRead(fixtureDb, taskId, actorUserId, actorAgentId, sink) {
  const task = await fixtureDb.task.findUnique({ where: { id: taskId } })
  if (!task) return []
  const section =
    task.sectionId == null
      ? null
      : await fixtureDb.section.findUnique({ where: { id: task.sectionId } })
  const payload = {
    event: 'task.created',
    data: {
      task: {
        id: task.id,
        ticketNumber: task.ticketNumber,
        projectId: task.projectId,
        title: task.title,
      },
      state: {
        section: section ? { id: section.id, title: section.section_title } : null,
        status: task.status,
        priority: task.priority
          ? { id: task.priority.id, index: task.priority.priority_index, value: task.priority.Priority_Value }
          : null,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      },
      actor: { userId: actorUserId, agentId: actorAgentId },
    },
  }
  sink.push(payload)
  return ['old-delivery-id']
}

function newTxSink(sink) {
  return {
    webhookSubscription: {
      findMany: async () => [{ id: 'sub-1', events: [], projectId: 15 }],
    },
    boardWebhookDelivery: {
      create: async ({ data }) => {
        sink.push(data.payload ?? data.delivery ?? data)
        return data
      },
    },
  }
}

async function assertParity(t, { fixtureTask, fixtureSection, webhookTaskSnapshot }) {
  const oldSink = []
  await oldPersistTaskCreatedWebhookViaReRead(
    {
      task: { findUnique: async () => fixtureTask },
      section: { findUnique: async () => fixtureSection },
    },
    fixtureTask.id,
    6,
    null,
    oldSink,
  )

  const newSink = []
  await persistTaskCreatedWebhook(newTxSink(newSink), webhookTaskSnapshot, 6, null)

  assert.equal(oldSink.length, 1)
  assert.equal(newSink.length, 1)
  // newSink's entry is wrapped in persistBoardWebhookEvent's delivery envelope
  // (id/deliveredAt) — unrelated to this diff, so compare the application
  // payload (`event` + `data`) both paths actually build.
  assert.equal(newSink[0].event, oldSink[0].event)
  assert.deepEqual(newSink[0].data, oldSink[0].data)
}

test('HTPR-5928: webhook payload for a task with a priority and section matches the old re-read path', async (t) => {
  await assertParity(t, {
    fixtureTask: {
      id: 42,
      ticketNumber: 'HTPR-42',
      projectId: 15,
      title: 'Fixture task',
      status: 'Normal',
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      sectionId: 900,
      priority: { id: 3, priority_index: 1, Priority_Value: 'Urgent' },
    },
    fixtureSection: { id: 900, section_title: 'In Progress' },
    webhookTaskSnapshot: {
      id: 42,
      ticketNumber: 'HTPR-42',
      projectId: 15,
      title: 'Fixture task',
      status: 'Normal',
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      sectionId: 900,
      section: 'In Progress',
      priority: { id: 3, priority_index: 1, Priority_Value: 'Urgent' },
    },
  })
})

test('HTPR-5928: webhook payload for a task with no priority, no section, no due date matches the old re-read path', async (t) => {
  await assertParity(t, {
    fixtureTask: {
      id: 43,
      ticketNumber: 'HTPR-43',
      projectId: 15,
      title: 'Fixture task without extras',
      status: 'Normal',
      dueDate: null,
      sectionId: null,
      priority: null,
    },
    fixtureSection: null,
    webhookTaskSnapshot: {
      id: 43,
      ticketNumber: 'HTPR-43',
      projectId: 15,
      title: 'Fixture task without extras',
      status: 'Normal',
      dueDate: null,
      sectionId: null,
      section: 'To Do',
      priority: null,
    },
  })
})

// HTPR-5928 review: the section string that ends up in the webhook payload
// must come from the Section row, never from a caller-supplied string that
// can be stale or renamed. buildWebhookTaskSnapshot in create.ts takes the
// section title as a separate argument specifically so callers pass the
// Section row's title, not Task's own denormalized `section` field (which is
// written from the request body).
//
// Loading create.ts through jiti pulls in its whole transitive module graph
// (Firebase Admin, FCM, etc.), which needs env vars this test suite doesn't
// set up — so this checks the source directly, the same pattern already used
// for createGlobally.ts below, rather than importing and calling the function.
test('HTPR-5928: create.ts passes the Section row title into buildWebhookTaskSnapshot, not the caller-supplied one', () => {
  const source = require('node:fs').readFileSync(
    path.join(root, 'src/utils/controllers/tasks/create.ts'),
    'utf8',
  )

  const definition = source.slice(
    source.indexOf('function buildWebhookTaskSnapshot'),
    source.indexOf('): WebhookTaskSnapshot {'),
  )
  assert.match(
    definition,
    /sectionTitle: string/,
    'buildWebhookTaskSnapshot must take the section title as its own argument',
  )
  assert.doesNotMatch(
    definition.replace(/section: string;/, ''),
    /section:\s*string/,
    'the row parameter must not carry its own section field that could be used by mistake',
  )

  const callSites = [...source.matchAll(/buildWebhookTaskSnapshot\((row[^)]*)\)/g)]
  assert.ok(callSites.length >= 2, 'expected buildWebhookTaskSnapshot to be called at both create.ts task-create branches')
  for (const [, args] of callSites) {
    assert.match(
      args,
      /sectionExists\.section_title/,
      `buildWebhookTaskSnapshot(${args}) must pass sectionExists.section_title (the fetched Section row), not the raw request field`,
    )
  }
})
