import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { assertLoopback } from '../.github/scripts/verify-qa-premerge.mjs'

export function assertRunner(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('verify-qa runs only on a GitHub-hosted runner, never the VPS')
  }
  const base = assertLoopback(env.VERIFY_QA_BASE)
  const db = new URL(env.DATABASE_URL)
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.username !== 'browser_smoke' || db.pathname !== '/hypertask_smoke') {
    throw new Error('verify-qa requires the disposable browser_smoke database')
  }
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.REDIS_URL).hostname)) {
    throw new Error('verify-qa requires loopback Redis')
  }
  if (!['inbox-cycle', 'inbox-cycle-broken'].includes(env.VERIFY_QA_JOURNEY)) {
    throw new Error('Unknown verify-qa journey')
  }
  return base
}

export function doctorIdentity(state, status, payload) {
  const cookie = state.cookies?.find(cookie => cookie.name === 'nookies_user')
  const expected = JSON.parse(decodeURIComponent(cookie?.value || 'null'))?.id
  const actual = payload?.slices?.user?.data?.id
  if (status !== 200 || !Number.isInteger(expected) || expected === 6 || expected === 985 || actual !== expected) {
    throw new Error('Doctor failed: disposable authenticated identity did not match')
  }
  return actual
}

export function sanitizeLog(text, secrets) {
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length > 3)) {
    text = text.split(secret).join('[REDACTED]')
    text = text.split(encodeURIComponent(secret)).join('[REDACTED]')
  }
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
}

async function doctor(base, stateFile, out) {
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) break
    } catch (error) {
      if (attempt === 59) throw error
    }
    if (attempt === 59) throw new Error('Doctor failed: app did not become ready')
    await delay(1000)
  }
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } })
    const response = await context.request.post('/api/app-shell/bootstrap', { data: {} })
    const userId = doctorIdentity(state, response.status(), await response.json())
    const page = await context.newPage()
    await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' })
    await page.getByText('Inbox cycle message 1', { exact: true }).first().waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(out, 'doctor.png') })
    return { verdict: 'PASS', userId, base, screenshot: 'doctor.png' }
  } finally {
    await browser.close()
  }
}

async function summarize(out) {
  await mkdir(out, { recursive: true })
  let run = { verdict: 'FAIL', failure: 'Setup failed or journey did not finish' }
  try { run = JSON.parse(await readFile(path.join(out, 'run.json'), 'utf8')) } catch {}
  if (process.env.VERIFY_QA_JOB_STATUS !== 'success') run.verdict = 'FAIL'
  const secrets = ['SESSION_SECRET', 'JWT_SECRET', 'BETTER_AUTH_SECRET'].map(key => process.env[key])
  try {
    const state = JSON.parse(await readFile(process.env.VERIFY_QA_STATE_FILE, 'utf8'))
    secrets.push(...state.cookies.map(cookie => cookie.value))
  } catch {}
  for (const name of await readdir(out)) {
    if (/\.(log|json|md)$/.test(name)) {
      const file = path.join(out, name)
      await writeFile(file, sanitizeLog(await readFile(file, 'utf8'), secrets))
    }
  }
  run.journey ??= process.env.VERIFY_QA_JOURNEY
  run = JSON.parse(sanitizeLog(JSON.stringify(run), secrets))
  await writeFile(path.join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  const summary = [
    '## On-demand verify-qa', '', `Verdict: **${run.verdict}**`,
    `Journey: ${run.journey}`, `Candidate SHA: ${run.sha || 'setup incomplete'}`,
    `Doctor + journey: ${run.durationSeconds ?? 'not started'} seconds`,
    'Compute: one GitHub-hosted ubuntu-latest job; global verify-qa concurrency group; cancellation off; 25-minute cap.',
    'Full job runtime/queue time: see the Actions job timing (includes install, seed, build, upload).',
    run.failure ? `Failure: ${run.failure}` : '',
    'Evidence: doctor.png, doctor.json, journey screenshots/result.json, run.json, build/server/journey logs (7 days).',
    'Disposable database and services are destroyed with the runner. No production data or auth state is uploaded.', '',
  ].filter(Boolean).join('\n')
  await writeFile(path.join(out, 'summary.md'), summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}

async function main() {
  const out = path.resolve('verify-qa')
  if (process.argv.includes('--summary')) return summarize(out)
  const base = assertRunner(process.env)
  await mkdir(out, { recursive: true })
  const started = Date.now()
  const run = { verdict: 'FAIL', journey: process.env.VERIFY_QA_JOURNEY,
    sha: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() }
  try {
    const diagnosis = await doctor(base, process.env.VERIFY_QA_STATE_FILE, out)
    await writeFile(path.join(out, 'doctor.json'), JSON.stringify(diagnosis, null, 2))
    let fixture = process.env.VERIFY_QA_FIXTURE
    if (run.journey === 'inbox-cycle-broken') {
      const broken = JSON.parse(await readFile(fixture, 'utf8'))
      broken.items[0].title = 'Deliberately missing verify-qa reminder'
      fixture = path.join(process.env.RUNNER_TEMP, 'verify-qa-broken-fixture.json')
      await writeFile(fixture, JSON.stringify(broken), { mode: 0o600 })
    }
    const child = spawnSync(process.execPath, ['.github/scripts/verify-qa-premerge.mjs'], {
      stdio: 'inherit', timeout: 180_000,
      env: { ...process.env, VERIFY_QA_FIXTURE: fixture, VERIFY_QA_OUT: out, VERIFY_QA_REPORT_ONLY: '0', VERIFY_QA_CHANGED_FILES: '', VERIFY_QA_NAMED_JOURNEY: 'inbox-cycle', GITHUB_STEP_SUMMARY: '' },
    })
    if (child.error || child.status !== 0) throw new Error(child.error?.message || 'Named journey failed; inspect result.json and screenshots')
    const result = JSON.parse(await readFile(path.join(out, 'result.json'), 'utf8'))
    if (result.verdict !== 'PASS' || !result.steps.length || !result.screenshots.length) throw new Error('Journey did not produce complete passing evidence')
    run.verdict = 'PASS'
  } catch (error) {
    run.failure = error.message
    process.exitCode = 1
  } finally {
    run.durationSeconds = Math.round((Date.now() - started) / 1000)
    await writeFile(path.join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
    console.log(`verify-qa ${run.verdict}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
