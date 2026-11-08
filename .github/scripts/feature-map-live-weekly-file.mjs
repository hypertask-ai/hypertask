import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function isoWeek(now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const thursday = new Date(day)
  thursday.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7)
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function weeklyLiveTitle(week = isoWeek()) {
  return `Weekly feature-map live ${week}`
}

export function countSteps(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const pass = steps.filter((step) => step.pass).length
  const fail = steps.length - pass
  return { pass, fail, total: steps.length, verdict: result?.verdict || 'FAIL' }
}

export function buildActivity({ week, runUrl, artifactUrl, counts, sha }) {
  return [
    `feature-map-live-weekly ${week}`,
    `Pass: ${counts.pass}`,
    `Fail: ${counts.fail}`,
    `Verdict: ${counts.verdict}`,
    `SHA: ${sha || 'unknown'}`,
    runUrl ? `Run: ${runUrl}` : null,
    artifactUrl ? `Evidence: ${artifactUrl}` : null,
  ].filter(Boolean).join('\n')
}

export function buildDescription({ week, counts, sha, runUrl, artifactUrl }) {
  const lines = [
    `<p>Weekly live feature-map check on a disposable seeded stack (loopback verify-qa). Not production.</p>`,
    `<p>ISO week: ${week}</p>`,
    `<p>Pass: ${counts.pass}; Fail: ${counts.fail}; Verdict: ${counts.verdict}</p>`,
    sha ? `<p>Commit: <code>${sha}</code></p>` : '',
    runUrl ? `<p><a href="${runUrl}">GitHub Actions run</a></p>` : '',
    artifactUrl ? `<p>Evidence artifact: ${artifactUrl}</p>` : '',
    '<p>A runner picks drift tickets filed by the source-only timer with /ship and runs listed recipes after deploy.</p>',
  ].filter(Boolean)
  return lines.join('\n')
}

function runCli(binary, args, { execImpl = execFileSync, env = process.env, json = true } = {}) {
  const cliArgs = json ? [...args, '--json'] : args
  const output = execImpl(binary, cliArgs, {
    encoding: 'utf8',
    env,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!json) return output
  const payload = JSON.parse(output)
  if (payload.success === false) throw new Error(`Board CLI ${binary} ${args.slice(0, 2).join(' ')} failed`)
  return payload
}

export function boardRead(args, options = {}) {
  return runCli('hypertask', args, options)
}

export function boardWrite(args, options = {}) {
  return runCli('vcc', args, options)
}

function normalizeActivityText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function parseActivityList(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      if (tab === -1) return { text: line }
      const next = line.indexOf('\t', tab + 1)
      if (next === -1) return { text: line.slice(tab + 1) }
      return { text: line.slice(next + 1) }
    })
}

function boardActivityList(ticketRef, options = {}) {
  const output = runCli('vcc', ['activity', 'list', ticketRef], { ...options, json: false })
  return parseActivityList(output)
}

function boardActivityAdd(ticketRef, text, options = {}) {
  runCli('vcc', ['activity', 'add', ticketRef, '--text', text], { ...options, json: false })
}

export async function findOpenWeeklyTicket(title, options = {}) {
  for (const status of ['Normal', 'Archive', 'Deleted']) {
    const search = boardRead(['task', 'list', '--project', '11514', '--status', status, '--search', title], options)
    if (!Array.isArray(search.tasks)) throw new Error('Weekly live ticket search returned no task list')
    const existing = search.tasks.find((task) => task.title === title && task.section !== 'Done')
    if (existing) return existing
  }
  return null
}

async function loadEvidence(evidenceDir) {
  let result = {}
  try {
    result = JSON.parse(await readFile(path.join(evidenceDir, 'result.json'), 'utf8'))
  } catch {
    try { result = JSON.parse(await readFile(path.join(evidenceDir, 'run.json'), 'utf8')) } catch {}
  }
  if (!result.sha) {
    try {
      const run = JSON.parse(await readFile(path.join(evidenceDir, 'run.json'), 'utf8'))
      if (run.sha) result.sha = run.sha
    } catch {}
  }
  return result
}

export async function fileWeeklyLiveResult({
  evidenceDir = 'verify-qa',
  runUrl = '',
  artifactUrl = '',
  week = isoWeek(),
  execImpl = execFileSync,
  env = process.env,
} = {}) {
  const cli = { execImpl, env }
  const result = await loadEvidence(evidenceDir)
  const counts = countSteps(result)
  const title = weeklyLiveTitle(week)
  const activity = buildActivity({ week, runUrl, artifactUrl, counts, sha: result.sha })
  let ticket = await findOpenWeeklyTicket(title, cli)
  if (!ticket) {
    const description = buildDescription({ week, counts, sha: result.sha, runUrl, artifactUrl })
    const created = boardWrite([
      'task', 'create',
      '--project', '11514',
      '--title', title,
      '--description', description,
      '--labels', 'CI,Hypertask CI,brain-light',
    ], cli)
    ticket = created.task || created.tasks?.[0]
  }
  if (!Number.isSafeInteger(ticket?.id) || ticket.id < 1) throw new Error('Weekly live ticket returned no task id')
  const ticketRef = ticket.ticketNumber || `HYCI-${ticket.uniqueIndex}`
  const marker = `feature-map-live-weekly ${week}`
  const note = `${marker}\n${activity}`
  const rows = boardActivityList(ticketRef, cli)
  const normalizedNote = normalizeActivityText(note)
  const prior = rows.find((row) => (row.text || '').includes(marker))
  if (prior && normalizeActivityText(prior.text) === normalizedNote) {
    return { ticketId: ticket.id, uniqueIndex: ticket.uniqueIndex, duplicate: true, counts }
  }
  boardActivityAdd(ticketRef, note, cli)
  return { ticketId: ticket.id, uniqueIndex: ticket.uniqueIndex, duplicate: false, counts }
}

async function main() {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  const runUrl = server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : ''
  const outcome = await fileWeeklyLiveResult({
    runUrl,
    artifactUrl: process.env.FEATURE_MAP_LIVE_ARTIFACT_URL || '',
    week: process.env.FEATURE_MAP_LIVE_WEEK || isoWeek(),
  })
  const summary = [
    '## Weekly feature-map live',
    '',
    `Ticket: https://app.hypertask.ai/detail/project-11514/${outcome.uniqueIndex}`,
    `Pass: ${outcome.counts.pass}`,
    `Fail: ${outcome.counts.fail}`,
    `Verdict: ${outcome.counts.verdict}`,
    outcome.duplicate ? 'Board note: already recorded this week.' : 'Board note: recorded.',
    '',
  ].join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
