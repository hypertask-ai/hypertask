const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const alarm = loadModule('src/lib/ops/upstashDailyAlarm.ts')

test('INFO stats yield the cumulative command total', () => {
  assert.equal(alarm.parseTotalCommands('# Stats\r\ntotal_commands_processed:1251549\r\n'), 1251549)
  assert.equal(alarm.parseTotalCommands('used_memory:2'), null)
})

test('the first sample of a day is a baseline and later samples count the delta', () => {
  const first = alarm.advanceDayCursor(null, '2026-11-11', 1000)
  assert.equal(first.commandsToday, null)
  assert.deepEqual(first.cursor, { day: '2026-11-11', startTotal: 1000 })
  const later = alarm.advanceDayCursor(first.cursor, '2026-11-11', 301001)
  assert.equal(later.commandsToday, 300001)
  assert.equal(alarm.shouldFileDailyAlarm(later.commandsToday), true)
  assert.equal(alarm.shouldFileDailyAlarm(300000), false)
})

test('midnight counts the final hour before starting the next day', () => {
  const cursor = { day: '2026-11-11', startTotal: 5000 }
  const next = alarm.advanceDayCursor(cursor, '2026-11-12', 305001)
  assert.equal(next.day, '2026-11-11')
  assert.equal(next.commandsToday, 300001)
  assert.equal(alarm.shouldFileDailyAlarm(next.commandsToday), true)
  assert.deepEqual(next.cursor, { day: '2026-11-12', startTotal: 305001 })
  assert.equal(alarm.advanceDayCursor(cursor, '2026-11-13', 900000).commandsToday, null)
  const reset = alarm.advanceDayCursor(cursor, '2026-11-11', 10)
  assert.equal(reset.commandsToday, null)
  assert.equal(reset.cursor.startTotal, 10)
  assert.equal(alarm.shouldFileDailyAlarm(null), false)
})

test('cron authorization, rollback, threshold and duplicate filing use the real route', async t => {
  const values = { NODE_ENV: 'production', VERCEL_ENV: 'production', CRON_SECRET: 'fixture-cron-secret' }
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => Object.entries(prior).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }))
  const day = new Date().toISOString().slice(0, 10)
  let enabled = false, total = 300000, existing = null, redisCalls = 0
  const filed = []
  const route = loadModule('src/app/api/cron/upstash-daily-alarm/route.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => enabled },
    '@/lib/prisma': { default: {
      task: { findFirst: async () => existing },
      project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 9, section_title: 'Bugs' }], labels: [{ id: 1, value: 'Infra' }, { id: 2, value: 'brain-medium' }] }) },
    } },
    '@/lib/redis': { getRedis: async () => {
      redisCalls++
      return { info: async () => `total_commands_processed:${total}`,
        get: async () => JSON.stringify({ day, startTotal: 0 }), set: async () => 'OK' }
    } },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async args => {
      filed.push(args)
      existing = { id: 42 }
      return { task: existing }
    } },
  })
  const call = (authorization = 'Bearer fixture-cron-secret') => route.GET(new (require('next/server').NextRequest)('https://fixture.test/api/cron/upstash-daily-alarm', { headers: { authorization } }))
  assert.equal((await call('Bearer invalid')).status, 401)
  assert.deepEqual(await (await call()).json(), { checked: 0 })
  assert.equal(redisCalls, 0)
  enabled = true
  assert.equal((await (await call()).json()).filedTaskId, null)
  total++
  assert.equal((await (await call()).json()).filedTaskId, 42)
  assert.equal((await (await call()).json()).filedTaskId, 42)
  assert.equal(filed.length, 1)
  assert.equal(filed[0].priorityIndex, 1)
  assert.deepEqual(filed[0].labelIds, [1, 2])
})
