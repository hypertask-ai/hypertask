import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const readJson = async (url, token, fetchImpl) => { const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) }); return res.ok ? res.json().catch(() => null) : null }
export async function waitForProdHealthGate({ eventName, repo, sha, token, budgetMs = 1_980_000, pollMs = 20_000, maxPolls = 1000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  if (eventName !== 'push') return { ok: true, unreadable: false, reason: 'manual dispatch' }
  let unread = ''; const deadline = now() + budgetMs
  for (let poll = 0; poll < maxPolls && now() < deadline; poll++) {
    const runsBody = await readJson(`https://api.github.com/repos/${repo}/actions/workflows/prod-health.yml/runs?head_sha=${sha}&event=push&per_page=10`, token, fetchImpl).catch(() => null)
    if (!Array.isArray(runsBody?.workflow_runs)) { unread = `could not read prod-health runs for ${sha}`; await sleep(pollMs); continue }
    const run = [...runsBody.workflow_runs].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]; if (!run) { unread = ''; await sleep(pollMs); continue }
    const statuses = await readJson(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`, token, fetchImpl).catch(() => null)
    if (!Array.isArray(statuses)) { unread = `could not read prod-health-gate status for ${sha}`; await sleep(pollMs); continue }
    unread = ''; const match = statuses.find((s) => s.context === 'prod-health-gate' && String(s.target_url || '').includes(`/runs/${run.id}`) && String(s.created_at || '') >= String(run.created_at || ''))
    if (match?.state === 'success') return { ok: true, unreadable: false, reason: `prod-health-gate success for ${sha} (run ${run.id})` }
    if (match?.state === 'failure' || run.status === 'completed') return { ok: false, unreadable: false, reason: `prod-health run ${run.id} ended without live verdict for ${sha}` }
    await sleep(pollMs)
  }
  return unread ? { ok: false, unreadable: true, reason: unread } : { ok: false, unreadable: false, reason: `prod-health did not conclude for ${sha} within budget` }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = await waitForProdHealthGate({ eventName: process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME || '', repo: process.env.GITHUB_REPOSITORY || '', sha: process.env.SHA || process.env.GITHUB_SHA || '', token: process.env.GITHUB_TOKEN || '', budgetMs: Number(process.env.GATE_BUDGET_SECONDS || 1980) * 1000, pollMs: Number(process.env.GATE_POLL_SECONDS || 20) * 1000, maxPolls: Number(process.env.GATE_MAX_POLLS || 1000) })
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${res.ok}\nreason=${res.reason}\n`); if (res.unreadable) { console.error(`::error::${res.reason}`); process.exit(1) } else console.log(res.ok ? res.reason : `::warning::Mobile verification skipped: ${res.reason}`)
}
