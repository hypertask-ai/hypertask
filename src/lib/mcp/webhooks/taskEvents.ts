import type { Prisma, PrismaClient } from '@prisma/client'
import { persistBoardWebhookEvent } from './outbox'
import type { WebhookDelivery, WebhookTaskStatus } from './events'
import { enqueueTaskCreated, processAnalyticsIntentSoon, type CreationChannel } from '../../telemetry/savedWork'


type TaskCreatedDb = Pick<Prisma.TransactionClient, "agent" | "project" | "task" | "comment" | "chatSession" | "agentRun"> & {
  webhookSubscription: { findMany: (args: any) => Promise<any> }
  boardWebhookDelivery: { create: (args: any) => Promise<any> }
}


type TaskCreatedRootDb = Pick<PrismaClient, '$transaction'>

interface TaskCreatedActor {
  userId: number | null
  agentId: string | null
}

export interface WebhookTaskSnapshot {
  id: number
  ticketNumber: string | null
  projectId: number
  title: string
  status: WebhookTaskStatus
  dueDate: Date | null
  startDate: Date | null
  sectionId: number | null
  section: string
  priority: { id: string; priority_index: number; Priority_Value: string } | null
}

interface CreatedTaskResult<T> {
  taskId: number
  result: T
  webhookTask: WebhookTaskSnapshot
  firstTaskPointerTaskId: number | null
}

export async function createTaskWithBoardWebhookOutbox<T>(
  db: TaskCreatedRootDb,
  actor: TaskCreatedActor,
  createTask: (
    tx: Prisma.TransactionClient
  ) => Promise<CreatedTaskResult<T>>,
  channel: CreationChannel,
  analyticsAgentId: string | null = null
): Promise<{ result: T; boardWebhookDeliveryIds: string[] }> {
  const committed = await db.$transaction(async (tx) => {
    const created = await createTask(tx)
    const boardWebhookDeliveryIds = await persistTaskCreatedWebhook(
      tx,
      created.webhookTask,
      actor.userId,
      actor.agentId
    )
    if (created.firstTaskPointerTaskId) {
      await tx.project.updateMany({
        where: { id: created.webhookTask.projectId, firstTaskPointerTaskId: created.firstTaskPointerTaskId, firstRealTaskCreatedAt: null },
        data: { firstRealTaskCreatedAt: new Date() },
      })
    }
    const analyticsKey = await enqueueTaskCreated(tx, created.taskId, { userId: actor.userId, agentId: actor.agentId ?? analyticsAgentId }, channel)
    return { analyticsKey, result: created.result, boardWebhookDeliveryIds }
  })
  processAnalyticsIntentSoon(committed.analyticsKey)
  return { result: committed.result, boardWebhookDeliveryIds: committed.boardWebhookDeliveryIds }
}

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
        startDate: task.startDate ? task.startDate.toISOString() : null,
      },
      actor: { userId: actorUserId, agentId: actorAgentId },
    },
  }
  return persistBoardWebhookEvent(tx, task.projectId, createdEvent)
}
