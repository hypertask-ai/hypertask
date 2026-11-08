const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isoWeek,
  weeklyLiveTitle,
  countSteps,
  buildActivity,
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

test('findOpenWeeklyTicket matches exact title', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('status=Normal')) {
      return { ok: true, json: async () => ({ tasks: [{ id: 1, title: weeklyLiveTitle('2026-W45'), uniqueIndex: 99, section: 'Backlog' }] }) }
    }
    return { ok: true, json: async () => ({ tasks: [] }) }
  }
  const ticket = await findOpenWeeklyTicket('token', weeklyLiveTitle('2026-W45'), fetchImpl)
  assert.equal(ticket.uniqueIndex, 99)
  assert.ok(calls[0].includes('project_id=11514'))
})

test('fileWeeklyLiveResult creates then dedupes activity', async () => {
  let created = false
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/tasks?')) return { ok: true, json: async () => ({ tasks: [] }) }
    if (url.endsWith('/labels')) return { ok: true, json: async () => ({ labels: [{ id: 'ci', name: 'CI' }, { id: 'hyci', name: 'Hypertask CI' }, { id: 'brain', name: 'brain-light' }] }) }
    if (url.endsWith('/tasks/create')) {
      created = true
      return { ok: true, json: async () => ({ task: { id: 42, uniqueIndex: 205 } }) }
    }
    if (url.includes('/agent-activity')) return { ok: true, json: async () => ({ activities: [] }) }
    if (url.endsWith('/agents/runs') && options.method === 'POST') return { ok: true, json: async () => ({ run: { id: 'run-1' } }) }
    if (url.includes('/activities')) return { ok: true, json: async () => ({}) }
    throw new Error(`unexpected ${url}`)
  }
  const first = await fileWeeklyLiveResult({
    token: 'tok',
    week: '2026-W45',
    evidenceDir: '/missing',
    fetchImpl,
  })
  assert.equal(created, true)
  assert.equal(first.duplicate, false)
  assert.equal(first.counts.total, 0)

  const second = await fileWeeklyLiveResult({
    token: 'tok',
    week: '2026-W45',
    evidenceDir: '/missing',
    fetchImpl: async (url) => {
      if (url.includes('/tasks?')) return { ok: true, json: async () => ({ tasks: [{ id: 42, title: weeklyLiveTitle('2026-W45'), uniqueIndex: 205, section: 'Backlog' }] }) }
      if (url.includes('/agent-activity')) return { ok: true, json: async () => ({ activities: [{ text: 'feature-map-live-weekly 2026-W45\nPass: 0' }] }) }
      throw new Error(`unexpected ${url}`)
    },
  })
  assert.equal(second.duplicate, true)
})
