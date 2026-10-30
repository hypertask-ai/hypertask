import type { Page } from '@playwright/test'
import taskDetailConfig from '../../../src/lib/configs/taskDetail.config'
import { waitForStableScroll, type BaselineScrollLayout } from './layout-lock-matrix'

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

export async function scrollToBaselinePosition(page: Page, layout: BaselineScrollLayout) {
  await page.evaluate(waitForStableScroll, { baselineLayout: layout })
}

// YPER4-958: a person hovercard opens under the pointer that is left resting after navigation, and its
// safe-polygon blocker swallows the next click. Park the pointer away from the thread and wait for it to close.
export async function parkPointerOffCommentThread(page: Page) {
  await page.mouse.move(0, 0)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="ticket-comment"] [aria-haspopup="dialog"]')]
      .every((element) => element.getAttribute('aria-expanded') !== 'true'),
  )
}
