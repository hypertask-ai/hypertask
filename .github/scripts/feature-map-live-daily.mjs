#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, findOpenWeeklyTicket } from './feature-map-live-weekly-file.mjs'
import { LIVE_OPT_IN } from '../../.claude/skills/verify-hypertask/scripts/drive-grade.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const APP = 'https://app.hypertask.ai'
export const MAP_INDEX = '.claude/skills/verify-hypertask/features/README.md'
export const DRIVE_DIR = '.claude/skills/verify-hypertask/scripts'
export const BOARD = { projectId: 15, sectionId: 38903 }
export const TICKET_TITLE = 'Feature map live: mapped features failing'
export const QA_BOARD_PATH = '/project?id=7049&surface=board'
export const OUT = 'feature-map-live'
export const SMOKE_FIXTURES = { SMOKE_BOARD_PATH: '/project?id=6121&surface=board', SMOKE_TASK_PATH: '/detail/project-6121/1' }
const QA_STATE = 'e2e/smoke/.state/smoke-state.json'
const SUITES = [
  { file: 'e2e/smoke/prod.spec.ts', project: 'Desktop' },
  { file: 'e2e/smoke/journeys.spec.ts', project: 'journeys' },
  { file: 'e2e/smoke/journeys.spec.ts', project: 'mobile-journeys' },
]
const RANK = { passed: 0, skipped: 1, failed: 2, timedOut: 2, interrupted: 2 }

export const readMapRows = (markdown) => markdown.split('\n').flatMap((line) => {
  const cells = line.trim().split('|').map((cell) => cell.trim())
  const link = /^\[[^\]]*\]\(([^)\s]+\.md)\)$/.exec(cells[2] ?? '')
  return cells.length < 5 || !link ? [] : [{ area: cells[1], file: link[1], tokens: [...cells[3].matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()) }]
})

const DRIVE_SCRIPT = /^([\w.-]+\.mjs)(?:\s+(.+))?$/

export function parseDriveToken(token, scripts) {
  const match = DRIVE_SCRIPT.exec(token.trim())
  if (match && scripts.includes(match[1])) {
    const args = match[2] ? match[2].trim().split(/\s+/) : []
    return { script: match[1], args, token: token.trim() }
  }
  const pathy = /(?:^|\/)(([\w.-]+)\.mjs)\s*$/.exec(token.trim())
  return pathy && scripts.includes(pathy[1]) ? { script: pathy[1], args: [], token: pathy[1] } : null
}

export function driveScriptName(token, scripts) {
  return parseDriveToken(token, scripts)?.script ?? null
}

export function driveInvocationKey(invocation) {
  return invocation.args.length ? `${invocation.script}\0${invocation.args.join('\0')}` : invocation.script
}

export function planFeatures(rows, { tags, scripts }) {
  return rows.map(({ area, file, tokens }) => {
    const tagged = tokens.filter((token) => tags.includes(token))
    const invocations = []
    const seen = new Set()
    for (const token of tokens) {
      const parsed = parseDriveToken(token, scripts)
      if (!parsed) continue
      const key = driveInvocationKey(parsed)
      if (seen.has(key)) continue
      seen.add(key)
      invocations.push(parsed)
    }
    const drives = [...new Set(invocations.map((invocation) => invocation.script))]
    const missing = tokens.filter((token) => /\.mjs\b/.test(token) && !parseDriveToken(token, scripts))
    const drivable = tagged.length + invocations.length > 0
    return { area, file, tags: tagged, scripts: drives, invocations, missing, drivable,
      reason: drivable ? '' : `the map names no live driver${tokens.length ? ` (${tokens.join('; ')})` : ''}` }
  })
}

export function tagStatuses(report) {
  const statuses = {}
  const mark = (id, status) => { if (!(id in statuses) || (RANK[status] ?? 2) > (RANK[statuses[id]] ?? 2)) statuses[id] = status }
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).map((test) => test.results?.at(-1)?.status ?? test.status ?? 'failed')
      const status = results.sort((a, b) => (RANK[b] ?? 2) - (RANK[a] ?? 2))[0] ?? (spec.ok ? 'passed' : 'failed')
      const tags = [...(spec.tags ?? []), ...(spec.tests ?? []).flatMap((test) => test.tags ?? [])]
      for (const tag of tags.filter((tag) => String(tag).startsWith('id:'))) mark(String(tag).slice(3), status)
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

export const verdictOf = (status) =>
  status === 'passed' || status === 'ok' ? 'pass'
    : status === 'unreachable' ? 'unreachable'
    : status === 'skipped' || status === 'not-run' ? 'not-drivable' : 'fail'

