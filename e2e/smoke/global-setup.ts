import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Confirms the smoke session is actually logged in BEFORE any view test runs.
// An expired cookie must never look like 16 failed views — it's one
// unrunnable check, and prod-health.yml reads this file to tell the two
// apart so it alerts instead of rolling back a healthy deploy.
const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')
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

  const project = config.projects[0]
  if (!project) fail('smoke config has no Playwright project')

  const { baseURL, storageState } = project.use
  if (typeof baseURL !== 'string' || !baseURL) fail('smoke config has no baseURL')
  if (typeof storageState !== 'string' || !storageState) fail('smoke config has no storageState file')

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState, baseURL })
    const page = await context.newPage()
    let response
    try {
      response = await page.goto(INBOX_PATH, { waitUntil: 'load', timeout: 20_000 })
    } catch (err) {
      fail(`login check could not load ${INBOX_PATH}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!response || response.status() === 401 || response.status() === 403) {
      fail(`login check got HTTP ${response?.status() ?? 'no response'} on ${INBOX_PATH}`)
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
      fail(`login check was redirected to ${LOGIN_PATH} — the smoke session cookie is expired or invalid`)
    }

    writePreflight({ ok: true })
  } finally {
    await browser.close()
  }
}
