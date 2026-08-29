import type { Prisma, PrismaClient } from '@prisma/client'
import { persistBoardWebhookEvent } from './outbox'
import type { WebhookDelivery, WebhookTaskStatus } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any */
type TaskCreatedDb = {
  task: { findUnique: (args: any) => Promise<any> }
  section: { findUnique: (args: any) => Promise<any> }
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type TaskCreatedRootDb = Pick<PrismaClient, '$transaction'>

interface TaskCreatedActor {
  userId: number | null
  agentId: string | null
}

interface CreatedTaskResult<T> {
  taskId: number
  result: T
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
      created.taskId,
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
 * does. Reading through `tx` also means the payload is the creation state, not
 * whatever a concurrent update wrote a moment later.
 *
 * Task creation is spread across three controllers that each build the row
 * differently, so this re-reads the task instead of asking every caller to
 * assemble the public payload.
 */
export async function persistTaskCreatedWebhook(
  tx: TaskCreatedDb,
  taskId: number,
  actorUserId: number | null,
  actorAgentId: string | null
): Promise<string[]> {
  {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        ticketNumber: true,
        projectId: true,
        title: true,
        status: true,
        dueDate: true,
        sectionId: true,
        priority: {
          select: { id: true, priority_index: true, Priority_Value: true },
        },
      },
    })
    if (!task) return []

    const section =
      task.sectionId == null
        ? null
        : await tx.section.findUnique({
            where: { id: task.sectionId },
            select: { id: true, section_title: true },
          })

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
          section: section
            ? { id: section.id, title: section.section_title }
            : null,
          status: task.status as WebhookTaskStatus,
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
}
