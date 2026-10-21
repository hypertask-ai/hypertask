import { test, expect } from '../../scripts/live-qa/fixture'

for (const theme of ['porcelain', 'graphite', 'amoled', 'dia']) {
  test(`read-only identity doctor in ${theme}`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'https://app.hypertask.ai' }])
    const response = await page.goto('/api/users/getById')
    expect(response?.status()).toBe(200)
    expect((await response!.json()).id).toBe(985)
    await expect(page.locator('body')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`identity-${theme}.png`) })
  })
}
