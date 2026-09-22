#!/usr/bin/env node
// Bounded production checks. Secrets stay in memory outside the Strix sandbox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const origin = 'https://app.hypertask.ai';
const output = path.resolve(process.argv[2] || 'strix-live-results');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const installed = path.join(os.homedir(), '.local/lib/strix-runner');
const helper = process.env.STRIX_AUTH_HELPER || path.join(installed, 'verification-auth/app-auth.mjs');
const playwright = process.env.STRIX_PLAYWRIGHT_MODULE || path.join(installed, 'node_modules/playwright/index.mjs');
const executablePath = process.env.STRIX_BROWSER || path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell');
const results = { startedAt: new Date().toISOString(), origin, completed: false, checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'live-results.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
function record(area, name, pass, evidence) {
  const row = { area, name, status: pass ? 'passed' : 'failed', evidence };
  results.checks.push(row); save(); console.log(JSON.stringify(row));
}
let requests = 0;
async function request(route, options = {}) {
  if (++requests > 45) throw new Error('Live probe request limit reached');
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('Live probe origin is outside scope');
  await new Promise(resolve => setTimeout(resolve, 1100));
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(25000) });
}
async function reject(area, name, route, options = {}) {
  const response = await request(route, options);
  // A missing route or a server error does not prove an authentication check.
  record(area, name, [400, 401, 403].includes(response.status), { status: response.status });
  await response.body?.cancel();
}
const rpc = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'strix-security-check', version: '1' },
} };
const rpcHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
let browser;
try {
  const version = await request('/api/version'); results.build = await version.json(); save();
  await reject('mcp', 'Missing bearer is rejected', '/api/mcp/projects');
  await reject('mcp', 'Malformed bearer is rejected', '/api/mcp/projects', { headers: { Authorization: 'Bearer invalid.security.test' } });
  await reject('mcp', 'Unauthenticated JSON-RPC is rejected', '/mcp', { method: 'POST', headers: rpcHeaders, body: JSON.stringify(rpc) });
  const { loadProductionAuth, loginTestAccount, signHs256Jwt } = await import(pathToFileURL(helper));
  const auth = await loadProductionAuth();
  const session = await loginTestAccount(auth, { fetchImpl: (url, options) => request(url, options) });
  if (session.user.id === 6) throw new Error('Owner sessions are outside the test scope');
  record('login', 'Dedicated QA account signs in through email-link verification', true, { userId: session.user.id });
  record('login', 'Signed session cookie has browser protections', session.cookies.some(c => c.name === 'ht_session' && c.httpOnly && c.secure && c.sameSite === 'Lax'),
    { cookies: session.cookies.map(({ name, httpOnly, secure, sameSite }) => ({ name, httpOnly, secure, sameSite })) });
  const profile = `/api/users/getById?userId=${session.user.id}`;
  await reject('api', 'Profile rejects missing session', profile);
  await reject('api', 'Profile rejects forged display cookie', profile, { headers: { Cookie: 'nookies_user=' + encodeURIComponent(JSON.stringify({ id: session.user.id, email: session.user.email })) } });
  const signed = { Cookie: session.cookieHeader };
  let response = await request(profile, { headers: signed });
  let data = await response.json();
  record('api', 'Signed session reads its own profile', response.status === 200 && Number(data.id) === session.user.id, { status: response.status, correctAccount: Number(data.id) === session.user.id });
  response = await request(profile, { headers: { ...signed, Origin: 'https://strix-cross-origin.invalid' } });
  const allowOrigin = response.headers.get('access-control-allow-origin');
  const allowCredentials = response.headers.get('access-control-allow-credentials');
  record('api', 'Untrusted origin receives no credentialed CORS access',
    !(allowOrigin === 'https://strix-cross-origin.invalid' && allowCredentials === 'true'),
    { status: response.status, allowOrigin, allowCredentials });
  await response.body?.cancel();
  await reject('login', 'Invalid email-link token is rejected', '/api/auth/verify-email-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'invalid.security.test' }) });
  const bearer = { Authorization: 'Bearer ' + session.mcpToken };
  response = await request('/api/mcp/projects?limit=1', { headers: bearer }); data = await response.json();
  record('mcp', 'Valid QA bearer can list its projects', response.status === 200 && data.success === true, { status: response.status });
  const wrongAudience = signHs256Jwt({ sub: session.user.email, userId: session.user.id }, auth.jwtSecret, { issuer: auth.jwtIssuer, audience: 'email-link' });
  await reject('mcp', 'Email-link audience cannot authorize MCP', '/api/mcp/projects', { headers: { Authorization: 'Bearer ' + wrongAudience } });
  const expired = signHs256Jwt({ sub: session.user.email, userId: session.user.id, exp: Math.floor(Date.now() / 1000) - 60 }, auth.jwtSecret, { issuer: auth.jwtIssuer, audience: 'mcp-api' });
  await reject('mcp', 'Expired signed token is rejected', '/api/mcp/projects', { headers: { Authorization: 'Bearer ' + expired } });
  response = await request('/mcp', { method: 'POST', headers: { ...rpcHeaders, ...bearer }, body: JSON.stringify(rpc) });
  const rpcText = await response.text();
  record('mcp', 'Valid QA bearer initializes JSON-RPC', response.status === 200 && rpcText.includes('protocolVersion'), { status: response.status });

  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'strix-cli-'));
  try {
    for (const valid of [true, false]) {
      const cli = spawnSync(process.env.STRIX_CLI || 'hypertask', ['--api-url', origin + '/api', 'project', 'list', '--json'], {
        env: { PATH: process.env.PATH, HOME: cliHome, HYPERTASKS_JWT_TOKEN: valid ? session.mcpToken : 'invalid.security.test' },
        encoding: 'utf8', timeout: 30000,
      });
      let parsed; try { parsed = JSON.parse(cli.stdout); } catch { /* Report a failed positive control. */ }
      record('cli', valid ? 'Native CLI accepts QA bearer' : 'Native CLI rejects malformed bearer',
        !cli.error && (valid ? cli.status === 0 && parsed?.success === true : cli.status !== 0), { exitCode: cli.status });
    }
  } finally { fs.rmSync(cliHome, { recursive: true, force: true }); }
  const redirectCheck = spawnSync('python3', [fileURLToPath(new URL('./strix-cli-check.py', import.meta.url))], {
    env: process.env, encoding: 'utf8', timeout: 30000,
  });
  if (redirectCheck.error || ![0, 2].includes(redirectCheck.status)) throw new Error('CLI redirect probe could not run');
  const redirectEvidence = JSON.parse(redirectCheck.stdout);
  record('cli', 'CLI does not forward credentials to a different host', !redirectEvidence.authorizationForwarded, redirectEvidence);

  const { chromium } = await import(pathToFileURL(playwright));
  browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const anonymous = await browser.newContext(); const login = await anonymous.newPage();
  await login.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await login.getByText(/continue with google/i).first().waitFor({ timeout: 20000 });
  await login.screenshot({ path: path.join(output, 'login.png') });
  record('website', 'Regular browser renders login controls', true, { path: new URL(login.url()).pathname });
  const context = await browser.newContext(); await context.addCookies(session.cookies);
  const page = await context.newPage();
  await page.goto(origin + '/settings', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  const text = await page.locator('body').innerText();
  await page.screenshot({ path: path.join(output, 'authenticated-app.png') });
  record('website', 'Signed-in browser renders the regular app', new URL(page.url()).pathname === '/settings' && /settings|profile/i.test(text), { path: new URL(page.url()).pathname });
  if (process.env.STRIX_OAUTH_FIXTURE) {
    const fixture = JSON.parse(fs.readFileSync(process.env.STRIX_OAUTH_FIXTURE, 'utf8'));
    const params = new URLSearchParams({ response_type: 'code', client_id: fixture.clientId, redirect_uri: fixture.redirectUri,
      code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'), code_challenge_method: 'S256', state: 'strix-consent-check' });
    response = await request('/oauth/authorize?' + params, { headers: signed });
    const location = response.headers.get('location'); const next = location ? new URL(location, origin) : null;
    record('oauth', 'OAuth GET requires approval and issues no code', response.status === 307 && next?.origin === origin && next.pathname === '/oauth/consent' && !next.searchParams.has('code'), { status: response.status, path: next?.pathname });
    response = await request('/oauth/authorize', { method: 'POST', headers: { ...signed, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const unapprovedLocation = response.headers.get('location');
    const unapproved = unapprovedLocation ? new URL(unapprovedLocation, origin) : null;
    record('oauth', 'OAuth POST without consent proof issues no code', response.status === 303 && unapproved?.origin === origin && unapproved.pathname === '/oauth/consent' && !unapproved.searchParams.has('code'), { status: response.status, path: unapproved?.pathname });
    if (next?.origin === origin && next.pathname === '/oauth/consent') {
      await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.getByText(/approve/i).first().waitFor({ timeout: 20000 });
      await page.screenshot({ path: path.join(output, 'oauth-consent.png') });
      record('oauth', 'Browser shows OAuth approval controls', true, { path: new URL(page.url()).pathname });
    }
  } else {
    results.checks.push({ area: 'oauth', name: 'OAuth approval fixture', status: 'blocked', evidence: { reason: 'STRIX_OAUTH_FIXTURE is not configured' } });
  }
  results.completed = true;
} catch (error) {
  results.checks.push({ area: 'runner', name: 'Live checks completed', status: 'blocked', evidence: {
    error: String(error).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]'),
  } });
} finally {
  await browser?.close();
  results.finishedAt = new Date().toISOString(); save();
  process.exitCode = results.checks.some(c => c.status === 'blocked') ? 1 : results.checks.some(c => c.status === 'failed') ? 2 : 0;
}
