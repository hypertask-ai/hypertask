const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isoWeek, weeklyLiveTitle, countSteps, findOpenWeeklyTicket, fileWeeklyLiveResult, weeklyDescription,
} = require('../.github/scripts/feature-map-live-weekly-file.mjs')

test('countSteps and weekly title', () => {
  const counts = countSteps({ verdict: 'PASS', steps: [{ pass: true }, { pass: false }, { pass: true }] })
  assert.deepEqual(counts, { pass: 2, fail: 1, total: 3, verdict: 'PASS' })
  const week = isoWeek(new Date('2026-11-08T12:00:00Z'))
  assert.match(week, /^\d{4}-W\d{2}$/)
  assert.equal(weeklyLiveTitle(week), `Weekly feature-map live ${week}`)
})

function fetchFor(routes, calls = []) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init.method || 'GET', body, headers: init.headers || {} })
    const pathname = new URL(url).pathname + new URL(url).search
    const hit = routes.find((route) => route.when(pathname, body))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => hit.body }
  }
}

test('findOpenWeeklyTicket matches exact title', async () => {
  const title = weeklyLiveTitle('2026-W45')
  const ticket = await findOpenWeeklyTicket(title, {
    token: 'test-token',
    fetchImpl: fetchFor([
      {
        when: (url) => url.startsWith('/api/mcp/tasks/search'),
        body: { success: true, total: 2, tasks: [{ id: 1, title: `${title} old`, uniqueIndex: 7 }, { id: 2, title, uniqueIndex: 99 }] },
      },
    ]),
  })
  assert.equal(ticket.uniqueIndex, 99)
})

test('findOpenWeeklyTicket refuses an incomplete search', async () => {
  await assert.rejects(() => findOpenWeeklyTicket('Weekly feature-map live 2026-W45', {
    token: 'test-token',
    fetchImpl: fetchFor([{ when: (url) => url.startsWith('/api/mcp/tasks/search'), body: { success: true, total: 5, tasks: [] } }]),
  }), /incomplete/)
})

test('fileWeeklyLiveResult creates a board 11514 ticket then comments', async () => {
  const week = '2026-W45'
  const title = weeklyLiveTitle(week)
  const calls = []
  const created = await fileWeeklyLiveResult({
    week,
    evidenceDir: '/missing',
    token: 'test-token',
    fetchImpl: fetchFor([
      { when: (url) => url.startsWith('/api/mcp/tasks/search'), body: { success: true, total: 0, tasks: [] } },
      {
        when: (url) => url === '/api/mcp/tasks/create',
        body: { success: true, task: { id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205' } },
      },
      { when: (url) => url === '/api/mcp/comments', body: { success: true } },
    ], calls),
  })
  assert.equal(created.ticketNumber, 'HYCI-205')
  const create = calls.find((call) => call.url.endsWith('/api/mcp/tasks/create'))
  assert.equal(create.body.project_id, 11514)
  assert.equal(create.body.title, title)
  assert.deepEqual(create.body.labels, ['CI', 'Hypertask CI', 'brain-light'])
  assert.match(create.body.description, /What's wrong or wanted:.*Who it affects:.*Recommended course and why:.*What Valentin must decide:.*How to undo:/)
  assert.match(create.body.description, /Problem.*Fix.*Done when.*Risk.*Decision/s)
  assert.equal(create.headers['Idempotency-Key'], `feature-map-live-weekly-${week}`)
  const comment = calls.find((call) => call.url.endsWith('/api/mcp/comments'))
  assert.equal(comment.body.ticket_number, 'HYCI-205')
  assert.match(comment.body.text, /feature-map-live-weekly 2026-W45/)
})

test('weekly description keeps every sentence within twelve words', () => {
  for (const counts of [{ pass: 5, fail: 0, verdict: 'PASS' }, { pass: 3, fail: 2, verdict: 'FAIL' }, { pass: 4, fail: 1, verdict: 'FAIL' }]) {
    const text = weeklyDescription({ week: '2026-W46', counts }).replace(/<\/[^>]+>/g, '\n').replace(/<[^>]+>/g, ' ')
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const line of lines) {
      for (const sentence of line.split(/(?<=[.!?:;])\s+/)) {
        const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}_'’/-]*/gu) ?? []
        assert.ok(words.length <= 12, `too long: ${sentence}`)
      }
    }
  }
})

test('fileWeeklyLiveResult reuses an open weekly ticket', async () => {
  const week = '2026-W45'
  const title = weeklyLiveTitle(week)
  const calls = []
  const outcome = await fileWeeklyLiveResult({
    week,
    evidenceDir: '/missing',
    token: 'test-token',
    fetchImpl: fetchFor([
      { when: (url) => url.startsWith('/api/mcp/tasks/search'), body: { success: true, total: 1, tasks: [{ id: 42, title, uniqueIndex: 205, ticketNumber: 'HYCI-205' }] } },
      { when: (url) => url === '/api/mcp/comments', body: { success: true } },
    ], calls),
  })
  assert.equal(outcome.ticketNumber, 'HYCI-205')
  assert.equal(calls.some((call) => call.url.endsWith('/api/mcp/tasks/create')), false)
})
