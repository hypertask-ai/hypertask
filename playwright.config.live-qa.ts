import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './e2e/live-qa',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  reporter: [['dot']],
  outputDir: path.join(process.env.RUNNER_TEMP!, 'live-qa-results'),
  use: {
    baseURL: 'https://app.hypertask.ai',
    storageState: path.join(process.env.RUNNER_TEMP!, 'live-qa-private/state.json'),
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'off',
    video: 'on',
    screenshot: 'on',
    acceptDownloads: false,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
