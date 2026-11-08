const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isoWeek, weeklyLiveTitle, countSteps, findOpenWeeklyTicket, fileWeeklyLiveResult,
} = require('../.github/scripts/feature-map-live-weekly-file.mjs')

test('countSteps and weekly title', () => {
  const counts = countSteps({ verdict: 'PASS', steps: [{ pass: true }, { pass: false }, { pass: true }] })
  assert.deepEqual(counts, { pass: 2, fail: 1, total: 3, verdict: 'PASS' })
  const week = isoWeek(new Date('2026-11-08T12:00:00Z'))
  assert.match(week, /^\d{4}-W\d{2}$/)
  assert.equal(weeklyLiveTitle(week), `Weekly feature-map live ${week}`)
})

function boardExec(rows) {
  return (binary, args) => {
    const route = args.filter((a) => a !== '--json')
    const hit = rows.find((row) => row.when(binary, route))
    if (!hit) throw new Error(`unexpected ${binary} ${route.join(' ')}`)
    return typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)
  }
}

test('findOpenWeeklyTicket matches exact title', async () => {
  const title = weeklyLiveTitle('2026-W45')
  const ticket = await findOpenWeeklyTicket(title, {
    execImpl: boardExec([
      { when: (b, r) => b === 'hypertask' && r.includes('Normal'), body: { success: true, tasks: [{ id: 1, title, uniqueIndex: 99, section: 'Backlog' }] } },
      { when: (b, r) => b === 'hypertask' && r.includes('Archive'), body: { success: true, tasks: [] } },
      { when: (b, r) => b === 'hypertask' && r.includes('Deleted'), body: { success: true, tasks: [] } },
    ]),
  })
  assert.equal(ticket.uniqueIndex, 99)
})

test('fileWeeklyLiveResult creates then dedupes activity', async () => {
  let created = false
  const title = weeklyLiveTitle('2026-W45')
  const execImpl = (binary, args) => {
    const route = args.filter((a) => a !== '--json')
    if (binary === 'hypertask' && route[0] === 'task' && route[1] === 'list') {
      return JSON.stringify({ success: true, tasks: created ? [{ id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205', section: 'Backlog' }] : [] })
    }
    if (binary === 'vcc' && route[0] === 'task' && route[1] === 'create') {
      created = true
      return JSON.stringify({ success: true, task: { id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205', section: 'Backlog' } })
    }
    if (binary === 'vcc' && route[0] === 'activity') return route[1] === 'list' ? '' : 'ok'
    throw new Error(`unexpected ${binary} ${route.join(' ')}`)
  }
  const first = await fileWeeklyLiveResult({ week: '2026-W45', evidenceDir: '/missing', execImpl })
  assert.equal(created, true)
  assert.equal(first.duplicate, false)
  const prior = 'feature-map-live-weekly 2026-W45 feature-map-live-weekly 2026-W45 Pass: 0 Fail: 0 Verdict: FAIL SHA: unknown'
  const second = await fileWeeklyLiveResult({
    week: '2026-W45',
    evidenceDir: '/missing',
    execImpl: boardExec([
      { when: (b, r) => b === 'hypertask' && r[0] === 'task', body: { success: true, tasks: [{ id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205', section: 'Backlog' }] } },
      { when: (b, r) => b === 'vcc' && r[0] === 'activity' && r[1] === 'list', body: `2026-11-08T00:00:00.000Z\tCI Boss\t${prior}` },
    ]),
  })
  assert.equal(second.duplicate, true)
})
