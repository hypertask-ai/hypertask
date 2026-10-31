import type { Page } from '@playwright/test'

const ERROR_MARKERS = [/^something went wrong$/i, /^application error\b/i, /^internal server error\.?$/i]

export async function errorPageHeading(page: Page): Promise<string | undefined> {
  const headings = (await page.locator('h1, h2').allInnerTexts()).map((text) => text.trim())
  return headings.find((heading) => ERROR_MARKERS.some((marker) => marker.test(heading)))
}
