import type { Prisma, PrismaClient } from '@prisma/client'
import { persistBoardWebhookEvent } from './outbox'
import type { WebhookDelivery, WebhookTaskStatus } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any */
type TaskCreatedDb = {
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type TaskCreatedRootDb = Pick<PrismaClient, '$transaction'>

interface TaskCreatedActor {
  userId: number | null
  agentId: string | null
}

/**
 * Exactly what task.created needs, taken from the row the caller's own
 * tx.task.create already returned/built (HTPR-5928) instead of re-reading it
 * from the database. `section` is Task's own denormalized title field, so no
 * separate Section lookup is needed either.
 */
export interface WebhookTaskSnapshot {
  id: number
  ticketNumber: string | null
  projectId: number
  title: string
  status: WebhookTaskStatus
  dueDate: Date | null
  sectionId: number | null
  section: string
  priority: { id: string; priority_index: number; Priority_Value: string } | null
}

interface CreatedTaskResult<T> {
  taskId: number
  result: T
  webhookTask: WebhookTaskSnapshot
}

/**
 * Keep the task mutation and task.created outbox rows in one transaction.
 * Callers can add priority, labels, assignments, or recovery markers in the
 * callback before the public creation payload is frozen.
 */
export async function createTaskWithBoardWebhookOutbox<T>(
  db: TaskCreatedRootDb,
  actor: TaskCreatedActor,
  createTask: (
    tx: Prisma.TransactionClient
  ) => Promise<CreatedTaskResult<T>>
): Promise<{ result: T; boardWebhookDeliveryIds: string[] }> {
  return db.$transaction(async (tx) => {
    const created = await createTask(tx)
    const boardWebhookDeliveryIds = await persistTaskCreatedWebhook(
      tx,
      created.webhookTask,
      actor.userId,
      actor.agentId
    )
    return { result: created.result, boardWebhookDeliveryIds }
  })
}

/**
 * Persist task.created for board subscribers inside the caller's creation
 * transaction (HTPR-4530). Returns the delivery ids to publish once that
 * transaction commits, so the event either exists with the task or neither
 * does.
 *
 * `task` is built by the caller from the row its own tx.task.create already
 * returned (HTPR-5928) — this used to re-read the task and its section here,
 * which cost two extra round trips while the caller's per-project advisory
 * lock (createGlobally.ts) was held.
 */
export async function persistTaskCreatedWebhook(
  tx: TaskCreatedDb,
  task: WebhookTaskSnapshot,
  actorUserId: number | null,
  actorAgentId: string | null
): Promise<string[]> {
  const createdEvent: WebhookDelivery = {
    event: 'task.created',
    data: {
      task: {
        id: task.id,
        ticketNumber: task.ticketNumber,
        projectId: task.projectId,
        title: task.title,
      },
      state: {
        section:
          task.sectionId == null
            ? null
            : { id: task.sectionId, title: task.section },
        status: task.status,
        priority: task.priority
          ? {
              id: task.priority.id,
              index: task.priority.priority_index,
              value: task.priority.Priority_Value,
            }
          : null,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      },
      actor: { userId: actorUserId, agentId: actorAgentId },
    },
  }
  return persistBoardWebhookEvent(tx, task.projectId, createdEvent)
}
