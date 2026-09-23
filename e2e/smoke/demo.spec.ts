import { test, expect } from '@playwright/test'
import { withRealtime } from './lib/realtime'

// Guest demo access (src/app/api/demo/guest/route.ts). Uses NO account ,
// runs its own unauthenticated context regardless of storageState, since
// an existing session would just redirect to the user's real boards ("a
// real logged-in user hitting /demo gets boardUrl: '/'").
//
// /api/demo/guest rate-limits at 5 guest creations per IP per rolling hour
// (in-memory, per server instance, src/app/api/demo/guest/route.ts). A CI
// runner's shared egress IP can exhaust that in one busy hour, so the
// runner must only include this test (tag @demo) once per deploy, not on
// every watch-mode tick, see hypertask-qa-runner's README for the exact
// gate.
test('guest demo access', { tag: ['@demo', '@id:demo'] }, async ({ browser }) => {
  test.skip(process.env.HT_QA_RUN_DEMO !== '1', 'HT_QA_RUN_DEMO not set, demo runs at most once per deploy')

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()

  const guestResponse = page.waitForResponse((res) => res.url().includes('/api/demo/guest'), { timeout: 15_000 })
  const response = await page.goto(withRealtime('/demo'), { waitUntil: 'load' })
  expect(response?.status(), 'no response for /demo').toBeLessThan(400)

  const apiResponse = await guestResponse
  test.skip(
    apiResponse.status() === 429,
    'guest provisioning is rate-limited right now (5/IP/hour), not a real failure, try again next deploy',
  )
  expect(apiResponse.ok(), `POST /api/demo/guest returned HTTP ${apiResponse.status()}`).toBe(true)

  await page.waitForURL(/\/project\?id=\d+/, { timeout: 15_000 })

  // Fixed seed task titles (src/lib/demo/guestSeedTasks.ts GUEST_SEED_TASKS)
  // prove the guest board actually provisioned, not just an empty shell.
  await expect(page.locator('text=Press Ctrl+K: every action is one keystroke away')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('text=Ask the AI to build this board for you')).toBeVisible({ timeout: 10_000 })

  await context.close()
})
