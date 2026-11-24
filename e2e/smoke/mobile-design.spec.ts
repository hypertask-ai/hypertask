import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MOBILE_SCREENS, MOBILE_THEMES, MOBILE_VIEWPORT, collectMobileMetrics, evaluateMobileDesign, type MobileDesignBaseline, type MobileRule } from './lib/mobile-design'
const BASELINE_PATH = process.env.MOBILE_DESIGN_BASELINE || path.join(__dirname, '__snapshots__', 'mobile-design.baseline.json'), UPDATE = process.env.MOBILE_DESIGN_UPDATE === '1', STRICT = process.env.MOBILE_DESIGN_STRICT === '1'
const list = (v?: string) => v?.split(',').map((s: string) => s.trim()).filter(Boolean), SCREEN_FILTER = list(process.env.MOBILE_DESIGN_SCREENS), THEME_FILTER = list(process.env.MOBILE_DESIGN_THEMES)
if (UPDATE) test.describe.configure({ mode: 'serial' })
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
for (const theme of MOBILE_THEMES) {
  test(`mobile design audit (${theme})`, { tag: ['@id:mobile-design'] }, async ({ browser, baseURL }, testInfo) => {
    test.skip(Boolean(THEME_FILTER?.length && !THEME_FILTER.includes(theme)), `filtered to ${THEME_FILTER?.join(',')}`); test.setTimeout(360_000)
    const origin = baseURL || process.env.SMOKE_BASE_URL || process.env.BASE_URL || 'https://app.hypertask.ai', boardPath = process.env.SMOKE_BOARD_PATH || '/project?id=7049&surface=board', boardId = new URL(boardPath, origin).searchParams.get('id') || '7049', taskPath = process.env.SMOKE_TASK_PATH || `/detail/project-${boardId}/6283`
    const storageState = (testInfo.project.use.storageState as string | undefined) || 'e2e/smoke/.state/smoke-state.json', baseline: MobileDesignBaseline | null = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null
    const screens = SCREEN_FILTER?.length ? MOBILE_SCREENS.filter((s) => SCREEN_FILTER.includes(s.id)) : MOBILE_SCREENS, themeIds: Record<string, Record<MobileRule, string[]>> = {}, failures: string[] = []
    for (const screen of screens) {
      const context = await browser.newContext({ baseURL: origin, storageState, viewport: MOBILE_VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA })
      await context.addCookies([{ name: 'theme', value: theme, url: origin, secure: origin.startsWith('https:'), sameSite: 'Strict' }])
      try {
        const label = `[${screen.id}/${theme}]`, page = await context.newPage(); await page.goto(screen.path({ boardPath, tablePath: `/project?id=${boardId}&surface=table`, taskPath }), { waitUntil: 'load', timeout: 30_000 }).then(() => page.waitForLoadState('networkidle', { timeout: 4_000 })).catch(() => {})
        for (const step of screen.taps ?? []) { const btn = page.getByRole(step.role, { name: step.name }).first(); await btn.waitFor({ state: 'visible', timeout: 10_000 }); await btn.tap(); await page.waitForTimeout(900) }
        const ready = screen.ready; if (!ready) { failures.push(`${label} no readiness landmark; every audited screen must define one`); continue }
        await expect(page.locator(ready).first(), `${label} readiness landmark ${ready} did not render`).toBeVisible({ timeout: 15_000 })
        await page.waitForTimeout(1000); expect(await page.locator('html').getAttribute('data-theme'), `${label} theme`).toBe(theme)
        const metrics = await collectMobileMetrics(page); expect(metrics.coarsePointer, `${label} pointer:coarse`).toBe(true)
        const result = evaluateMobileDesign(screen.id, theme, metrics, UPDATE ? null : baseline, STRICT); themeIds[screen.id] = result.idsByRule; if (!UPDATE) failures.push(...result.failures)
      } catch (err) { failures.push(`[${screen.id}/${theme}] ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`) } finally { await context.close() }
    }
    if (UPDATE) { mkdirSync(path.dirname(BASELINE_PATH), { recursive: true }); const merged = (existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null)?.screens ?? {}; for (const [sid, ids] of Object.entries(themeIds)) merged[sid] = { ...(merged[sid] ?? {}), [theme]: ids }; writeFileSync(BASELINE_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), viewport: MOBILE_VIEWPORT, touchEmulation: true, themes: [...MOBILE_THEMES], screens: merged }, null, 2)}\n`) }
    expect(failures, failures.join('\n')).toEqual([])
  })
}
