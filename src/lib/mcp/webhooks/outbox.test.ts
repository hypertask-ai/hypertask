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

type Row = { id: string; subscriptionId: string; event: string; payload: any }

function fakeTx(subscriptions: Array<{ id: string; events: string[] }>) {
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
        const event = where.OR[1].events.has
        return subscriptions
          .filter((s) => s.events.length === 0 || s.events.includes(event))
          .map((s) => ({ id: s.id }))
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
  assert.equal(tx.lastWhere.projectId, 15)
  assert.equal(tx.lastWhere.active, true)
})

test('board webhook outbox skips subscriptions that did not ask for the event', async () => {
  const tx = fakeTx([{ id: 'sub-other', events: ['comment.created'] }])

  const ids = await persistBoardWebhookEvent(tx, 15, escalation)

  assert.deepEqual(ids, [])
  assert.equal(tx.rows.length, 0)
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
  assert.equal(boardWebhookRetryDelaySeconds(2), 5 * 60)
  assert.equal(boardWebhookRetryDelaySeconds(3), 30 * 60)
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
  assert.ok(source.includes('persistTaskCreatedWebhook'))
  assert.ok(source.includes('tx.task.findUnique'))
  assert.ok(source.includes('tx.section.findUnique'))
  // No root-client import means no path that can run outside the caller's tx.
  assert.equal(source.includes("from '@/lib/prisma'"), false)
})
