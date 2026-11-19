#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, findOpenWeeklyTicket } from './feature-map-live-weekly-file.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const APP = 'https://app.hypertask.ai'
export const MAP_INDEX = '.claude/skills/verify-qa/reference/feature-map/INDEX.md'
export const DRIVE_DIR = '.claude/skills/verify-qa/scripts'
export const BOARD = { projectId: 15, sectionId: 38903 }
export const TICKET_TITLE = 'Feature map live: mapped features failing'
export const QA_BOARD_PATH = '/project?id=7049&surface=board'
export const OUT = 'feature-map-live'
export const SMOKE_FIXTURES = { SMOKE_BOARD_PATH: '/project?id=6121&surface=board', SMOKE_TASK_PATH: '/detail/project-6121/1' }
const QA_STATE = 'e2e/smoke/.state/smoke-state.json'
const SUITES = [
  { file: 'e2e/smoke/prod.spec.ts', project: 'Desktop' },
  { file: 'e2e/smoke/journeys.spec.ts', project: 'journeys' },
]
const RANK = { passed: 0, skipped: 1, failed: 2, timedOut: 2, interrupted: 2 }

export function readMapRows(markdown) {
  return markdown.split('\n').flatMap((line) => {
    const cells = line.trim().split('|').map((cell) => cell.trim())
    const link = /^\[[^\]]*\]\(([^)\s]+\.md)\)$/.exec(cells[2] ?? '')
    if (cells.length < 5 || !link) return []
    return [{ area: cells[1], file: link[1], tokens: [...cells[3].matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()) }]
  })
}

export function driveScriptName(token, scripts) {
  const name = /([\w.-]+\.mjs)$/.exec(token)?.[1]
  return name && scripts.includes(name) ? name : null
}

export function planFeatures(rows, { tags, scripts }) {
  return rows.map(({ area, file, tokens }) => {
    const tagged = tokens.filter((token) => tags.includes(token))
    const drives = [...new Set(tokens.map((token) => driveScriptName(token, scripts)).filter(Boolean))]
    const missing = tokens.filter((token) => /\.mjs$/.test(token) && !driveScriptName(token, scripts))
    const drivable = tagged.length + drives.length > 0
    return { area, file, tags: tagged, scripts: drives, missing, drivable,
      reason: drivable ? '' : `the map names no live driver${tokens.length ? ` (${tokens.join('; ')})` : ''}` }
  })
}

export function tagStatuses(report) {
  const statuses = {}
  const mark = (id, status) => {
    if (!(id in statuses) || (RANK[status] ?? 2) > (RANK[statuses[id]] ?? 2)) statuses[id] = status
  }
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).map((test) => test.results?.at(-1)?.status ?? test.status ?? 'failed')
      const status = results.sort((a, b) => (RANK[b] ?? 2) - (RANK[a] ?? 2))[0] ?? (spec.ok ? 'passed' : 'failed')
      for (const tag of [...(spec.tags ?? []), ...(spec.tests ?? []).flatMap((test) => test.tags ?? [])]) {
        if (String(tag).startsWith('id:')) mark(String(tag).slice(3), status)
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return statuses
}

export function mergeTagStatus(into, from) {
  for (const [id, status] of Object.entries(from)) {
    if (!(id in into) || (RANK[status] ?? 2) > (RANK[into[id]] ?? 2)) into[id] = status
  }
}

export const verdictOf = (status) => status === 'passed' || status === 'ok' ? 'pass'
  : status === 'skipped' || status === 'not-run' ? 'not-drivable' : 'fail'

export function gradeFeatures(plan, tagStatus, scriptStatus) {
  return plan.map((feature) => {
    const targets = [
      ...feature.tags.map((id) => ({ target: `@id:${id}`, status: tagStatus[id] ?? 'skipped' })),
      ...feature.scripts.map((name) => ({ target: name, status: scriptStatus[name] ?? 'not-run' })),
    ]
    const verdicts = targets.map((entry) => verdictOf(entry.status))
    return { ...feature, targets,
      verdict: !feature.drivable ? 'not-drivable' : verdicts.includes('fail') ? 'fail'
        : verdicts.includes('pass') ? 'pass' : 'not-drivable' }
  })
}