export function driveResultStatus(child, output = '') {
  if (child.status === 0) return 'ok'
  const head = (output || `${child.stdout ?? ''}${child.stderr ?? ''}`).split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  if (child.status === 4 || /^UNREACHABLE missing state:/.test(head)) return 'unreachable'
  return 'failed'
}

export function unreachableAccount(output = '') {
  const line = output.split('\n').find((entry) => /UNREACHABLE missing state:/.test(entry)) ?? ''
  const match = /UNREACHABLE missing state: (\w+)/.exec(line)
  return match?.[1] ?? 'extra'
}

export function gradeFeatures(plan, tagStatus, scriptStatus) {
  return plan.map((feature) => {
    const invocations = feature.invocations ?? []
    const targets = [
      ...feature.tags.map((id) => ({ target: `@id:${id}`, status: tagStatus[id] ?? 'skipped' })),
      ...invocations.map((invocation) => ({
        target: invocation.args.length ? `${invocation.script} ${invocation.args.join(' ')}` : invocation.script,
        status: scriptStatus[driveInvocationKey(invocation)] ?? 'not-run',
      })),
    ]
    const verdicts = targets.map((entry) => verdictOf(entry.status))
    return { ...feature, targets,
      verdict: !feature.drivable ? 'not-drivable' : verdicts.includes('fail') ? 'fail'
        : verdicts.includes('unreachable') ? 'unreachable'
        : verdicts.includes('pass') ? 'pass' : 'not-drivable' }
  })
}

export const brokenTargets = (feature) => feature.targets
  .filter((entry) => verdictOf(entry.status) === 'fail').map((entry) => `${entry.target} (${entry.status})`)

const driver = (feature) => [
  ...feature.tags.map((id) => `@id:${id}`),
  ...(feature.invocations ?? []).map((invocation) => invocation.args.length
    ? `${invocation.script} ${invocation.args.join(' ')}` : invocation.script),
].join(', ') || feature.reason

export function summaryLines(graded, { problems = [], ticketUrl = '', suiteErrors = [] } = {}) {
  const counts = Object.groupBy(graded, (feature) => feature.verdict)
  const lines = ['## Daily feature-map live pass', '', `Mapped features: ${graded.length}`, `Pass: ${(counts.pass ?? []).length}`,
    `Fail: ${(counts.fail ?? []).length}`, `Unreachable: ${(counts.unreachable ?? []).length}`,
    `Not drivable: ${(counts['not-drivable'] ?? []).length}`]
  if (ticketUrl) lines.push(`Ticket: ${ticketUrl}`)
  lines.push('', '| Area | Verdict | Driver |', '|---|---|---|',
    ...graded.map((feature) => `| ${feature.area} | ${feature.verdict} | ${driver(feature)} |`))
  for (const feature of graded.filter((entry) => entry.verdict === 'fail')) lines.push('', `- ${feature.area}: ${brokenTargets(feature).join(', ')}`)
  for (const feature of graded.filter((entry) => entry.verdict === 'unreachable')) {
    const log = feature.unreachableReason ?? `needs ${unreachableAccount('')} login on the runner`
    lines.push('', `- ${feature.area}: ${log}`)
  }
  if (problems.length) lines.push('', '### Stale map entries', ...problems.map((entry) => `- ${entry}`))
  if (suiteErrors.length) lines.push('', '### Suite errors', ...suiteErrors.map((entry) => `- ${entry}`))
  return lines
}

const FILE_TOKEN = /\b[\w./-]+\.(?:mjs|cjs|tsx?|md)\b/g

export function scrubFileTokens(text) {
  return String(text).replace(FILE_TOKEN, 'driver').replace(/\s+/g, ' ').trim()
}

