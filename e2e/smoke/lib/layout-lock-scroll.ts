import type { Page } from '@playwright/test'
import taskDetailConfig from '../../../src/lib/configs/taskDetail.config'
import { waitForStableScroll } from './layout-lock-matrix'

export async function waitForTicketInitialScroll(page: Page) {
  await page.locator('[data-ticket-initial-scroll-ready="true"]').waitFor({ state: 'attached' })
  // Let the readiness commit's positioning effect run before timing its configured delay.
  await page.evaluate(waitForStableScroll)
  // Start the positioning delay after the snapshot and live rows, not after navigation or networkidle.
  await page.waitForTimeout(Math.max(
    taskDetailConfig.delays.defaultCommentFocus,
    taskDetailConfig.delays.mobileFocusComment,
    taskDetailConfig.delays.scrollToElement,
  ))
  await page.evaluate(waitForStableScroll)
}

export async function scrollToTop(page: Page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollTop > 0) element.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  })
  await page.evaluate(waitForStableScroll)
}
