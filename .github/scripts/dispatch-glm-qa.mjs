// HTPR-6239 — dispatch the GLM exploratory QA brief after a production deploy.
//
// Called by the `glm-qa` job in prod-health.yml after the smoke checks actually
// executed and nothing rolled back. Posts one comment on the merged pull
// request's Hypertask ticket that mentions the configured GLM worker; the agent
// then explores the changed screens on the live app for five minutes and
// reports there. Read-only dispatcher: it never touches Vercel and never rolls
// back anything.
//
// Every refusal is exit 0 (a skip is normal operation); only a failed comment
// POST exits nonzero so the workflow can alert on Telegram.
import { pathToFileURL } from 'node:url'

const PROJECT_ID = 15
// Screens the brief can name, mapped from changed file paths. Keep names in
// sync with what the smoke suite (e2e/smoke/prod.spec.ts) calls the main views.
const SCREEN_PREFIXES = [
  ['all-tasks', 'board list (All tasks)'],
  ['detail/', 'kanban board and task detail'],
  ['inbox', 'inbox'],
  ['calendar', 'calendar'],
  ['search', 'AI search'],
  ['settings', 'settings'],
  ['new', 'new-task modal'],
  ['chat', 'agent chat'],
  ['api/', 'API behaviour'],
]

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return char
    }
  })
}

export function parseTicketNumber(prTitle) {
  const match = /HTPR-(\d+)/.exec(String(prTitle || ''))
  return match ? Number(match[1]) : null
}

/** Map changed file paths to at most 3 known screen names (fallback: top-level dirs). */
export function mapScreens(changedFiles) {
  const files = String(changedFiles || '').split(/\s+/).filter(Boolean)
  const screens = []
  const fallbackDirs = []
  for (const file of files) {
    const normalized = file.replace(/^.*?(src\/|e2e\/)/, '$1')
    const hit = SCREEN_PREFIXES.find(([prefix]) => {
      // Slash-suffixed prefixes match anywhere; bare names must be path
      // segments so "search" never matches "browser-search.tsx".
      if (prefix.endsWith('/')) return normalized.includes(prefix)
      return new RegExp(`(^|/)${prefix}([/.])`).test(normalized)
    })
    if (hit) {
      if (!screens.includes(hit[1])) screens.push(hit[1])
    } else {
      const top = file.split('/')[0]
      if (top && !fallbackDirs.includes(top)) fallbackDirs.push(top)
    }
    if (screens.length >= 3) break
  }
  if (screens.length === 0 && fallbackDirs.length > 0) {
    return fallbackDirs.slice(0, 3).map((dir) => `the ${dir} area`)
  }
  return screens.slice(0, 3)
}

export function buildBriefText({ sha, prTitle, screens, smokeOk, agentName, agentId }) {
  const screenItems = screens
    .map((screen) => `<li>${escapeHtml(screen)}</li>`)
    .join('')
  const smokeLine = smokeOk
    ? 'The automated smoke check passed on this deploy.'
    : 'The automated smoke check failed without a confirmed break (no rollback) — treat that as a strong defect hint.'
  // Hand-written mention span: the server-side agent-mention extraction
  // (extractTipTapContent) matches data-label="agent-<uuid>" directly, so the
  // wake does not depend on @-token resolution succeeding for the MCP identity.
  const mention = `<span data-type="mention" class="mention" data-id="${escapeHtml(agentName)}" data-label="agent-${escapeHtml(agentId)}">${escapeHtml(agentName)}</span>`
  return [
    `<p><strong>GLM post-deploy QA pass requested: five minutes, read-only.</strong></p>`,
    `<p>Deploy ${escapeHtml(sha)} merged as “${escapeHtml(prTitle)}”. ${escapeHtml(smokeLine)}</p>`,
    `<p>Changed screens:</p><ul>${screenItems}</ul>`,
    `<ol><li>Open https://app.hypertask.ai as a signed-in user and explore the changed screens and their nearest neighbours for five minutes.</li><li>Post one comment on this ticket with screenshots attached and a one-line verdict (pass, or defect list).</li><li>File one Bugs ticket per defect, labelled <code>post-deploy</code>, with the reproduction steps.</li></ol>`,
    `<p>Rules: look, do not act. Never submit forms, edit, delete, invite, or change settings; never roll back and never trigger a deployment action. Keep screenshots to the changed screens and never capture tokens, credentials, or personal data. Reply without mentioning anyone.</p>`,
    `<p>${mention} — brief marker <code>glm-qa-brief:${escapeHtml(sha)}</code></p>`,
  ].join('')
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--sha') args.sha = argv[++i]
    else if (arg === '--pr-title') args.prTitle = argv[++i]
    else if (arg === '--changed-files') args.changedFiles = argv[++i]
    else if (arg === '--smoke-ok') args.smokeOk = argv[++i] === 'true'
    else if (arg === '--dry-run') args.dryRun = true
    else args._.push(arg)
  }
  return args
}