export function ticketDescription({ graded, problems = [], suiteErrors = [] }) {
  const failures = graded.filter((feature) => feature.verdict === 'fail')
  const list = (entries) => `<ul>${entries.map((entry) => `<li>${entry}</li>`).join('')}</ul>`
  const body = [
    `<p><strong>What's wrong or wanted:</strong> ${failures.length} mapped areas failed today's daily live pass.</p>`,
    '<p><strong>Who it affects:</strong> internal verification only.</p>',
    '<p><strong>Recommended course and why:</strong> Fix or re-map each failed area. Keeps daily signal useful.</p>',
    '<p><strong>What Valentin must decide:</strong> nothing.</p>',
    '<p><strong>How to undo:</strong> disable the feature-map live daily schedule.</p>',
    '<hr><h2>Problem</h2>',
    failures.length ? list(failures.map((feature) => feature.area)) : '',
    problems.length ? list(problems.map(scrubFileTokens)) : '',
    suiteErrors.length ? list(suiteErrors.map(scrubFileTokens)) : '',
    '<h2>Fix</h2><p>Each listed area passes on the next daily run.</p><p>Or its map entry is corrected.</p>',
    '<h2>Done when</h2><p>One daily run reports pass or not drivable for each mapped feature.</p>',
    '<h2>Risk</h2><p>Low. Internal verification only.</p>',
    '<h2>Decision</h2><p>Nothing.</p>',
  ].filter(Boolean).join('')
  if (body.match(FILE_TOKEN)) throw new Error('ticket description must not contain file names')
  return body
}

export async function fileFindings({ graded, problems = [], suiteErrors = [], runUrl = '', token, fetchImpl = fetch, now = new Date() }) {
  const failing = graded.some((feature) => feature.verdict === 'fail')
  const options = { token, fetchImpl, projectId: BOARD.projectId }
  const existing = await findOpenWeeklyTicket(TICKET_TITLE, options)
  const comment = (ticket, text) => api('comments', { ...options, method: 'POST',
    body: { ticket_number: ticket.ticketNumber ?? `HTPR-${ticket.uniqueIndex}`, project_id: BOARD.projectId, kind: 'qa', text, content_type: 'html' } })
  const passing = graded.some((feature) => feature.verdict === 'pass')
  const unreachable = graded.some((feature) => feature.verdict === 'unreachable')
  if (!failing && !problems.length && !suiteErrors.length) {
    if (!passing || unreachable) return null
    if (!existing) return null
    const note = `<p>Every mapped feature passed the daily live pass on ${now.toISOString().slice(0, 10)}. Archived.</p>`
    await comment(existing, note)
    await api('tasks/update', { ...options, method: 'POST', body: { task_id: existing.id, status: 'Archive' } })
    return { url: `${APP}/detail/project-${BOARD.projectId}/${existing.uniqueIndex}`, action: 'archived' }
  }
  const description = ticketDescription({ graded, problems, suiteErrors })
  const ticket = existing ?? (await api('tasks/create', { ...options, method: 'POST',
    idempotencyKey: `feature-map-live-daily-${now.toISOString().slice(0, 10)}`,
    body: { project_id: BOARD.projectId, section_id: BOARD.sectionId, title: TICKET_TITLE, description, content_type: 'html' } })).task
  if (existing) await comment(ticket, description)
  return { url: `${APP}/detail/project-${BOARD.projectId}/${ticket.uniqueIndex}`, action: existing ? 'updated' : 'created', runUrl }
}

function runSuite(suite, dir) {
  const report = path.join(dir, `${suite.project}.json`)
  const child = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.config.smoke.ts', suite.file,
    '--project', suite.project, '--grep', '@id:', '--reporter=json'], { cwd: root, encoding: 'utf8', timeout: 12 * 60 * 1000,
    env: { ...process.env, ...SMOKE_FIXTURES, SMOKE_BASE_URL: APP, SMOKE_POSTDEPLOY: '1', HT_QA_JOURNEYS: '1',
      PLAYWRIGHT_JSON_OUTPUT_NAME: report, PLAYWRIGHT_JSON_OUTPUT_DIR: dir } })
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
    '--state', QA_STATE, '--board', QA_BOARD_PATH], { cwd: root, encoding: 'utf8', timeout: 4 * 60 * 1000 })
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`
  writeFileSync(path.join(folder, 'drive.log'), output)
  return driveResultStatus(child, output)
}

function runFeatureMapDrive(area, dir) {
  const folder = path.join(dir, `feature-map-drive-${area}`)
  mkdirSync(folder, { recursive: true })
  const child = spawnSync(process.execPath, [path.join(DRIVE_DIR, 'feature-map-drive.mjs'), area, '--dir', folder],
    { cwd: root, encoding: 'utf8', timeout: 4 * 60 * 1000, env: { ...process.env, FEATURE_MAP_LIVE: '1' } })
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`
  writeFileSync(path.join(folder, 'drive.log'), output)
  return { status: driveResultStatus(child, output), output }
}

function runInvocation(invocation, dir) {
  if (invocation.script === 'feature-map-drive.mjs' && invocation.args[0]) {
    return runFeatureMapDrive(invocation.args[0], dir)
  }
  return { status: runDrive(invocation.script, dir), output: '' }
}

