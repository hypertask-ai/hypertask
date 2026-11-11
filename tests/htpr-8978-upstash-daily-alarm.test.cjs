const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/ops/upstashDailyAlarm.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } },
).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', code)(mod, mod.exports, () => {
  throw new Error('alarm math has no imports')
})
const alarm = mod.exports

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

test('a new day or a counter reset starts a fresh baseline', () => {
  const cursor = { day: '2026-11-11', startTotal: 5000 }
  const next = alarm.advanceDayCursor(cursor, '2026-11-12', 5400)
  assert.equal(next.commandsToday, null)
  assert.deepEqual(next.cursor, { day: '2026-11-12', startTotal: 5400 })
  const reset = alarm.advanceDayCursor(cursor, '2026-11-11', 10)
  assert.equal(reset.commandsToday, null)
  assert.equal(reset.cursor.startTotal, 10)
  assert.equal(alarm.shouldFileDailyAlarm(null), false)
})