export const brokenTargets = (feature) => feature.targets
  .filter((entry) => verdictOf(entry.status) === 'fail').map((entry) => `${entry.target} (${entry.status})`)

export function summaryLines(graded, { problems = [], ticketUrl = '', suiteErrors = [] } = {}) {
  const counts = Object.groupBy(graded, (feature) => feature.verdict)
  const driver = (feature) => [...feature.tags.map((id) => `@id:${id}`), ...feature.scripts].join(', ') || feature.reason
  const lines = ['## Daily feature-map live pass', '', `Mapped features: ${graded.length}`, `Pass: ${(counts.pass ?? []).length}`,
    `Fail: ${(counts.fail ?? []).length}`, `Not drivable: ${(counts['not-drivable'] ?? []).length}`]
  if (ticketUrl) lines.push(`Ticket: ${ticketUrl}`)
  lines.push('', '| Area | Verdict | Driver |', '|---|---|---|',
    ...graded.map((feature) => `| ${feature.area} | ${feature.verdict} | ${driver(feature)} |`))
  for (const feature of graded.filter((entry) => entry.verdict === 'fail')) lines.push('', `- ${feature.area}: ${brokenTargets(feature).join(', ')}`)
  if (problems.length) lines.push('', '### Stale map entries', ...problems.map((entry) => `- ${entry}`))
  if (suiteErrors.length) lines.push('', '### Suite errors', ...suiteErrors.map((entry) => `- ${entry}`))
  return lines
}

function ticketDescription({ graded, problems = [], suiteErrors = [], runUrl = '' }) {
  const failures = graded.filter((feature) => feature.verdict === 'fail')
  const list = (entries) => `<ul>${entries.map((entry) => `<li>${entry}</li>`).join('')}</ul>`
  return [
    `<p><strong>What's wrong or wanted:</strong> ${failures.length} mapped features failed the daily live pass.</p>`,
    `<p><strong>Who it affects:</strong> internal only. Customers see the pages these features drive.</p>`,
    '<p><strong>Recommended course and why:</strong> fix or re-map each entry below.</p>',
    '<p><strong>How to undo:</strong> turn the daily schedule off.</p><hr><h2>Problem</h2>',
    failures.length ? list(failures.map((feature) => `${feature.area}: ${brokenTargets(feature).join(', ')}`)) : '',
    problems.length ? list(problems) : '',
    suiteErrors.length ? list(suiteErrors) : '',
    '<h2>Fix</h2><p>Fix the failing feature or correct its map entry.</p>',
    '<h2>Done when</h2><p>One daily run passes every mapped feature.</p>',
    runUrl ? `<p>Run: ${runUrl}</p>` : '',
  ].filter(Boolean).join('')
}

export async function fileFindings({ graded, problems = [], suiteErrors = [], runUrl = '', token, fetchImpl = fetch, now = new Date() }) {
  const failing = graded.some((feature) => feature.verdict === 'fail')
  const options = { token, fetchImpl, projectId: BOARD.projectId }
  const existing = await findOpenWeeklyTicket(TICKET_TITLE, options)
  const comment = (ticket, text) => api('comments', { ...options, method: 'POST',
    body: { ticket_number: ticket.ticketNumber, project_id: BOARD.projectId, text, content_type: 'html' } })
  const passing = graded.some((feature) => feature.verdict === 'pass')
  if (!failing && passing && !problems.length && !suiteErrors.length) {
    if (!existing) return null
    await comment(existing, `<p>Every mapped feature passed the daily live pass on ${now.toISOString().slice(0, 10)}. Archived.</p>`)
    await api('tasks/update', { ...options, method: 'POST', body: { task_id: existing.id, status: 'Archive' } })
    return { url: `${APP}/detail/project-${BOARD.projectId}/${existing.uniqueIndex}`, action: 'archived' }
  }
  const description = ticketDescription({ graded, problems, suiteErrors, runUrl })
  const ticket = existing ?? (await api('tasks/create', { ...options, method: 'POST',
    idempotencyKey: `feature-map-live-daily-${now.toISOString().slice(0, 10)}`,
    body: { project_id: BOARD.projectId, section_id: BOARD.sectionId, title: TICKET_TITLE, description, content_type: 'html' } })).task
  if (existing) await comment(ticket, description)
  return { url: `${APP}/detail/project-${BOARD.projectId}/${ticket.uniqueIndex}`, action: existing ? 'updated' : 'created' }
}

