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
    { name: 'Desktop', testMatch: /prod\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // browserName pinned: the iPhone 13 device descriptor defaults to WebKit,
    // but the workflow only installs the Chromium binary (HTPR-6199 review).
    { name: 'Mobile', testMatch: /prod\.spec\.ts/, use: { ...devices['iPhone 13'], browserName: 'chromium' } },

    // HTPR-6636 phase 2 , customer journeys, opt-in via HT_QA_JOURNEYS=1
    // (every test here self-skips otherwise, so this is harmless in
    // prod-health.yml, which sets neither env var and doesn't pass
    // --project). "journeys-setup" resolves/creates "QA runner board" once
    // and writes it to a state file the "journeys"/"mobile-journeys"
    // projects read , a Playwright project dependency, so it always
    // completes (or itself skips) before either project starts.
    { name: 'journeys-setup', testMatch: /journeys\.setup\.ts/, timeout: 30_000, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'journeys',
      testMatch: /journeys\.spec\.ts/,
      dependencies: ['journeys-setup'],
      timeout: 45_000,
      use: { ...devices['Desktop Chrome'] },
    },
    // Only the tests tagged @mobile (open board, open task, create task) ,
    // see e2e/smoke/journeys.spec.ts. Same Chromium pin as "Mobile" above.
    {
      name: 'mobile-journeys',
      testMatch: /journeys\.spec\.ts/,
      dependencies: ['journeys-setup'],
      grep: /@mobile/,
      timeout: 45_000,
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },

    // Guest demo access , no account, self-skips unless HT_QA_RUN_DEMO=1
    // (the runner sets that at most once per deploy; see e2e/smoke/demo.spec.ts).
    { name: 'demo', testMatch: /demo\.spec\.ts/, timeout: 30_000, use: { ...devices['Desktop Chrome'] } },
  ],
})
