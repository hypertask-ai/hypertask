import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL
if (!baseURL) throw new Error('SMOKE_BASE_URL is required for production smoke QA')

// HTPR-6199 — post-release smoke QA against production. Runs from
// .github/workflows/prod-health.yml after every deploy, using a dedicated
// smoke-only account's session (see e2e/smoke/README.md).
export default defineConfig({
  testDir: './e2e/smoke',
  fullyParallel: true,
  // A view that fails once is retried before it counts as a real failure —
  // the ticket asks to roll back only if the SAME view fails twice, and
  // Playwright's own retry does that for free per test.
  retries: 1,
  workers: 4,
  reporter: [['list']],
  timeout: 20_000,
  use: {
    baseURL,
    storageState: 'e2e/smoke/.state/smoke-state.json',
    // Traces include authenticated network traffic and must never be uploaded
    // as CI artifacts. The failure log and screenshot identify the broken
    // view without exposing the smoke account's session cookie.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  globalSetup: './e2e/smoke/global-setup.ts',
  projects: [
    { name: 'Desktop', use: { ...devices['Desktop Chrome'] } },
    // browserName pinned: the iPhone 13 device descriptor defaults to WebKit,
    // but the workflow only installs the Chromium binary (HTPR-6199 review).
    { name: 'Mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
