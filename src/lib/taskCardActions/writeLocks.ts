import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

const TASK_STAR_LOCK_CLASS = 1_446_420_611
// Reminder delivery and every TaskMovedToInbox writer must serialize on the
// same task identity or a concurrent restore can undo an explicit archive.
export const TASK_INBOX_REMINDER_LOCK_CLASS = 1_446_420_610

async function withTaskWriteLock<T>(
  lockClass: number,
  taskId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockClass}::int, ${taskId}::int)`
    return operation(tx)
  })
}

export function withTaskStarWriteLock<T>(
  taskId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return withTaskWriteLock(TASK_STAR_LOCK_CLASS, taskId, operation)
}

export function withTaskInboxWriteLock<T>(
  taskId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return withTaskWriteLock(TASK_INBOX_REMINDER_LOCK_CLASS, taskId, operation)
}
