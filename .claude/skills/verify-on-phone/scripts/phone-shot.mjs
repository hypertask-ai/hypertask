import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoPackage = fileURLToPath(new URL("../../../../package.json", import.meta.url));
const repoModules = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
const require = createRequire(existsSync(repoModules)
  ? repoPackage
  : "/home/valentin/projects/hypertask/package.json");
const [url, out, statePath, userAgent, viewport, allowRedirect, requestedPath, theme] = process.argv.slice(2);
const [width, height] = viewport.split("x").map(Number);

try {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: statePath,
      viewport: { width, height },
      userAgent,
      isMobile: width < 800,
      hasTouch: width < 800,
    });
    if (theme) {
      await context.addCookies([{
        name: "theme", value: theme, url: new URL(url).origin,
        secure: url.startsWith("https:"), sameSite: "Strict",
      }]);
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const landed = page.url();
    if (/login|signin|sign-in/.test(landed)) {
      throw new Error(`The browser landed on a login page (${landed}), so the auth state at ${statePath} is stale and the shot is not evidence. Do this next: Refresh that state file with the login recipe in .claude/skills/verify-qa/SKILL.md 'Logins', then re-run.`);
    }
    if (!landed.includes(requestedPath) && allowRedirect !== "yes") {
      throw new Error(`Asked for ${url} but the browser landed on ${landed}, so ${out} would show a different screen. Do this next: Check this account has access to that page. If the redirect is expected, re-run with --allow-redirect and say so when you post the shot.`);
    }
    await page.screenshot({ path: out, type: "png" });
    console.log(landed);
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
