import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { persistBoardWebhookEvent } from './outbox'
import type { WebhookDelivery } from './events'
import { WEBHOOK_EVENT_DEFINITIONS } from './events'
import {
  BOARD_WEBHOOK_MAX_ATTEMPTS,
  boardWebhookRetryDelaySeconds,
} from './outboxDelivery'

type Row = {
  id: string
  subscriptionId: string
  event: string
  payload: any
  payloadBody: string
  payloadHash: string
}

function fakeTx(
  subscriptions: Array<{
    id: string
    events: string[]
    supportsUnassignedEvent?: boolean
  }>,
) {
  const rows: Row[] = []
  let lastWhere: any = null
  return {
    rows,
    get lastWhere() {
      return lastWhere
    },
    webhookSubscription: {
      findMany: async ({ where }: any) => {
        lastWhere = where
        const matches = (subscription: (typeof subscriptions)[number], filter: any) => {
          if (filter.events?.isEmpty) return subscription.events.length === 0
          if (filter.events?.has) return subscription.events.includes(filter.events.has)
          if (filter.supportsUnassignedEvent === false) {
            return subscription.supportsUnassignedEvent !== true
          }
          if (filter.AND) {
            return filter.AND.every((part: any) => matches(subscription, part))
          }
          return false
        }
        return subscriptions
          .filter((subscription) =>
            where.AND[0].OR.some((filter: any) => matches(subscription, filter)),
          )
          .map((subscription) => ({
            id: subscription.id,
            supportsUnassignedEvent:
              subscription.supportsUnassignedEvent ?? false,
          }))
      },
    },
    boardWebhookDelivery: {
      create: async ({ data }: any) => {
        rows.push(data)
        return data
      },
    },
  } as any
}

const escalation: WebhookDelivery = {
  event: 'task.escalated',
  data: {
    task: { id: 7, ticketNumber: 'HTPR-7', projectId: 15, title: 'Stuck' },
    reason: 'blocked on infra',
    actor: { userId: 6, agentId: null },
  },
}

test('board webhook outbox writes one durable row per matching subscription', async () => {
  const tx = fakeTx([
    { id: 'sub-all', events: [] },
    { id: 'sub-match', events: ['task.escalated'] },
  ])

  const ids = await persistBoardWebhookEvent(tx, 15, escalation)

  assert.equal(ids.length, 2)
  assert.deepEqual(
    tx.rows.map((row: Row) => row.subscriptionId),
    ['sub-all', 'sub-match']
  )
  // The row id IS the delivery id every retry re-sends.
  assert.deepEqual(
    tx.rows.map((row: Row) => row.id),
    ids
  )
  assert.deepEqual(
    tx.rows.map((row: Row) => row.payload.id),
    ids
  )
  assert.deepEqual(tx.lastWhere.AND[1].OR, [{ projectId: 15 }])
  assert.equal(tx.lastWhere.active, true)
  assert.equal(tx.rows[0].payloadBody, JSON.stringify(tx.rows[0].payload))
  assert.match(tx.rows[0].payloadHash, /^[a-f0-9]{64}$/)
})

test('board webhook outbox skips subscriptions that did not ask for the event', async () => {
  const tx = fakeTx([{ id: 'sub-other', events: ['comment.created'] }])

  const ids = await persistBoardWebhookEvent(tx, 15, escalation)

  assert.deepEqual(ids, [])
  assert.equal(tx.rows.length, 0)
})

test('task.unassigned preserves legacy subscribers without duplicating new ones', async () => {
  const tx = fakeTx([
    { id: 'legacy-all', events: [] },
    { id: 'legacy-assigned', events: ['task.assigned'] },
    { id: 'new-all', events: [], supportsUnassignedEvent: true },
    {
      id: 'new-unassigned',
      events: ['task.assigned', 'task.unassigned'],
      supportsUnassignedEvent: true,
    },
    {
      id: 'new-assigned-only',
      events: ['task.assigned'],
      supportsUnassignedEvent: true,
    },
  ])
  const delivery: WebhookDelivery = {
    event: 'task.unassigned',
    data: {
      task: { id: 7, ticketNumber: 'HTPR-7', projectId: 15, title: 'Stuck' },
      action: 'unassigned',
      assignee: { userId: 6, agentId: null },
      actor: { userId: 6, agentId: null },
    },
  }

  await persistBoardWebhookEvent(tx, 15, delivery)

  assert.deepEqual(
    tx.rows.map((row: Row) => [row.subscriptionId, row.event]),
    [
      ['legacy-all', 'task.assigned'],
      ['legacy-assigned', 'task.assigned'],
      ['new-all', 'task.unassigned'],
      ['new-unassigned', 'task.unassigned'],
    ],
  )
  assert.deepEqual(tx.lastWhere.AND[1].OR, [
    { projectId: 15 },
    {
      projectId: null,
      team: { projects: { some: { id: 15 } } },
    },
  ])
})

test('board webhook payload is the frozen public envelope', async () => {
  const tx = fakeTx([{ id: 'sub-all', events: [] }])

  // Internal fields a caller may carry must never reach the receiver.
  const withExtras = {
    event: 'task.escalated',
    data: {
      task: {
        id: 7,
        ticketNumber: 'HTPR-7',
        projectId: 15,
        title: 'Stuck',
        internalNote: 'must not ship',
      },
      reason: 'blocked on infra',
      actor: { userId: 6, agentId: null },
    },
  } as unknown as WebhookDelivery
  await persistBoardWebhookEvent(tx, 15, withExtras)

  const payload = tx.rows[0].payload
  assert.equal(payload.event, 'task.escalated')
  assert.deepEqual(Object.keys(payload.data.task), [
    'id',
    'ticketNumber',
    'projectId',
    'title',
  ])
  assert.equal(payload.data.reason, 'blocked on infra')
  assert.equal(typeof payload.deliveredAt, 'string')
})

test('board webhook retries use bounded exponential backoff', () => {
  assert.equal(boardWebhookRetryDelaySeconds(1), 30)
  assert.equal(boardWebhookRetryDelaySeconds(2), 2 * 60)
  assert.equal(boardWebhookRetryDelaySeconds(3), 5 * 60)
  assert.equal(boardWebhookRetryDelaySeconds(4), 10 * 60)
  assert.equal(boardWebhookRetryDelaySeconds(5), 30 * 60)
  assert.equal(boardWebhookRetryDelaySeconds(BOARD_WEBHOOK_MAX_ATTEMPTS), null)
})

test('a delivery contract change is visible: task.updated declares no priority', () => {
  // Priority is written from several controllers with no single choke point,
  // so declaring it would advertise an event that never fires (HTPR-4530).
  const fields: Record<string, string | undefined> =
    WEBHOOK_EVENT_DEFINITIONS['task.updated'].dataFields
  assert.equal(fields['changes.priority'], undefined)
  assert.ok(fields['changes.status'])
  assert.ok(fields['changes.dueDate'])
})

test('task.created rows are written through the caller transaction, not the root client', async () => {
  // The whole point of HTPR-4530's rework: if the task row and its event do not
  // share a transaction, a crash between them loses the event with no outbox
  // row left for the sweep to retry.
  const source = readFileSync(
    new URL('./taskEvents.ts', import.meta.url),
    'utf8'
  )
  assert.ok(source.includes('const created = await createTask(tx)'))
  assert.ok(source.includes('persistTaskCreatedWebhook(\n      tx,'))
  // No root-client import means no path that can run outside the caller's tx.
  assert.equal(source.includes("from '@/lib/prisma'"), false)
})
