import type { Page } from '@playwright/test'

// Matched against whole headings only: task titles and descriptions on the page can quote
// these words (YPER4-304), but the app's and Next's error screens put them in an h1/h2.
const ERROR_MARKERS = [/^something went wrong$/i, /^application error\b/i, /^internal server error\.?$/i]

/** The error-screen heading on the page, or undefined when the page is not an error screen. */
export async function errorPageHeading(page: Page): Promise<string | undefined> {
  const headings = (await page.locator('h1, h2').allInnerTexts()).map((text) => text.trim())
  return headings.find((heading) => ERROR_MARKERS.some((marker) => marker.test(heading)))
}
