const { test } = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const {
  BOARD, MAP_INDEX, TICKET_TITLE, readMapRows, driveScriptName, parseDriveToken, driveInvocationKey,
  planFeatures, tagStatuses, gradeFeatures, mergeTagStatus, summaryLines, fileFindings, ticketDescription,
  verdictOf, driveResultStatus, unreachableAccount,
} = require('../.github/scripts/feature-map-live-daily.mjs')
const { spawnSync } = require('node:child_process')

const rows = readMapRows(readFileSync(path.join(__dirname, '..', MAP_INDEX), 'utf8'))
const inboxPlan = planFeatures([{ area: 'Inbox', file: 'inbox.md', tokens: ['view-inbox'] }], { tags: ['view-inbox'], scripts: [] })
const failing = gradeFeatures(inboxPlan, { 'view-inbox': 'failed' }, {})
const passing = gradeFeatures(inboxPlan, { 'view-inbox': 'passed' }, {})
const report = { suites: [{ specs: [{ tags: ['id:view-inbox', 'mobile'], tests: [{ results: [{ status: 'passed' }] }] }], suites: [
  { specs: [{ tags: ['id:login'], tests: [{ results: [{ status: 'failed' }] }] }] },
  { specs: [{ tags: ['id:open-board'], tests: [{ results: [{ status: 'skipped' }] }] }, { tags: ['id:ai-chat'], tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }] }] },
] }] }
const passStep = yaml.load(readFileSync('.github/workflows/feature-map-live-daily.yml', 'utf8'))
  .jobs['live-pass'].steps.find((step) => step.run?.includes('.github/scripts/feature-map-live-daily.mjs'))
test('the map index gives one row per area and a driver only when the map names one', () => {
  assert.ok(rows.length >= 55, `read ${rows.length} rows`)
  assert.equal(passStep.env.FEATURE_MAP_LIVE, '1', 'the pass step needs the live opt-in')
  assert.deepEqual(rows.find((row) => row.file === 'inbox.md').tokens.slice(0, 1), ['view-inbox'])
  const scripts = ['board-drive-live.mjs', 'feature-map-drive.mjs']
  assert.equal(driveScriptName('node .claude/skills/verify-hypertask/scripts/board-drive-live.mjs', scripts), 'board-drive-live.mjs')
  assert.deepEqual(parseDriveToken('feature-map-drive.mjs activation-analytics', scripts), {
    script: 'feature-map-drive.mjs', args: ['activation-analytics'], token: 'feature-map-drive.mjs activation-analytics',
  })
  const plan = planFeatures(rows, { tags: ['view-inbox', 'open-board'], scripts })
  assert.deepEqual(plan.find((feature) => feature.file === 'inbox.md').tags, ['view-inbox'])
  assert.deepEqual(plan.find((feature) => feature.file === 'boards-and-views.md').scripts.sort(), scripts.sort())
  const activation = plan.find((feature) => feature.file === 'activation-analytics.md')
  assert.ok(activation.drivable)
  assert.deepEqual(activation.invocations.map(driveInvocationKey), ['feature-map-drive.mjs\0activation-analytics'])
  const commandPalette = plan.find((feature) => feature.file === 'command-palette.md')
  assert.equal(commandPalette.scripts.includes('ctrl-j-drive.mjs'), false)
  const canary = plan.find((feature) => feature.file === 'model-canary.md')
  assert.match(canary.reason, /no live driver/)
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
  assert.match(summaryLines(graded).join('\n'), /Pass: 1\nFail: 1\nUnreachable: 0\nNot drivable: 2/)
})

test('missing runner logins grade unreachable, not fail', () => {
  const plan = planFeatures([
    { area: 'Billing', file: 'billing-and-plans.md', tokens: ['feature-map-drive.mjs billing-and-plans'], tags: [], scripts: ['feature-map-drive.mjs'],
      invocations: [{ script: 'feature-map-drive.mjs', args: ['billing-and-plans'], token: 'feature-map-drive.mjs billing-and-plans' }],
      missing: [], drivable: true, reason: '' },
    { area: 'Inbox', file: 'inbox.md', tokens: ['view-inbox'], tags: ['view-inbox'], scripts: [], invocations: [], missing: [], drivable: true, reason: '' },
  ], { tags: ['view-inbox'], scripts: ['feature-map-drive.mjs'] })
  const graded = gradeFeatures(plan, { 'view-inbox': 'passed' }, { 'feature-map-drive.mjs\0billing-and-plans': 'unreachable' })
  assert.deepEqual(graded.map((feature) => [feature.area, feature.verdict]), [['Billing', 'unreachable'], ['Inbox', 'pass']])
  assert.equal(verdictOf('unreachable'), 'unreachable')
  const output = 'UNREACHABLE missing state: pro\n'
  assert.equal(driveResultStatus({ status: 4, stdout: '', stderr: output }, output), 'unreachable')
  assert.equal(unreachableAccount(output), 'pro')
  const summary = summaryLines(graded.map((feature) => feature.area === 'Billing'
    ? { ...feature, unreachableReason: 'needs pro login on the runner' } : feature)).join('\n')
  assert.match(summary, /Unreachable: 1/)
  assert.match(summary, /needs pro login on the runner/)
})

