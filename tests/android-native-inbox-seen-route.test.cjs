const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routePath = path.join(
  process.cwd(),
  'src/app/api/mcp/inbox/seen/route.ts'
)
const route = fs.readFileSync(routePath, 'utf8')

test('native inbox seen route authenticates before parsing or writing', () => {
  const rateLimitAt = route.indexOf('checkMcpRateLimit(request)')
  const authAt = route.indexOf('validateMcpAuth(request)')
  const parseAt = route.indexOf('request.json()')
  const updateAt = route.indexOf('prisma.notification.updateMany')

  assert.ok(rateLimitAt >= 0)
  assert.ok(authAt > rateLimitAt)
  assert.ok(parseAt > authAt)
  assert.ok(updateAt > parseAt)
})

test('native inbox seen route is idempotent and account scoped', () => {
  assert.match(route, /userId:\s*ctx\.user\.id/)
  assert.match(route, /seen:\s*false/)
  assert.match(route, /data:\s*\{\s*seen:\s*true\s*\}/)
  assert.match(route, /MAX_NOTIFICATION_IDS\s*=\s*100/)
  assert.match(route, /broadcastInboxChange\(ctx\.user\.id/)
  assert.doesNotMatch(route, /prisma\.(?:\$queryRaw|\$executeRaw)/)
})

test('native inbox seen route rejects null and non-object JSON bodies', () => {
  assert.match(route, /body === null/)
  assert.match(route, /typeof body !== 'object'/)
  assert.match(route, /Array\.isArray\(body\)/)
  assert.ok(route.indexOf('body === null') < route.indexOf("notification_ids\n"))
})

test('native inbox seen route caps raw input before normalization', () => {
  const rawLimitAt = route.indexOf('rawIds.length > MAX_NOTIFICATION_IDS')
  const normalizeAt = route.indexOf('const notificationIds =')
  assert.ok(rawLimitAt >= 0)
  assert.ok(normalizeAt > rawLimitAt)
})
