import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types"
import { lockTaskTeamScope } from "@/lib/mcp/tasks/agentMutationFence"
import type { NotificationType, Prisma } from '@prisma/client'
import { broadcastInboxChange } from '@/lib/realtime/server'
import checkReminderAndCreateNotification from '@/utils/controllers/notifications/creation-service/check-reminder_create-notification'
import { withTaskInboxWriteLock } from './writeLocks'

type InboxIdentity = {
  userId: number
  agentId?: string | null
  taskId: number
  projectId: number
  fromUserId?: number | null
  fromAgentId?: string | null
  teamScope?: AgentTokenTeamScope | null
}

type InboxPayload = InboxIdentity & Record<string, unknown>

const whereFor = ({ userId, agentId = null, taskId, projectId }: InboxIdentity) => ({
  userId,
  agentId,
  taskId,
  projectId,
  type: 'TaskMovedToInbox' as NotificationType,
})

async function assertCurrentTaskProject(
  tx: Prisma.TransactionClient,
  input: InboxIdentity,
) {
  const task = await tx.$queryRaw<Array<{ projectId: number }>>`
    SELECT "projectId"
    FROM "Task"
    WHERE id = ${input.taskId} AND status <> 'Deleted'
    FOR UPDATE
  `
  await lockTaskTeamScope(tx, input.taskId, input.userId, input.agentId, input.teamScope)
  if (task[0]?.projectId !== input.projectId) {
    throw new Error('Task changed boards before Inbox reconciliation')
  }
}

export async function ensureTaskMovedToInbox(
  input: InboxIdentity,
  payload: InboxPayload,
) {
  const notification = await withTaskInboxWriteLock(input.taskId, async (tx) => {
    await assertCurrentTaskProject(tx, input)
    const existing = await tx.notification.findFirst({
      where: { ...whereFor(input), status: 'Normal' },
      select: { id: true },
    })
    if (existing) return existing
    return checkReminderAndCreateNotification(
      input.userId,
      input.projectId,
      input.taskId,
      { ...payload, type: 'TaskMovedToInbox' },
      true,
      tx,
    )
  })
  void broadcastInboxChange(input.userId, { originUserId: input.fromUserId ?? input.userId })
  return notification
}

export async function setTaskMovedToInboxState(
  input: InboxIdentity,
  active: boolean,
) {
  const activeAfterWrite = await withTaskInboxWriteLock(input.taskId, async (tx) => {
    await assertCurrentTaskProject(tx, input)
    const recipient = whereFor(input)
    if (active) {
      const existing = await tx.notification.findFirst({
        where: { ...recipient, status: 'Normal' },
        select: { id: true },
      })
      if (!existing) {
        await checkReminderAndCreateNotification(
          input.userId,
          input.projectId,
          input.taskId,
          {
            ...recipient,
            fromUserId: input.fromUserId ?? input.userId,
            fromAgentId: input.fromAgentId ?? input.agentId ?? null,
          },
          true,
          tx,
        )
      }
    } else {
      const archivedAt = new Date()
      await tx.notification.updateMany({
        where: { ...recipient, status: 'Normal' },
        data: { status: 'Archive', archivedAt },
      })
      if (input.agentId == null) {
        await tx.reminder.updateMany({
          where: {
            userId: input.userId,
            taskId: input.taskId,
            projectId: input.projectId,
            status: 'Normal',
          },
          data: { status: 'Archive', updatedAt: archivedAt },
        })
      }
    }
    return (await tx.notification.findFirst({
      where: { ...recipient, status: 'Normal' },
      select: { id: true },
    })) !== null
  })
  void broadcastInboxChange(input.userId, { originUserId: input.fromUserId ?? input.userId })
  return activeAfterWrite
}
