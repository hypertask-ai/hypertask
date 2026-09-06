import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Confirms the smoke session is actually logged in BEFORE any view test runs.
// An expired cookie must never look like 16 failed views — it's one
// unrunnable check, and prod-health.yml reads this file to tell the two
// apart so it alerts instead of rolling back a healthy deploy.
const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')

function writePreflight(result: { ok: boolean; reason?: string }) {
  mkdirSync(path.dirname(PREFLIGHT_FILE), { recursive: true })
  writeFileSync(PREFLIGHT_FILE, JSON.stringify(result))
}

function fail(reason: string): never {
  writePreflight({ ok: false, reason })
  throw new Error(reason)
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!
  const storageState = config.projects[0].use.storageState as string

  // Written up front so a throw from launch/newContext itself (missing
  // browser binary, unreadable storageState file) still leaves an unrunnable
  // verdict on disk instead of nothing at all.
  writePreflight({ ok: false, reason: 'setup did not complete' })

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState, baseURL })
    const page = await context.newPage()
    let response
    try {
      response = await page.goto('/inbox', { waitUntil: 'domcontentloaded', timeout: 20_000 })
    } catch (err) {
      fail(`login check could not load /inbox: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!response || response.status() === 401 || response.status() === 403) {
      fail(`login check got HTTP ${response?.status() ?? 'no response'} on /inbox`)
    }
    if (page.url().includes('/login')) {
      fail('login check was redirected to /login — the smoke session cookie is expired or invalid')
    }

    writePreflight({ ok: true })
  } finally {
    await browser.close()
  }
}
