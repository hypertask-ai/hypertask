const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  BOARD, MAP_INDEX, TICKET_TITLE, readMapRows, driveScriptName, planFeatures, tagStatuses, gradeFeatures,
  mergeTagStatus, summaryLines, fileFindings,
} = require('../.github/scripts/feature-map-live-daily.mjs')
const { driveBaseAllowed } = require('../.claude/skills/verify-qa/scripts/drive-grade.mjs')

const rows = readMapRows(readFileSync(path.join(__dirname, '..', MAP_INDEX), 'utf8'))
const inboxPlan = planFeatures([{ area: 'Inbox', file: 'inbox.md', tokens: ['view-inbox'] }], { tags: ['view-inbox'], scripts: [] })
const failing = gradeFeatures(inboxPlan, { 'view-inbox': 'failed' }, {})
const passing = gradeFeatures(inboxPlan, { 'view-inbox': 'passed' }, {})
const report = { suites: [{ specs: [{ tags: ['id:view-inbox', 'mobile'], tests: [{ results: [{ status: 'passed' }] }] }], suites: [
  { specs: [{ tags: ['id:login'], tests: [{ results: [{ status: 'failed' }] }] }] },
  { specs: [{ tags: ['id:open-board'], tests: [{ results: [{ status: 'skipped' }] }] }, { tags: ['id:ai-chat'], tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }] }] },
] }] }

test('the map index gives one row per area and a driver only when the map names one', () => {
  assert.ok(rows.length >= 55, `read ${rows.length} rows`)
  assert.deepEqual(rows.find((row) => row.file === 'inbox.md').tokens.slice(0, 1), ['view-inbox'])
  const scripts = ['board-drive-live.mjs']
  assert.equal(driveScriptName('node .claude/skills/verify-qa/scripts/board-drive-live.mjs', scripts), 'board-drive-live.mjs')
  const plan = planFeatures(rows, { tags: ['view-inbox', 'open-board'], scripts })
  assert.deepEqual(plan.find((feature) => feature.file === 'inbox.md').tags, ['view-inbox'])
  assert.deepEqual(plan.find((feature) => feature.file === 'boards-and-views.md').scripts, scripts)
  const figma = plan.find((feature) => feature.file === 'figma-connect.md')
  assert.match(figma.reason, /no live driver/)
})

test('grading says pass, fail or not-drivable per mapped feature', () => {
  const plan = planFeatures([
    { area: 'Inbox', file: 'inbox.md', tokens: ['view-inbox'] },
    { area: 'Login', file: 'login.md', tokens: ['login', 'open-board'] },
    { area: 'Drag', file: 'drag-and-drop.md', tokens: ['drag-card'] },
    { area: 'Figma', file: 'figma-connect.md', tokens: [] },
  ], { tags: ['view-inbox', 'login', 'open-board', 'drag-card'], scripts: [] })
  const worst = {}
  mergeTagStatus(worst, tagStatuses(report))
  mergeTagStatus(worst, { login: 'passed', 'view-inbox': 'failed' })
  assert.deepEqual(worst, { 'view-inbox': 'failed', login: 'failed', 'open-board': 'skipped', 'ai-chat': 'passed' })
  const graded = gradeFeatures(plan, tagStatuses(report), {})
  assert.deepEqual(graded.map((feature) => [feature.area, feature.verdict]), [
    ['Inbox', 'pass'], ['Login', 'fail'], ['Drag', 'not-drivable'], ['Figma', 'not-drivable'],
  ])
  assert.match(summaryLines(graded).join('\n'), /Pass: 1\nFail: 1\nNot drivable: 2/)
})

function fetchFor(routes, calls = []) {
  return async (url, init = {}) => {
    const target = new URL(url).pathname + new URL(url).search
    const hit = routes.find((route) => route.when(target))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    const body = typeof hit.body === 'function' ? hit.body(JSON.parse(init.body ?? '{}')) : hit.body
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
    return { ok: true, status: 200, json: async () => body }
  }
}

const openTicket = { when: (url) => url.startsWith('/api/mcp/tasks/search'), body: { success: true, total: 1, tasks: [{ id: 7, title: TICKET_TITLE, uniqueIndex: 7 }] } }
const noTicket = { when: (url) => url.startsWith('/api/mcp/tasks/search'), body: { success: true, total: 0, tasks: [] } }

test('a failure files one board 15 ticket, a repeat updates it, a clean run archives it', async () => {
  const create = { when: (url) => url === '/api/mcp/tasks/create', body: { success: true, task: { id: 7, ticketNumber: 'HTPR-7', uniqueIndex: 7 } } }
  const createdCalls = []
  const created = await fileFindings({
    graded: failing, problems: ['login.md: missing file: gone.md'], runUrl: 'https://run', token: 'test-token',
    fetchImpl: fetchFor([noTicket, create, { when: (url) => url === '/api/mcp/comments', body: { success: true } }], createdCalls),
  })
  const body = createdCalls.find((call) => call.url.endsWith('/api/mcp/tasks/create')).body
  assert.equal(created.url, `https://app.hypertask.ai/detail/project-${BOARD.projectId}/7`)
  assert.equal(body.title, TICKET_TITLE)
  assert.match(body.description, /1 mapped features failed/)
  assert.match(body.description, /login\.md: missing file: gone\.md/)
  const updatedCalls = []
  const updated = await fileFindings({ graded: failing, token: 'test-token',
    fetchImpl: fetchFor([openTicket, { when: (url) => url === '/api/mcp/comments', body: { success: true } }], updatedCalls) })
  assert.equal(updated.action, 'updated')
  assert.equal(updatedCalls.some((call) => call.url.endsWith('/api/mcp/tasks/create')), false)
  const archived = await fileFindings({ graded: passing, token: 'test-token',
    fetchImpl: fetchFor([openTicket, { when: (url) => url === '/api/mcp/comments', body: { success: true } },
      { when: (url) => url === '/api/mcp/tasks/update', body: { success: true } }]) })
  assert.equal(archived.action, 'archived')
  assert.equal(await fileFindings({ graded: passing, token: 'test-token', fetchImpl: fetchFor([noTicket]) }), null)
  assert.equal((await fileFindings({ graded: gradeFeatures(inboxPlan, {}, {}), token: 'test-token',
    fetchImpl: fetchFor([openTicket, { when: (url) => url === '/api/mcp/comments', body: { success: true } }]) })).action, 'updated')
  const crashed = await fileFindings({ graded: passing, suiteErrors: ['journeys set up failed'], token: 'test-token',
    fetchImpl: fetchFor([noTicket, create, { when: (url) => url === '/api/mcp/comments', body: { success: true } }]) })
  assert.equal(crashed.action, 'created')
})

test('drives reach production only when the live switch is on', () => {
  const previous = process.env.FEATURE_MAP_LIVE
  delete process.env.FEATURE_MAP_LIVE
  assert.equal(driveBaseAllowed('http://127.0.0.1:3100'), true)
  assert.equal(driveBaseAllowed('https://app.hypertask.ai'), false)
  assert.equal(driveBaseAllowed('https://example.com'), false)
  process.env.FEATURE_MAP_LIVE = '1'
  assert.equal(driveBaseAllowed('https://app.hypertask.ai'), true)
  assert.equal(driveBaseAllowed('https://preview.hypertask.ai'), false)
  if (previous === undefined) delete process.env.FEATURE_MAP_LIVE
  else process.env.FEATURE_MAP_LIVE = previous
})