function refuse(reason) {
  console.log(`glm-qa dispatch skipped: ${reason}`)
  return 0
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function apiGet(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`)
  return response.json()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.MCP_TOKEN
  const base = (process.env.MCP_BASE_URL || 'https://app.hypertask.ai').replace(/\/$/, '')
  const agentId = (process.env.GLM_QA_AGENT_ID || '').trim()
  const agentName = (process.env.GLM_QA_AGENT_NAME || '').trim()

  if (!agentId || !UUID_RE.test(agentId) || !agentName) {
    return refuse('GLM_QA_AGENT_ID (uuid) / GLM_QA_AGENT_NAME repo variables are not configured')
  }
  const ticket = parseTicketNumber(args.prTitle)
  if (!ticket) {
    return refuse(`no HTPR-<n> ticket in the pull request title "${args.prTitle}"`)
  }

  // Duplicate-run guard: one brief per deploy SHA. The workflow concurrency
  // group (glm-qa-<sha>) is the primary dedup; this comment scan is
  // belt-and-braces.
  // ponytail: a failed comment READ continues without dedup (the marker scan is
  // best-effort) so a token that can write but not read comments cannot
  // silently kill the feature; upgrade path: an idempotency key on the POST.
  let alreadyBriefed = false
  try {
    const task = await apiGet(`${base}/api/mcp/tasks?ticket_number=HTPR-${ticket}&project_id=${PROJECT_ID}`, token)
    const taskId = task?.tasks?.[0]?.id
    if (!taskId) return refuse(`ticket HTPR-${ticket} not found on board ${PROJECT_ID}`)
    const comments = await apiGet(`${base}/api/mcp/comments?task_id=${taskId}&project_id=${PROJECT_ID}`, token)
    const marker = `glm-qa-brief:${args.sha}`
    alreadyBriefed = (comments?.comments || []).some(
      (comment) => String(comment.text || comment.commentText || '').includes(marker),
    )
  } catch (err) {
    console.log(`::warning::glm-qa duplicate scan failed (${err.message}); relying on the workflow concurrency group`)
  }
  if (alreadyBriefed) {
    return refuse(`deploy ${args.sha} was already briefed on HTPR-${ticket}`)
  }

  const screens = mapScreens(args.changedFiles)
  const text = buildBriefText({
    sha: args.sha,
    prTitle: args.prTitle,
    screens: screens.length > 0 ? screens : ['the whole app (no known screens matched)'],
    smokeOk: args.smokeOk !== false,
    agentName,
    agentId,
  })

  if (args.dryRun) {
    console.log('glm-qa dry run — would POST this comment:')
    console.log(text)
    return 0
  }

  const response = await fetch(`${base}/api/mcp/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unique_index: ticket, project_id: PROJECT_ID, content_type: 'html', text }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`glm-qa dispatch FAILED: comment POST -> HTTP ${response.status}: ${body.slice(0, 300)}`)
    return 1
  }
  console.log(`glm-qa brief posted on HTPR-${ticket} mentioning ${agentName}`)
  return 0
}

// Run only when executed directly, so the test suite can import the helpers.
const invoked = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false
if (invoked) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => {
      console.error(`glm-qa dispatch FAILED: ${err && err.stack ? err.stack : err}`)
      process.exit(1)
    },
  )
}
