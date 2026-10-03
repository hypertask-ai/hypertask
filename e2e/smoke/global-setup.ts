import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { verifySession } from '../../src/lib/auth/session'
import { withRealtime } from './lib/realtime'

// Confirms the smoke session is actually logged in BEFORE any view test runs.
// An expired cookie must never look like 16 failed views — it's one
// unrunnable check, and prod-health.yml reads this file to tell the two
// apart so it alerts instead of rolling back a healthy deploy.
const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')
const APPLICATION_FAILURE_FILE = path.join(__dirname, '.state', 'application-failure.json')
const INBOX_PATH = '/inbox'
const LOGIN_PATH = '/login'

function writePreflight(result: { ok: boolean; reason?: string }) {
  mkdirSync(path.dirname(PREFLIGHT_FILE), { recursive: true })
  writeFileSync(PREFLIGHT_FILE, JSON.stringify(result))
}

function fail(reason: string): never {
  writePreflight({ ok: false, reason })
  throw new Error(reason)
}

export default async function globalSetup(config: FullConfig) {
  // Written up front so a throw anywhere below (bad config shape, missing
  // browser binary, unreadable storageState file) still leaves an unrunnable
  // verdict on disk instead of nothing at all.
  writePreflight({ ok: false, reason: 'setup did not complete' })
  rmSync(APPLICATION_FAILURE_FILE, { force: true })

  // The guest-demo journey (e2e/smoke/demo.spec.ts, tag @demo) uses no
  // account at all, it opens its own unauthenticated context. Running it
  // alone (e.g. `--grep @demo`) would otherwise fail this login precheck
  // against whatever storageState the config carries. The runner sets this
  // when it invokes a demo-only run.
  if (process.env.HT_QA_NO_ACCOUNT === '1' && process.env.SMOKE_POSTDEPLOY !== '1') {
    writePreflight({ ok: true })
    return
  }

  const project = config.projects[0]
  if (!project) fail('smoke config has no Playwright project')

  const { baseURL, storageState } = project.use
  if (typeof baseURL !== 'string' || !baseURL) fail('smoke config has no baseURL')
  if (typeof storageState !== 'string' || !storageState) fail('not tested: QA login missing/expired (no storageState file)')
  try {
    const state = JSON.parse(readFileSync(storageState, 'utf8'))
    if (!Array.isArray(state.cookies) || !state.cookies.some((cookie: { name: string; value: string }) => cookie.name === 'ht_session' && cookie.value)) {
      fail('not tested: QA login missing/expired (no ht_session cookie)')
    }
  } catch {
    fail('not tested: QA login missing/expired (missing or invalid storageState)')
  }
  if (process.env.BROWSER_SMOKE_PR) {
    const state = JSON.parse(readFileSync(storageState, 'utf8')) as { cookies?: Array<{ name: string; value: string }> }
    const token = state.cookies?.find((cookie) => cookie.name === 'ht_session')?.value
    const session = verifySession(token)
    if (!session) {
      fail('PR browser smoke requires a valid isolated ht_session cookie')
    }
    const id = session.id
    if (typeof id !== 'number' || id === 6 || id === 985 || id <= 0) {
      fail('PR browser smoke requires a plain user session (not owner 6 or QA 985)')
    }
  }

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState, baseURL })
    if (process.env.SMOKE_POSTDEPLOY === '1') {
      const identity = await context.request.get('/api/users/getById')
      if (identity.status() === 401 || identity.status() === 403) {
        fail('not tested: QA login missing/expired (server rejected the session)')
      }
      if (identity.status() !== 200) fail(`login check got HTTP ${identity.status()} verifying QA identity`)
      const user = await identity.json()
      if (user?.id !== 2343 && user?.id !== 985) fail('not tested: production smoke requires QA user 2343 or 985, never Valentin')
      console.log(`Production smoke authenticated as QA user ${user.id}`)
    }
    const page = await context.newPage()
    let response
    try {
      response = await page.goto(withRealtime(INBOX_PATH), { waitUntil: 'load', timeout: 20_000 })
    } catch (err) {
      fail(`login check could not load ${INBOX_PATH}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!response || response.status() === 401 || response.status() === 403) {
      fail(`not tested: QA login missing/expired (HTTP ${response?.status() ?? 'no response'} on ${INBOX_PATH})`)
    }

    // A client-side auth guard can redirect to /login after hydration, which
    // hasn't necessarily happened yet right after `load`. Give it a moment
    // before trusting the URL, so an expired cookie can't look logged-in.
    try {
      await page.waitForURL(`**${LOGIN_PATH}**`, { timeout: 3_000 })
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'TimeoutError') {
        fail(`login check failed while waiting for an auth redirect: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (page.url().includes(LOGIN_PATH)) {
      fail(`not tested: QA login missing/expired (redirected to ${LOGIN_PATH})`)
    }

  } finally {
    try {
      await browser.close()
    } catch (err) {
      fail(`login check browser could not close cleanly: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  writePreflight({ ok: true })
}
