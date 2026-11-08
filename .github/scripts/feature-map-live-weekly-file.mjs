import { readFile } from 'node:fs/promises'
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

async function api(token, route, options = {}, idempotency = '', fetchImpl = fetch) {
  const response = await fetchImpl(`https://app.hypertask.ai/api/mcp${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
  })
  if (!response.ok) {
    let code = ''
    try { code = (await response.json()).code || '' } catch {}
    throw new Error(`MCP ${options.method || 'GET'} ${route.split('?')[0]} failed (HTTP ${response.status}${code ? `, ${code}` : ''})`)
  }
  try { return await response.json() } catch { throw new Error(`MCP ${route} returned invalid JSON`) }
}

export async function findOpenWeeklyTicket(token, title, fetchImpl = fetch) {
  for (const status of ['Normal', 'Archive', 'Deleted']) {
    const search = await api(token, `/tasks?project_id=11514&status=${status}&search=${encodeURIComponent(title)}&limit=100`, {}, `feature-map-live-search-${status}`, fetchImpl)
    if (!Array.isArray(search.tasks)) throw new Error('Weekly live ticket search returned no task list')
    const existing = search.tasks.find((task) => task.title === title && task.section !== 'Done')
    if (existing) return existing
  }
  return null
}

export async function fileWeeklyLiveResult({
  token,
  evidenceDir = 'verify-qa',
  runUrl = '',
  artifactUrl = '',
  week = isoWeek(),
  fetchImpl = fetch,
}) {
  if (!token) throw new Error('HYPERTASK_MCP_TOKEN is missing')
  let result = {}
  try {
    result = JSON.parse(await readFile(path.join(evidenceDir, 'result.json'), 'utf8'))
  } catch {
    try { result = JSON.parse(await readFile(path.join(evidenceDir, 'run.json'), 'utf8')) } catch {}
  }
  const counts = countSteps(result)
  const title = weeklyLiveTitle(week)
  const activity = buildActivity({ week, runUrl, artifactUrl, counts, sha: result.sha })
  let ticket = await findOpenWeeklyTicket(token, title, fetchImpl)
  if (!ticket) {
    const page = await api(token, '/projects/11514/labels', {}, 'feature-map-live-labels', fetchImpl)
    const labels = ['CI', 'Hypertask CI', 'brain-light'].map((name) => page.labels?.find((label) => label.name === name)?.id)
    if (labels.some((id) => !id)) throw new Error('Fleet CI labels are unavailable')
    const description = buildDescription({ week, counts, sha: result.sha, runUrl, artifactUrl })
    const created = await api(token, '/tasks/create', {
      method: 'POST',
      body: JSON.stringify({ project_id: 11514, title, description, labels }),
    }, `feature-map-live-create-${week}`, fetchImpl)
    ticket = created.task
  }
  if (!Number.isSafeInteger(ticket?.id) || ticket.id < 1) throw new Error('Weekly live ticket returned no task id')
  const marker = `feature-map-live-weekly ${week}`
  const log = await api(token, `/tasks/${ticket.id}/agent-activity?limit=50`, {}, `feature-map-live-log-${week}`, fetchImpl)
  if (!Array.isArray(log.activities)) throw new Error('Weekly live activity search returned no list')
  if (log.activities.some((row) => row.text?.includes(marker))) {
    return { ticketId: ticket.id, uniqueIndex: ticket.uniqueIndex, duplicate: true, counts }
  }
  const opened = await api(token, '/agents/runs', { method: 'POST', body: JSON.stringify({ taskId: ticket.id, source: 'runtime' }) }, `feature-map-live-run-${week}`, fetchImpl)
  if (typeof opened.run?.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(opened.run.id)) throw new Error('Weekly live activity returned no run id')
  await api(token, `/agents/runs/${opened.run.id}/activities`, {
    method: 'POST',
    body: JSON.stringify({ type: 'thought', text: `${marker}\n${activity}` }),
  }, `feature-map-live-activity-${week}`, fetchImpl)
  return { ticketId: ticket.id, uniqueIndex: ticket.uniqueIndex, duplicate: false, counts }
}

async function main() {
  const token = process.env.HYPERTASK_MCP_TOKEN
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  const runUrl = server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : ''
  const outcome = await fileWeeklyLiveResult({
    token,
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
