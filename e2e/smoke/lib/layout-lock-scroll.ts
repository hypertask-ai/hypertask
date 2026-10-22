import type { Page } from '@playwright/test'
import taskDetailConfig from '../../../src/lib/configs/taskDetail.config'
import { waitForStableScroll } from './layout-lock-matrix'

export async function waitForTicketInitialScroll(page: Page) {
  await page.locator('[data-ticket-initial-scroll-ready="true"]').waitFor({ state: 'attached' })
  await page.evaluate(waitForStableScroll, {})
  await page.waitForTimeout(Math.max(
    taskDetailConfig.delays.defaultCommentFocus,
    taskDetailConfig.delays.mobileFocusComment,
    taskDetailConfig.delays.scrollToElement,
  ))
  await page.evaluate(waitForStableScroll, {})
}

export async function scrollToBaselinePosition(page: Page, layout: 'desktop' | 'phone') {
  await page.evaluate(waitForStableScroll, { baselineLayout: layout })
}
