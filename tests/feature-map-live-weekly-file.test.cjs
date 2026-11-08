const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isoWeek,
  weeklyLiveTitle,
  countSteps,
  findOpenWeeklyTicket,
  fileWeeklyLiveResult,
} = require('../.github/scripts/feature-map-live-weekly-file.mjs')

test('countSteps tallies pass and fail', () => {
  const counts = countSteps({
    verdict: 'PASS',
    steps: [{ pass: true }, { pass: false }, { pass: true }],
  })
  assert.equal(counts.pass, 2)
  assert.equal(counts.fail, 1)
  assert.equal(counts.verdict, 'PASS')
})

test('weekly title is stable per ISO week', () => {
  const week = isoWeek(new Date('2026-11-08T12:00:00Z'))
  assert.match(week, /^\d{4}-W\d{2}$/)
  assert.equal(weeklyLiveTitle(week), `Weekly feature-map live ${week}`)
})

function boardExec(rows) {
  return (binary, args) => {
    const route = args.filter((a) => a !== '--json')
    const hit = rows.find((row) => row.when(binary, route))
    if (!hit) throw new Error(`unexpected ${binary} ${route.join(' ')}`)
    if (typeof hit.body === 'string') return hit.body
    return JSON.stringify(hit.body)
  }
}

test('findOpenWeeklyTicket matches exact title', async () => {
  const title = weeklyLiveTitle('2026-W45')
  const execImpl = boardExec([
    {
      when: (binary, route) => binary === 'hypertask' && route.includes('Normal'),
      body: { success: true, tasks: [{ id: 1, title, uniqueIndex: 99, section: 'Backlog' }] },
    },
    {
      when: (binary, route) => binary === 'hypertask' && route.includes('Archive'),
      body: { success: true, tasks: [] },
    },
    {
      when: (binary, route) => binary === 'hypertask' && route.includes('Deleted'),
      body: { success: true, tasks: [] },
    },
  ])
  const ticket = await findOpenWeeklyTicket(title, { execImpl })
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
    if (binary === 'vcc' && route[0] === 'activity' && route[1] === 'list') {
      return ''
    }
    if (binary === 'vcc' && route[0] === 'activity' && route[1] === 'add') {
      return 'activity-1'
    }
    throw new Error(`unexpected ${binary} ${route.join(' ')}`)
  }
  const first = await fileWeeklyLiveResult({
    week: '2026-W45',
    evidenceDir: '/missing',
    execImpl,
  })
  assert.equal(created, true)
  assert.equal(first.duplicate, false)
  assert.equal(first.counts.total, 0)

  const priorNote = 'feature-map-live-weekly 2026-W45 feature-map-live-weekly 2026-W45 Pass: 0 Fail: 0 Verdict: FAIL SHA: unknown'
  const second = await fileWeeklyLiveResult({
    week: '2026-W45',
    evidenceDir: '/missing',
    execImpl: boardExec([
      {
        when: (binary, route) => binary === 'hypertask' && route[0] === 'task',
        body: { success: true, tasks: [{ id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205', section: 'Backlog' }] },
      },
      {
        when: (binary, route) => binary === 'vcc' && route[0] === 'activity' && route[1] === 'list',
        body: `2026-11-08T00:00:00.000Z\tCI Boss\t${priorNote}`,
      },
    ]),
  })
  assert.equal(second.duplicate, true)
})
