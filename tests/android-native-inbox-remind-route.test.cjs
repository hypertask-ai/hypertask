const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const route = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/mcp/inbox/archive/route.ts'),
  'utf8'
)

test('native archive route reminder mode authenticates and scopes notifications to the caller', () => {
  assert.match(route, /validateMcpAuth\(request\)/)
  assert.match(route, /userId: user\.id/)
  assert.match(route, /notifications\.length !== notificationIds\.length/)
  assert.match(route, /status: 'Normal'/)
  assert.match(route, /lockedNotifications\.length !== notificationIds\.length/)
  assert.match(route, /function notificationId\(value: unknown\)/)
  assert.match(route, /\^\[1-9\]\\d\*\$/)
  assert.doesNotMatch(route, /rawIds\.map\(Number\)/)
})

test('native archive route validates reminder bounds and persists atomically', () => {
  assert.match(route, /MAX_NOTIFICATION_IDS = 100/)
  assert.match(route, /MAX_REMINDER_DELAY_MS/)
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /pg_advisory_xact_lock/)
  assert.match(route, /invokeCondition: 'DurationComplete'/)
  assert.match(route, /projectId: item\.projectId!/)
})

test('native archive route schedules reminder delivery', () => {
  assert.match(route, /status: 'Archive'/)
  assert.match(route, /archivedAt: new Date\(\)/)
  assert.match(route, /cancelInboxReminderJob/)
  assert.match(route, /scheduleInboxReminderJob/)
  assert.match(route, /delivery_pending/)
  assert.match(route, /database_sweep/)
  assert.match(route, /broadcastInboxChange/)
})
