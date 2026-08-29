import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { broadcastInboxChange } from '@/lib/realtime/server'
import {
  cancelInboxReminderJob,
  cancelInboxReminderRevisionJob,
  cancelLegacyInboxReminderJobIfSafe,
  scheduleInboxReminderJob,
} from '@/pages/api/queues/inboxQueue'
import { nextReminderRevision } from '@/utils/controllers/reminders/revision'

const MAX_NOTIFICATION_IDS = 100
const MAX_REMINDER_DELAY_MS = 366 * 24 * 60 * 60 * 1000
const REMINDER_LOCK_CLASS = 1_446_420_610

class ReminderSelectionConflict extends Error {}

function notificationId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

interface InboxArchiveResponse {
  success: boolean
  archived_count: number
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return createUnauthorizedResponse(
        'Invalid or missing authentication token.',
        'invalid_token'
      )
    }
    const user = ctx.user
    let body: { notification_ids?: unknown; remind_at?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 }
      )
    }

    const rawIds = body.notification_ids
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_NOTIFICATION_IDS) {
      return NextResponse.json(
        { success: false, error: `notification_ids must contain 1-${MAX_NOTIFICATION_IDS} entries.` },
        { status: 400 }
      )
    }

    const parsedIds = rawIds.map(notificationId)
    if (parsedIds.some((id) => id === null)) {
      return NextResponse.json(
        { success: false, error: 'Invalid notification id.' },
        { status: 400 }
      )
    }
    const notificationIds = [...new Set(parsedIds as number[])]

    const remindAt = body.remind_at === undefined ? null : new Date(String(body.remind_at))
    const validationNow = new Date()
    if (
      remindAt &&
      (Number.isNaN(remindAt.getTime()) ||
        remindAt <= validationNow ||
        remindAt.getTime() - validationNow.getTime() > MAX_REMINDER_DELAY_MS)
    ) {
      return NextResponse.json(
        { success: false, error: 'remind_at must be a future ISO timestamp within one year.' },
        { status: 400 }
      )
    }

    const notifications = await prisma.notification.findMany({
      where: {
        id: { in: notificationIds },
        userId: user.id,
        ...(remindAt ? { status: 'Normal' as const } : {}),
      },
      select: {
        id: true,
        taskId: true,
        projectId: true,
      },
    })

    if (remindAt) {
      if (
        notifications.length !== notificationIds.length ||
        notifications.some((item) => item.taskId === null || item.projectId === null)
      ) {
        return NextResponse.json(
          { success: false, error: 'One or more Inbox items are unavailable.' },
          { status: 404 }
        )
      }

      const reminders = await prisma.$transaction(async (tx) => {
        const candidateTaskIds = [...new Set(notifications.map((item) => item.taskId!))].sort((a, b) => a - b)
        for (const candidateTaskId of candidateTaskIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REMINDER_LOCK_CLASS}::int, ${candidateTaskId}::int)`
        }
        const lockedNotifications = await tx.notification.findMany({
          where: { id: { in: notificationIds }, userId: user.id, status: 'Normal' },
          select: { id: true, taskId: true, projectId: true },
        })
        if (
          lockedNotifications.length !== notificationIds.length ||
          lockedNotifications.some((item) => item.taskId === null || item.projectId === null)
        ) {
          throw new ReminderSelectionConflict('Inbox selection changed before the reminder was saved.')
        }
        const tasks = [...new Map(lockedNotifications.map((item) => [item.taskId!, item])).values()]
        const saved = []
        for (const item of tasks) {
          const existing = await tx.reminder.findMany({
            where: { userId: user.id, taskId: item.taskId! },
            orderBy: { id: 'asc' },
          })
          const writeRevision = nextReminderRevision(existing)
          const active = existing.filter((reminder) => reminder.status === 'Normal')
          if (active.length > 1) {
            await tx.reminder.updateMany({
              where: { id: { in: active.slice(1).map((reminder) => reminder.id) } },
              data: { status: 'Archive', updatedAt: writeRevision },
            })
          }
          const previous = active[0] ?? null
          const reminder = previous
              ? await tx.reminder.update({
                  where: { id: previous.id },
                  data: {
                    projectId: item.projectId!,
                    remindAt,
                    updatedAt: writeRevision,
                    invokeCondition: 'DurationComplete',
                  },
                })
              : await tx.reminder.create({
                  data: {
                    userId: user.id,
                    taskId: item.taskId!,
                    projectId: item.projectId!,
                    remindAt,
                    updatedAt: writeRevision,
                    invokeCondition: 'DurationComplete',
                  },
                })
          saved.push({ reminder, previous })
        }
        await tx.notification.updateMany({
          where: { userId: user.id, taskId: { in: tasks.map((item) => item.taskId!) }, status: 'Normal' },
          data: { status: 'Archive', archivedAt: new Date() },
        })
        return saved
      })

      const deliveryResults = await Promise.allSettled(
        reminders.map(async ({ reminder, previous }) => {
          await cancelInboxReminderJob(reminder.userId, reminder.taskId)
          await cancelInboxReminderRevisionJob(previous)
          await cancelLegacyInboxReminderJobIfSafe(reminder.userId, reminder.taskId)
          await scheduleInboxReminderJob(reminder, remindAt)
        })
      )
      const deliveryPending = deliveryResults.some((result) => result.status === 'rejected')
      void broadcastInboxChange(user.id, { originUserId: user.id })
      return NextResponse.json(
        {
          success: true,
          archived_count: notificationIds.length,
          reminder_count: reminders.length,
          delivery_pending: deliveryPending,
          delivery_mode: deliveryPending ? 'database_sweep' : 'scheduled_job',
        },
        { status: deliveryPending ? 202 : 200 }
      )
    }

    const taskIds = notifications.map((notification) => notification.taskId)
    .filter((taskId) => taskId !== null)
    .map((taskId) => taskId as number)

    await prisma.notification.updateMany({
      where:{
        id:{notIn:notificationIds},
        taskId:{in:taskIds},
        userId:user.id,
        status:{not:"Deleted"}
      },
      data:{
        status:"Deleted",
      }
    })

    const result = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId: user.id,
      },
      data: {
        status: 'Archive',
        archivedAt: new Date(),
      },
    })

    const response: InboxArchiveResponse = {
      success: true,
      archived_count: result.count,
    }

    void broadcastInboxChange(user.id, { originUserId: user.id })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ReminderSelectionConflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 })
    }
    console.error('Error archiving inbox notifications:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
