import { readFile, appendFile } from 'node:fs/promises'
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

export const weeklyLiveTitle = (week = isoWeek()) => `Weekly feature-map live ${week}`

export function countSteps(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const pass = steps.filter((step) => step.pass).length
  return { pass, fail: steps.length - pass, total: steps.length, verdict: result?.verdict || 'FAIL' }
}

function runCli(binary, args, { execImpl = execFileSync, env = process.env, json = true } = {}) {
  const output = execImpl(binary, json ? [...args, '--json'] : args, {
    encoding: 'utf8', env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!json) return output
  const payload = JSON.parse(output)
  if (payload.success === false) throw new Error(`Board CLI ${binary} failed`)
  return payload
}

export const boardRead = (args, options) => runCli('hypertask', args, options)
export const boardWrite = (args, options) => runCli('vcc', args, options)

const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()

function activityRows(ticketRef, options) {
  return runCli('vcc', ['activity', 'list', ticketRef], { ...options, json: false })
    .split('\n').map((line) => line.trimEnd()).filter(Boolean)
    .map((line) => {
      const first = line.indexOf('\t')
      const second = first < 0 ? -1 : line.indexOf('\t', first + 1)
      return { text: second < 0 ? line.slice(first + 1) : line.slice(second + 1) }
    })
}

export async function findOpenWeeklyTicket(title, options = {}) {
  for (const status of ['Normal', 'Archive', 'Deleted']) {
    const payload = boardRead(['task', 'list', '--project', '11514', '--status', status, '--search', title], options)
    if (!Array.isArray(payload.tasks)) throw new Error('Weekly live ticket search returned no task list')
    const existing = payload.tasks.find((task) => task.title === title && task.section !== 'Done')
    if (existing) return existing
  }
  return null
}

async function loadEvidence(evidenceDir) {
  for (const name of ['result.json', 'run.json']) {
    try {
      const payload = JSON.parse(await readFile(path.join(evidenceDir, name), 'utf8'))
      if (payload.sha || payload.steps) return payload
    } catch {}
  }
  return {}
}

function activityBody({ week, counts, sha, runUrl, artifactUrl }) {
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
  const body = activityBody({ week, counts, sha: result.sha, runUrl, artifactUrl })
  let ticket = await findOpenWeeklyTicket(title, cli)
  if (!ticket) {
    const description = `<p>Weekly live feature-map on a disposable stack (week ${week}). Pass ${counts.pass}; fail ${counts.fail}; verdict ${counts.verdict}. Not production.</p>`
    const created = boardWrite([
      'task', 'create', '--project', '11514', '--title', title,
      '--description', description, '--labels', 'CI,Hypertask CI,brain-light',
    ], cli)
    ticket = created.task || created.tasks?.[0]
  }
  if (!Number.isSafeInteger(ticket?.id)) throw new Error('Weekly live ticket returned no task id')
  const ticketRef = ticket.ticketNumber || `HYCI-${ticket.uniqueIndex}`
  const marker = `feature-map-live-weekly ${week}`
  const note = `${marker}\n${body}`
  const prior = activityRows(ticketRef, cli).find((row) => (row.text || '').includes(marker))
  if (prior && normalize(prior.text) === normalize(note)) {
    return { ticketId: ticket.id, uniqueIndex: ticket.uniqueIndex, duplicate: true, counts }
  }
  runCli('vcc', ['activity', 'add', ticketRef, '--text', note], { ...cli, json: false })
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
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