test('unreachable alone does not file a failure ticket', async () => {
  const plan = planFeatures([
    { area: 'Billing', file: 'billing-and-plans.md', tokens: [], tags: [], scripts: [], invocations: [],
      missing: [], drivable: true, reason: '', verdict: 'unreachable',
      targets: [{ target: 'feature-map-drive.mjs billing-and-plans', status: 'unreachable' }] },
  ], { tags: [], scripts: [] })
  const unreachableOnly = [{ ...plan[0], verdict: 'unreachable', targets: [{ target: 'driver', status: 'unreachable' }] }]
  assert.equal(await fileFindings({ graded: unreachableOnly, token: 'test-token', fetchImpl: fetchFor([noTicket]) }), null)
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
const commented = { when: (url) => url === '/api/mcp/comments', body: { success: true } }
const archivedComment = { when: (url) => url === '/api/mcp/tasks/update', body: { success: true } }

test('a failure files one board 15 ticket, a repeat updates it, a clean run archives it', async () => {
  const create = { when: (url) => url === '/api/mcp/tasks/create', body: { success: true, task: { id: 7, ticketNumber: 'HTPR-7', uniqueIndex: 7 } } }
  const createdCalls = []
  const created = await fileFindings({
    graded: failing, problems: ['Login: the map names a drive script that is missing from the repo'],
    runUrl: 'https://run', token: 'test-token',
    fetchImpl: fetchFor([noTicket, create, commented], createdCalls),
  })
  const body = createdCalls.find((call) => call.url.endsWith('/api/mcp/tasks/create')).body
  assert.equal(created.url, `https://app.hypertask.ai/detail/project-${BOARD.projectId}/7`)
  assert.equal(body.title, TICKET_TITLE)
  assert.match(body.description, /1 mapped areas failed/)
  assert.match(body.description, /What Valentin must decide/)
  assert.doesNotMatch(body.description, /\.mjs|\.md\b/)
  const updatedCalls = []
  const updated = await fileFindings({ graded: failing, token: 'test-token', fetchImpl: fetchFor([openTicket, commented], updatedCalls) })
  assert.equal(updated.action, 'updated')
  assert.equal(updatedCalls.find((call) => call.url.endsWith('/api/mcp/comments')).body.ticket_number, 'HTPR-7')
  assert.equal(updatedCalls.some((call) => call.url.endsWith('/api/mcp/tasks/create')), false)
  const closed = await fileFindings({ graded: passing, token: 'test-token', fetchImpl: fetchFor([openTicket, commented, archivedComment]) })
  assert.equal(closed.action, 'archived')
  assert.equal(await fileFindings({ graded: passing, token: 'test-token', fetchImpl: fetchFor([noTicket]) }), null)
  assert.equal(await fileFindings({ graded: gradeFeatures(inboxPlan, {}, {}), token: 'test-token',
    fetchImpl: fetchFor([openTicket, commented, archivedComment]) }), null)
  const unreachableCalls = []
  const unreachableGraded = [
    { area: 'Inbox', verdict: 'pass', targets: [{ target: 'driver', status: 'passed' }] },
    { area: 'Billing', verdict: 'unreachable', targets: [{ target: 'driver', status: 'unreachable' }] },
  ]
  assert.equal(await fileFindings({ graded: unreachableGraded, token: 'test-token',
    fetchImpl: fetchFor([openTicket, commented, archivedComment], unreachableCalls) }), null)
  assert.equal(unreachableCalls.some((call) => call.url.endsWith('/api/mcp/comments') || call.url.endsWith('/api/mcp/tasks/update')), false)
  const crashed = await fileFindings({ graded: passing, suiteErrors: ['journeys set up failed'], token: 'test-token',
    fetchImpl: fetchFor([noTicket, create, commented]) })
  assert.equal(crashed.action, 'created')
})

test('ticket descriptions stay plain-language for board lint', () => {
  const graded = [
    { area: 'Billing', verdict: 'fail' },
    { area: 'Board invites', verdict: 'fail' },
    { area: 'Command palette', verdict: 'fail' },
  ]
  const html = ticketDescription({ graded, suiteErrors: ['journeys set up failed'] })
  assert.doesNotMatch(html, /\.mjs|\.md\b|\.ts\b/)
  const words = (sentence) => sentence.split(/\s+/).filter(Boolean).length
  const plain = html.replace(/<[^>]+>/g, '\n')
  for (const line of plain.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    for (const sentence of line.split(/(?<=[.!?:;])\s+/).filter(Boolean)) {
      assert.ok(words(sentence) <= 12, `too long: ${sentence}`)
    }
  }
  const lintPath = `${process.env.HOME}/.claude/skills/hypertask/scripts/ticket-lint`
  if (!existsSync(lintPath)) return
  const lint = spawnSync(lintPath, ['--shape', '-'], { input: html, encoding: 'utf8' })
  assert.equal(lint.status, 0, lint.stderr)
})
