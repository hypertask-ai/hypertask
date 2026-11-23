import { defineConfig, devices } from '@playwright/test'
const baseURL = process.env.BASE_URL || process.env.SMOKE_BASE_URL
if (!baseURL) throw new Error('BASE_URL or SMOKE_BASE_URL is required for mobile verification')
const phone = { ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, browserName: 'chromium' as const }
export default defineConfig({
  testDir: '.', fullyParallel: true, retries: process.env.BROWSER_SMOKE_PR ? 0 : 1, workers: 4, reporter: [['list']], timeout: 60_000, globalSetup: './global-setup.ts',
  use: { baseURL, storageState: process.env.MOBILE_STORAGE_STATE || 'e2e/smoke/.state/smoke-state.json', trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  projects: [{ name: 'journeys-setup', testMatch: /journeys\.setup\.ts/, timeout: 30_000, use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-journeys', testMatch: /journeys\.spec\.ts/, dependencies: ['journeys-setup'], grep: /@mobile/, timeout: 60_000, use: phone }, { name: 'mobile-design', testMatch: /mobile-design\.spec\.ts/, timeout: 360_000, use: phone }],
})
