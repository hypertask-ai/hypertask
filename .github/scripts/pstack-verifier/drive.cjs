'use strict';

const { allowedAppUrl } = require('./preview.cjs');
const { safeRoute } = require('./routes.cjs');

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function signIn(page, base) {
  const email = process.env.QA_LOGIN_EMAIL || '';
  const password = process.env.QA_LOGIN_PASSWORD || '';
  if (!email || !password) return false;
  await page.goto(`${base}/qa/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL(url => !url.pathname.startsWith('/qa/login'), { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function drive(request) {
  const bases = [request?.parentUrl, request?.headUrl].filter(allowedAppUrl);
  const routes = (request?.routes ?? []).filter(safeRoute);
  if (!bases.length || !routes.length) return [];
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const observations = [];
  try {
    for (const base of bases) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const signedIn = await signIn(page, base);
      const host = new URL(base).host;
      for (const route of routes) {
        let status = 0;
        try {
          const response = await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded', timeout: 20000 });
          status = response ? response.status() : 0;
        } catch {
          status = 0;
        }
        const final = new URL(page.url());
        const text = await page.locator('body').innerText().catch(() => '');
        observations.push({
          base,
          route,
          status,
          finalPath: final.pathname,
          finalHost: final.host,
          title: await page.title().catch(() => ''),
          text: text.replace(/\s+/g, ' ').slice(0, 400),
          ok: signedIn && status >= 200 && status < 400 && final.host === host && !final.pathname.startsWith('/login') && !final.pathname.startsWith('/qa/login'),
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return observations;
}

async function main() {
  try {
    process.stdout.write(JSON.stringify({ observations: await drive(await readRequest()) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ observations: [], error: 'the browser drive failed' }));
    console.error(String(error && error.message || 'drive failed').replace(/[\w.+-]+@[\w.-]+/g, '[redacted]'));
    process.exitCode = 1;
  }
}

module.exports = { drive, signIn };

if (require.main === module) main();
