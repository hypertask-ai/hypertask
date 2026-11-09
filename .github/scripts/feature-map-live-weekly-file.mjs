import { readFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const APP = 'https://app.hypertask.ai'
const PROJECT_ID = 11514
const BACKLOG_SECTION_ID = 32923
const LABELS = ['CI', 'Hypertask CI', 'brain-light']

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

async function api(route, { token, fetchImpl = fetch, method = 'GET', body } = {}) {
  if (!token) throw new Error('HYPERTASK_MCP_TOKEN is missing')
  const response = await fetchImpl(`${APP}/api/mcp/${route}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Hypertask ${route} returned HTTP ${response.status}`)
  if (payload.success !== true) throw new Error(`Hypertask ${route} rejected the operation`)
  return payload
}

export async function findOpenWeeklyTicket(title, options = {}) {
  let cursor
  let total
  let searched = 0
  const cursors = new Set()
  do {
    const query = `project_id=${PROJECT_ID}&status=open&limit=50&q=${encodeURIComponent(title)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const search = await api(`tasks/search?${query}`, options)
    if (!Array.isArray(search.tasks) || search.partial || !Number.isInteger(search.total) || search.total < 0 ||
      (total !== undefined && search.total !== total) ||
      (search.nextCursor != null && (typeof search.nextCursor !== 'string' || !search.nextCursor.trim()))) {
      throw new Error('Weekly live ticket search is incomplete; refusing duplicate creation')
    }
    total = search.total
    searched += search.tasks.length
    if (searched > total) throw new Error('Weekly live ticket search is incomplete; refusing duplicate creation')
    const existing = search.tasks.find((task) => task.title === title && task.section !== 'Done')
    if (existing) return existing
    cursor = search.nextCursor
    if (cursor ? !search.tasks.length || cursors.has(cursor) : searched !== total) {
      throw new Error('Weekly live ticket search is incomplete; refusing duplicate creation')
    }
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return null
}

async function loadEvidence(evidenceDir) {
  const found = {}
  for (const name of ['result.json', 'run.json']) {
    try {
      Object.assign(found, JSON.parse(await readFile(path.join(evidenceDir, name), 'utf8')))
    } catch {}
  }
  return found
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
  fetchImpl = fetch,
  token = process.env.HYPERTASK_MCP_TOKEN,
} = {}) {
  const options = { token, fetchImpl }
  const result = await loadEvidence(evidenceDir)
  const counts = countSteps(result)
  const title = weeklyLiveTitle(week)
  const body = activityBody({ week, counts, sha: result.sha, runUrl, artifactUrl })
  let ticket = await findOpenWeeklyTicket(title, options)
  if (!ticket) {
    const description = [
      `<p>What's wrong or wanted: weekly live feature-map check for week ${week} on a disposable seeded copy, never production.</p>`,
      `<p>Who it affects: internal only; this is the weekly behavior record.</p>`,
      `<p>Recommended course and why: read the run below. A failed step names the page or journey to fix next.</p>`,
      `<p>What Valentin must decide: nothing.</p>`,
      `<p>How to undo: switch the Monday 04:05 UTC schedule off.</p>`,
      `<hr><p>${body.replace(/\n/g, '<br>')}</p>`,
    ].join('')
    const created = await api('tasks/create', {
      ...options,
      method: 'POST',
      body: {
        project_id: PROJECT_ID,
        section_id: BACKLOG_SECTION_ID,
        title,
        description,
        content_type: 'html',
        labels: LABELS,
      },
    })
    ticket = created.task
  }
  const ticketNumber = ticket?.ticketNumber || (Number.isSafeInteger(ticket?.uniqueIndex) ? `HYCI-${ticket.uniqueIndex}` : null)
  if (!ticketNumber) throw new Error('Weekly live ticket returned no ticket number')
  await api('comments', {
    ...options,
    method: 'POST',
    body: { ticket_number: ticketNumber, project_id: PROJECT_ID, text: `<p>${body.replace(/\n/g, '<br>')}</p>`, content_type: 'html' },
  })
  return { ticketNumber, uniqueIndex: ticket.uniqueIndex, counts }
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
    `Ticket: ${APP}/detail/project-${PROJECT_ID}/${outcome.uniqueIndex}`,
    `Pass: ${outcome.counts.pass}`,
    `Fail: ${outcome.counts.fail}`,
    `Verdict: ${outcome.counts.verdict}`,
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