function ensureQaFlagsState() {
  const stateFile = path.join(process.env.HOME ?? os.homedir(), '.config/hypertask-videos/storageState-qa.json')
  if (existsSync(stateFile)) return
  const smoke = path.join(root, QA_STATE)
  if (existsSync(smoke)) {
    mkdirSync(path.dirname(stateFile), { recursive: true })
    copyFileSync(smoke, stateFile)
    return
  }
  const htVerify = path.join(root, '.claude/skills/verify-hypertask/bin/ht-verify')
  const child = spawnSync(htVerify, ['login', 'flags', '--state', stateFile, '--base', APP, '--expect', '985'],
    { cwd: root, encoding: 'utf8', timeout: 3 * 60 * 1000, env: process.env })
  if (child.status !== 0) {
    throw new Error(`ht-verify login flags failed before feature-map drives (exit ${child.status})`)
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('feature-map-live-daily runs only on a GitHub-hosted runner, never the VPS')
  }
  if (process.env[LIVE_OPT_IN] !== '1') {
    throw new Error(`feature-map-live-daily needs ${LIVE_OPT_IN}=1 to drive production, set by its workflow step`)
  }
  const dir = path.join(root, OUT)
  mkdirSync(dir, { recursive: true })
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env
  const runUrl = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : ''

  const tagStatus = {}, suiteErrors = []
  for (const suite of SUITES) {
    const run = runSuite(suite, dir)
    mergeTagStatus(tagStatus, tagStatuses(run.report))
    suiteErrors.push(...run.errors)
    if (run.status !== 0 && !(run.report.suites ?? []).length) suiteErrors.push(`${suite.file}: run exited ${run.status}`)
  }

  const scripts = readdirSync(path.join(root, DRIVE_DIR)).filter((name) => name.endsWith('.mjs'))
  const plan = planFeatures(readMapRows(readFileSync(path.join(root, MAP_INDEX), 'utf8')), { tags: Object.keys(tagStatus), scripts })
  const scriptStatus = {}
  const invocations = [...new Map(plan.flatMap((feature) => feature.invocations.map((invocation) => {
    const key = driveInvocationKey(invocation)
    return [key, invocation]
  }))).values()]
  if (invocations.some((invocation) => invocation.script === 'feature-map-drive.mjs')) ensureQaFlagsState()
  const unreachableNotes = {}
  for (const invocation of invocations) {
    const key = driveInvocationKey(invocation)
    const run = runInvocation(invocation, dir)
    scriptStatus[key] = run.status
    if (run.status === 'unreachable') {
      const account = unreachableAccount(run.output ?? '')
      unreachableNotes[key] = `needs ${account} login on the runner`
    }
  }

  const graded = gradeFeatures(plan, tagStatus, scriptStatus).map((feature) => {
    const invocation = feature.invocations?.find((entry) => scriptStatus[driveInvocationKey(entry)] === 'unreachable')
    const note = invocation ? unreachableNotes[driveInvocationKey(invocation)] : ''
    return note ? { ...feature, unreachableReason: note } : feature
  })
  const problems = graded.flatMap((feature) => feature.missing.map(() => `${feature.area}: the map names a drive script that is missing from the repo`))

  writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ runUrl, tagStatus, scriptStatus, graded, problems, suiteErrors }, null, 2))
  let filing = ''
  const ticket = await fileFindings({ graded, problems, suiteErrors, runUrl, token: process.env.HYPERTASK_MCP_TOKEN }).catch((error) => { filing = error.message; return null })
  const lines = summaryLines(graded, { problems, suiteErrors, ticketUrl: ticket?.url ?? '' })
  if (ticket) lines.push('', `Ticket ${ticket.action}: ${ticket.url || 'none'}`)
  if (filing) lines.push('', `Ticket filing failed: ${filing}`)
  const text = `${lines.join('\n')}\n`
  writeFileSync(path.join(dir, 'summary.md'), text)
  process.stdout.write(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)

  const failing = graded.filter((feature) => feature.verdict === 'fail').length
  const passing = graded.filter((feature) => feature.verdict === 'pass').length
  const unreachable = graded.filter((feature) => feature.verdict === 'unreachable').length
  if (failing || !passing || problems.length || suiteErrors.length || filing) {
    throw new Error(`feature map live pass: ${failing} failing, ${passing} passing, ${unreachable} unreachable, ${problems.length} stale, ${suiteErrors.length} suite errors`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`feature-map-live-daily: ${error.message}`)
    process.exitCode = 1
  })
}
