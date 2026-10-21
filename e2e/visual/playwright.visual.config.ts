import { defineConfig } from '@playwright/test'
import path from 'node:path'

const snapshotDir = process.env.VISUAL_SNAPSHOT_DIR
const storageState = process.env.BROWSER_SMOKE_STATE_FILE
if (!snapshotDir || !path.isAbsolute(snapshotDir) || !storageState) {
  throw new Error('Visual QA requires an absolute shared snapshot directory and disposable storage state')
}

export default defineConfig({
  testDir: '.',
  testMatch: 'visual.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json']],
  outputDir: process.env.VISUAL_RESULTS_DIR || '../../test-results/visual',
  snapshotPathTemplate: `${snapshotDir}/{projectName}/{arg}{ext}`,
  updateSnapshots: 'none',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    storageState,
    browserName: 'chromium',
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
