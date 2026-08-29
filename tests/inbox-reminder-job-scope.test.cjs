const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const queue = fs.readFileSync('src/pages/api/queues/inboxQueue.ts', 'utf8')
const writer = fs.readFileSync('src/pages/api/queues/inboxReminder.ts', 'utf8')
const delivery = fs.readFileSync('src/utils/controllers/reminders/invokeReminder.ts', 'utf8')
const nativeRoute = fs.readFileSync('src/app/api/mcp/inbox/archive/route.ts', 'utf8')
const invocation = fs.readFileSync('src/utils/controllers/reminders/invokeReminder.ts', 'utf8')
const cardActionLocks = fs.readFileSync('src/lib/taskCardActions/writeLocks.ts', 'utf8')
const notificationWriter = fs.readFileSync(
  'src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts',
  'utf8',
)

test('Inbox reminder jobs are scoped by user and task', () => {
  assert.match(queue, /buildInboxReminderJobId\(reminder: IReminder\)/)
  assert.match(queue, /notifications-for-user-\$\{reminder\.userId\}-task-\$\{reminder\.taskId\}-revision-\$\{reminderRevision\(reminder\)\}/)
  assert.match(queue, /buildInboxReminderJobId\(reminder\)/)
  assert.match(queue, /cancelInboxReminderJob\(userId: number, taskId: number\)/)
  assert.match(queue, /cancelLegacyInboxReminderJobIfSafe\(userId: number, taskId: number\)/)
  assert.match(queue, /userId: \{ not: userId \}/)
  assert.match(queue, /notifications-for-task-\$\{taskId\}/)
  assert.match(nativeRoute, /cancelLegacyInboxReminderJobIfSafe/)
  assert.match(queue, /invokeDueReminder\(job\)/)
  assert.match(queue, /stale and legacy task-only jobs are harmless/)
  assert.match(invocation, /r\."remindAt" = \$\{expectedRemindAt\}/)
  assert.match(invocation, /r\."updatedAt" IS NOT DISTINCT FROM \$\{expectedUpdatedAt\}/)
  assert.match(invocation, /reminder\.updatedAt instanceof Date/)
})

test('reschedules cancel the exact previously persisted revision job', () => {
  assert.match(queue, /export async function cancelInboxReminderRevisionJob/)
  assert.match(queue, /cancelJobById\(buildInboxReminderJobId\(reminder\)/)
  assert.match(nativeRoute, /cancelInboxReminderRevisionJob\(previous\)/)
  assert.match(writer, /cancelInboxReminderRevisionJob\(reminder\.previous\)/)
})

test('Every Inbox reminder writer shares the advisory lock and deduplication protocol', () => {
  assert.match(writer, /REMINDER_LOCK_CLASS = 1_446_420_610/)
  assert.match(writer, /pg_advisory_xact_lock/)
  assert.match(writer, /active\.slice\(1\)/)
  assert.match(writer, /where: \{ userId, taskId \}/)
  assert.match(nativeRoute, /where: \{ userId: user\.id, taskId: item\.taskId! \}/)
  assert.match(writer, /status: "Archive"/)
  assert.match(writer, /projectId,/)
  assert.doesNotMatch(writer, /reminder\.deleteMany/)
})

test('Reminder delivery shares the writer lock and restores inside its claim transaction', () => {
  assert.match(cardActionLocks, /TASK_INBOX_REMINDER_LOCK_CLASS = 1_446_420_610/)
  assert.match(delivery, /TASK_INBOX_REMINDER_LOCK_CLASS/)
  assert.match(delivery, /withTaskInboxWriteLock/)
  assert.match(delivery, /pg_advisory_xact_lock/)
  assert.match(delivery, /return prisma\.\$transaction\(async \(tx\)/)
  assert.match(delivery, /restoreReminderNotifications\([\s\S]*tx[\s\S]*\)/)
  assert.match(delivery, /client\.reminder\.updateMany/)
  assert.match(delivery, /status: "Normal"/)
  assert.match(delivery, /if \(claimed\.count === 0\) return "skipped"/)
  assert.match(delivery, /client\.notification\.findMany/)
  assert.match(delivery, /client\.notification\.update/)
  assert.match(notificationWriter, /withTaskInboxWriteLock\(taskId/)
  assert.match(notificationWriter, /checkReminderAndCreateNotification\([\s\S]*tx/)
})