function runSuite(suite, dir) {
  const report = path.join(dir, `${suite.project}.json`)
  const child = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.config.smoke.ts', suite.file,
    '--project', suite.project, '--grep', '@id:', '--reporter=json'], {
    cwd: root, encoding: 'utf8', timeout: 12 * 60 * 1000,
    env: { ...process.env, ...SMOKE_FIXTURES, SMOKE_BASE_URL: APP, SMOKE_POSTDEPLOY: '1', HT_QA_JOURNEYS: '1',
      PLAYWRIGHT_JSON_OUTPUT_NAME: report, PLAYWRIGHT_JSON_OUTPUT_DIR: dir },
  })
  let parsed = { suites: [], errors: [] }
  try { parsed = JSON.parse(readFileSync(report, 'utf8')) } catch {}
  writeFileSync(path.join(dir, `${suite.project}.log`), `${child.stdout ?? ''}${child.stderr ?? ''}`)
  const errors = (parsed.errors ?? []).map((error) => `${suite.file}: ${String(error.message ?? error).split('\n')[0]}`)
  return { status: child.status, report: parsed, errors }
}

function runDrive(name, dir) {
  const folder = path.join(dir, name.replace(/\.mjs$/, ''))
  mkdirSync(folder, { recursive: true })
  const child = spawnSync(process.execPath, [path.join(DRIVE_DIR, name), folder, '--base', APP,
    '--state', QA_STATE, '--board', QA_BOARD_PATH], {
    cwd: root, encoding: 'utf8', timeout: 4 * 60 * 1000,
  })
  writeFileSync(path.join(folder, 'drive.log'), `${child.stdout ?? ''}${child.stderr ?? ''}`)
  return child.status === 0 ? 'ok' : 'failed'
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('feature-map-live-daily runs only on a GitHub-hosted runner, never the VPS')
  }
  const dir = path.join(root, OUT)
  mkdirSync(dir, { recursive: true })
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env
  const runUrl = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : ''

  const tagStatus = {}
  const suiteErrors = []
  for (const suite of SUITES) {
    const run = runSuite(suite, dir)
    mergeTagStatus(tagStatus, tagStatuses(run.report))
    suiteErrors.push(...run.errors)
    if (run.status !== 0 && !(run.report.suites ?? []).length) suiteErrors.push(`${suite.file}: run exited ${run.status}`)
  }

  const scripts = readdirSync(path.join(root, DRIVE_DIR)).filter((name) => name.endsWith('.mjs'))
  const plan = planFeatures(readMapRows(readFileSync(path.join(root, MAP_INDEX), 'utf8')), { tags: Object.keys(tagStatus), scripts })
  const scriptStatus = {}
  for (const name of [...new Set(plan.flatMap((feature) => feature.scripts))]) scriptStatus[name] = runDrive(name, dir)

  const graded = gradeFeatures(plan, tagStatus, scriptStatus)
  const problems = graded.flatMap((feature) => feature.missing.map((token) => `${feature.file}: missing drive script: ${token}`))

  writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ runUrl, tagStatus, scriptStatus, graded, problems, suiteErrors }, null, 2))
  let filing = ''
  const ticket = await fileFindings({ graded, problems, suiteErrors, runUrl }).catch((error) => { filing = error.message; return null })
  const lines = summaryLines(graded, { problems, suiteErrors, ticketUrl: ticket?.url ?? '' })
  if (ticket) lines.push('', `Ticket ${ticket.action}: ${ticket.url || 'none'}`)
  if (filing) lines.push('', `Ticket filing failed: ${filing}`)
  const text = `${lines.join('\n')}\n`
  writeFileSync(path.join(dir, 'summary.md'), text)
  process.stdout.write(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)

  const failing = graded.filter((feature) => feature.verdict === 'fail').length
  const passing = graded.filter((feature) => feature.verdict === 'pass').length
  if (failing || !passing || problems.length || suiteErrors.length || filing) {
    throw new Error(`feature map live pass: ${failing} failing, ${passing} passing, ${problems.length} stale, ${suiteErrors.length} suite errors`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`feature-map-live-daily: ${error.message}`)
    process.exitCode = 1
  })
}
