const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})

const {
  WEBHOOK_EVENT_DEFINITIONS,
  WEBHOOK_EVENTS,
  createWebhookEnvelope,
  isWebhookEvent,
  parseWebhookEventSelection,
} = jiti(path.join(root, 'src/lib/mcp/webhooks/events.ts'))

test('task lifecycle webhook events are subscribable and documented', () => {
  assert.deepEqual(WEBHOOK_EVENTS, [
    'comment.created',
    'task.escalated',
    'task.created',
    'task.assigned',
    'task.updated',
  ])
  assert.deepEqual(Object.keys(WEBHOOK_EVENT_DEFINITIONS), WEBHOOK_EVENTS)
  assert.match(
    WEBHOOK_EVENT_DEFINITIONS['task.assigned'].dataFields['assignee.agentId'],
    /agent id/i
  )
})

test('subscription parsing accepts lifecycle events and removes duplicates', () => {
  assert.deepEqual(
    parseWebhookEventSelection([
      'task.created',
      'task.assigned',
      'task.updated',
      'task.assigned',
    ]),
    {
      ok: true,
      events: ['task.created', 'task.assigned', 'task.updated'],
    }
  )
  assert.equal(isWebhookEvent('task.assigned'), true)
  assert.equal(isWebhookEvent('task.deleted'), false)
})

test('server metadata cannot be replaced by extra delivery properties', () => {
  const envelope = createWebhookEnvelope(
    {
      event: 'ping',
      data: {
        projectId: 15,
        message: 'test',
        internalSecret: 'must-not-leak',
      },
      id: 'caller-controlled',
      deliveredAt: 'caller-controlled',
      internalSecret: 'must-not-leak',
    },
    {
      id: 'server-generated',
      deliveredAt: '2026-08-08T10:00:00.000Z',
    }
  )

  assert.equal(envelope.id, 'server-generated')
  assert.equal(envelope.deliveredAt, '2026-08-08T10:00:00.000Z')
  assert.equal('internalSecret' in envelope, false)
  assert.equal('internalSecret' in envelope.data, false)
})

test('task delivery payloads are rebuilt from public fields', () => {
  const envelope = createWebhookEnvelope(
    {
      event: 'task.assigned',
      data: {
        task: {
          id: 5168,
          ticketNumber: 'HTPR-5168',
          projectId: 15,
          title: 'Webhook contracts',
          privateNotes: 'must-not-leak',
        },
        action: 'assigned',
        assignee: {
          userId: 6,
          agentId: 'agent-1',
          ownerEmail: 'must-not-leak',
        },
        actor: {
          userId: 6,
          agentId: null,
          token: 'must-not-leak',
        },
        internalSecret: 'must-not-leak',
      },
    },
    {
      id: 'server-generated',
      deliveredAt: '2026-08-08T10:00:00.000Z',
    }
  )

  assert.deepEqual(envelope.data, {
    task: {
      id: 5168,
      ticketNumber: 'HTPR-5168',
      projectId: 15,
      title: 'Webhook contracts',
    },
    action: 'assigned',
    assignee: { userId: 6, agentId: 'agent-1' },
    actor: { userId: 6, agentId: null },
  })
})

test('omitted subscriptions mean all events and invalid selections fail clearly', () => {
  assert.deepEqual(parseWebhookEventSelection(undefined), { ok: true, events: [] })
  assert.deepEqual(parseWebhookEventSelection([]), { ok: true, events: [] })
  assert.deepEqual(parseWebhookEventSelection('task.created'), {
    ok: false,
    error: 'events must be an array of event names',
  })

  const invalid = parseWebhookEventSelection(['task.deleted'])
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /task\.created/)
  assert.match(invalid.error, /task\.assigned/)
  assert.match(invalid.error, /task\.updated/)

  assert.equal(parseWebhookEventSelection([undefined]).ok, false)
})

test('the MCP webhook route uses shared parsing and returns event definitions', () => {
  const route = fs.readFileSync(
    path.join(root, 'src/app/api/mcp/webhooks/route.ts'),
    'utf8'
  )

  assert.match(route, /parseWebhookEventSelection\(body\.events\)/)
  assert.match(route, /eventDefinitions: WEBHOOK_EVENT_DEFINITIONS/)
})
