import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./qa-teams', import.meta.url));
const FREE = '308dcc93-8076-4e30-a982-ae8b0df82cee';
const PRO = '2ce0d9f8-4179-489d-bbce-2b0e197f8067';
const BYOK = '977c0c91-c14f-47b0-b8bc-933cc751f19d';
const sessionValue = 'fixture-private-session';
const customerId = 'cus_fixture_private';
const future = new Date(Date.now() + 86_400_000 * 300).toISOString();
const futureDay = future.slice(0, 10);

const cookie = (overrides = {}) => ({
  name: 'fixture_session', value: sessionValue, domain: 'app.hypertask.ai', path: '/', expires: -1, ...overrides,
});
const team = (id, overrides = {}) => ({
  id, title: 'MyTeam', compedUntil: null, compedPlan: 'Pro', activeSubscriptionPlanId: null, stripe_customer_id: customerId, ...overrides,
});
const healthyTeams = {
  free: [team(FREE), team('92cce623-ccfe-4783-8e3e-77ce5a04d058')],
  pro: [team(PRO, { compedUntil: future, compedPlan: 'Pro' }), team('da1f255e-7686-4585-afa3-e1da3e6507a8')],
  byok: [team(BYOK, { compedUntil: future, compedPlan: 'BYOK' })],
};
const healthyUsage = {
  [FREE]: { fundingSource: 'shared', maskedKey: 'vck_canary****', allowance: { budgetUsd: 1, remainingUsd: 0.924265, capped: false } },
  [PRO]: { fundingSource: 'managed', allowance: null, apiKey: 'sk-canary-private' },
  [BYOK]: { fundingSource: 'customer', allowance: null },
};
const STATE_FILES = { free: 'state-free.json', pro: 'state-pro.json', byok: 'state-byok.json' };
const USER_BY_TIER = { free: 3411, pro: 3413, byok: 3412 };
const SESSION_BY_TIER = { free: 'sess-free', pro: 'sess-pro', byok: 'sess-byok' };

async function run(t, { args = [], teams = healthyTeams, usage = healthyUsage, users = USER_BY_TIER, cookies = {}, handler, skipState = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-teams-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [tier, file] of Object.entries(STATE_FILES)) {
    if (skipState.includes(tier)) continue;
    await writeFile(join(dir, file), JSON.stringify({ cookies: cookies[tier] ?? [cookie({ value: SESSION_BY_TIER[tier] })], origins: [] }), { mode: 0o600 });
  }
  const seen = [];
  const server = http.createServer((req, res) => {
    const who = Object.entries(SESSION_BY_TIER).find(([, value]) => req.headers.cookie === `fixture_session=${value}`)?.[0];
    seen.push({ method: req.method, url: req.url, who });
    if (handler) return handler(req, res, who);
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/users/getById') return res.end(JSON.stringify({ id: users[who] }));
    if (req.method === 'POST' && url.pathname === '/api/teams/getAllMinimal') return res.end(JSON.stringify(teams[who] ?? []));
    if (req.method === 'GET' && url.pathname === '/api/settings/ai-usage') {
      const body = usage[url.searchParams.get('teamId')];
      if (body === 502) { res.writeHead(502); return res.end(JSON.stringify({ message: 'Could not load AI Gateway usage' })); }
      return res.end(JSON.stringify(body ?? {}));
    }
    res.writeHead(404);
    res.end('{}');
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [script, '--base-url', baseUrl, '--state-dir', dir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  for (const secret of [sessionValue, customerId, ...Object.values(SESSION_BY_TIER), 'fixture_session', 'stripe_customer_id', 'sk-canary', 'vck_canary']) {
    assert.ok(!stdout.includes(secret) && !stderr.includes(secret), `${secret} must not appear in output`);
  }
  assert.equal(stderr, '');
  return { code, stdout, seen };
}

const healthyOutput = [
  'free | Free | not comped | $0.92 of $1.00 left | shared | OK',
  `pro | Pro | comped until ${futureDay} | n/a | managed | OK`,
  `byok | BYOK | comped until ${futureDay} | n/a | own key | OK`,
  '',
].join('\n');

test('prints one health line per named team and exits 0 when all are healthy', async t => {
  const { code, stdout } = await run(t);
  assert.equal(code, 0);
  assert.equal(stdout, healthyOutput);
});

test('running twice prints identical output', async t => {
  const first = await run(t);
  const second = await run(t);
  assert.equal(first.stdout, second.stdout);
});

test('a single named team prints only its own line', async t => {
  const { code, stdout } = await run(t, { args: ['pro'] });
  assert.equal(code, 0);
  assert.equal(stdout, healthyOutput.split('\n')[1] + '\n');
});

for (const args of [
  [FREE],
  ['2343'],
  ['--team', PRO],
  ['all'],
  ['free', 'free'],
  ['--base-url', 'https://app.hypertask.ai'],
]) {
  test(`refuses ${JSON.stringify(args)} without contacting the server`, async t => {
    const { code, stdout, seen } = await run(t, { args });
    assert.equal(code, 2);
    assert.match(stdout, /^refused: /);
    assert.equal(seen.length, 0);
  });
}

test('only reads: every request is the identity GET, the team list POST or the usage GET', async t => {
  const { seen } = await run(t);
  assert.equal(seen.length, 9);
  for (const request of seen) {
    const path = request.url.split('?')[0];
    assert.ok(
      (request.method === 'POST' && path === '/api/teams/getAllMinimal') ||
      (request.method === 'GET' && path === '/api/users/getById') ||
      (request.method === 'GET' && path === '/api/settings/ai-usage'),
      `${request.method} ${request.url} is not an allowed read`,
    );
  }
});

test('each tier cookie only reaches its own requests and asks only about its own team', async t => {
  const { seen } = await run(t);
  assert.equal(seen.filter(request => request.who === undefined).length, 0);
  const usageTeams = seen.filter(request => request.url.includes('ai-usage')).map(request => `${request.who}:${new URL(request.url, 'http://127.0.0.1').searchParams.get('teamId')}`);
  assert.deepEqual(usageTeams.sort(), [`byok:${BYOK}`, `free:${FREE}`, `pro:${PRO}`]);
});

test('a Free team that shows comped is a mismatch', async t => {
  const { code, stdout } = await run(t, { teams: { ...healthyTeams, free: [team(FREE, { compedUntil: future })] } });
  assert.equal(code, 1);
  assert.match(stdout, /^free \| Pro \| comped until .* \| MISMATCH: expected Free$/m);
});

test('a comped team whose comp has lapsed is a mismatch', async t => {
  const { code, stdout } = await run(t, { teams: { ...healthyTeams, pro: [team(PRO, { compedUntil: '2020-01-01T00:00:00.000Z' })] } });
  assert.equal(code, 1);
  assert.match(stdout, /^pro \| Free \| not comped \| .* \| MISMATCH: expected Pro$/m);
});

test('a team missing from the login is a mismatch', async t => {
  const { code, stdout } = await run(t, { teams: { ...healthyTeams, byok: [team('11111111-1111-1111-1111-111111111111')] } });
  assert.equal(code, 1);
  assert.match(stdout, /^byok \| - \| - \| - \| MISMATCH: team not in this login$/m);
});

test('a failing usage report is unavailable, not a crash, and keeps the plan', async t => {
  const { code, stdout } = await run(t, { usage: { ...healthyUsage, [BYOK]: 502 } });
  assert.equal(code, 1);
  assert.match(stdout, /^byok \| BYOK \| comped until .* \| - \| - \| UNAVAILABLE: \/api\/settings\/ai-usage answered 502$/m);
  assert.match(stdout, /^free \| .* \| OK$/m);
});

for (const status of [401, 403]) {
  test(`server refusal ${status} reports an expired login with exit 3`, async t => {
    const { code, stdout } = await run(t, { handler: (_req, res) => { res.writeHead(status); res.end(sessionValue); } });
    assert.equal(code, 3);
    assert.match(stdout, /EXPIRED: login refused by the server/);
  });
}

test('an expired cookie reports an expired login without contacting the server for that tier', async t => {
  const { code, stdout, seen } = await run(t, { cookies: { free: [cookie({ expires: Date.now() / 1000 - 3600 })] } });
  assert.equal(code, 3);
  assert.match(stdout, /^free \| - \| - \| - \| EXPIRED: login expired$/m);
  assert.equal(seen.filter(request => request.who === undefined).length, 0);
  assert.match(stdout, /^pro \| .* \| OK$/m);
});

test('a cookie for another domain is never sent', async t => {
  const { code, stdout, seen } = await run(t, { cookies: { free: [cookie({ domain: '.elsewhere.example' })] } });
  assert.equal(code, 1);
  assert.match(stdout, /^free \| - \| - \| - \| UNAVAILABLE: no app cookies$/m);
  assert.equal(seen.length, 6);
});

test('a missing state file is unavailable', async t => {
  const { code, stdout } = await run(t, { skipState: ['byok'] });
  assert.equal(code, 1);
  assert.match(stdout, /^byok \| - \| - \| - \| UNAVAILABLE: cannot read login state$/m);
});

test('a pro team with no managed key source is a mismatch', async t => {
  const { code, stdout } = await run(t, { usage: { ...healthyUsage, [PRO]: { fundingSource: null, allowance: null } } });
  assert.equal(code, 1);
  assert.match(stdout, /^pro \| Pro \| comped until .* \| n\/a \| none \| MISMATCH: expected managed key source$/m);
});

test('a login that belongs to another user is a mismatch and never asks about teams', async t => {
  const { code, stdout, seen } = await run(t, { users: { ...USER_BY_TIER, pro: 3412 } });
  assert.equal(code, 1);
  assert.match(stdout, /^pro \| - \| - \| - \| MISMATCH: login is not user 3413$/m);
  assert.equal(seen.filter(request => request.who === 'pro' && request.url.includes('getAllMinimal')).length, 0);
});

test('a redirect is unavailable and is not followed', async t => {
  const { code, stdout, seen } = await run(t, {
    handler: (req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' }); res.end(); },
  });
  assert.equal(code, 1);
  assert.match(stdout, /UNAVAILABLE: \/api\/users\/getById answered 302/);
  assert.equal(seen.length, 3);
});

test('a revoked session that still lists teams reports expired when the usage read is refused', async t => {
  const { code, stdout } = await run(t, {
    handler: (req, res, who) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/users/getById') return res.end(JSON.stringify({ id: USER_BY_TIER[who] }));
      if (url.pathname === '/api/teams/getAllMinimal') return res.end(JSON.stringify(healthyTeams[who]));
      res.writeHead(401);
      res.end('{}');
    },
  });
  assert.equal(code, 3);
  assert.match(stdout, /^pro \| Pro \| comped until .* \| - \| - \| EXPIRED: login refused by the server$/m);
});

test('a null comped plan on a comped team reads as Pro', async t => {
  const { code, stdout } = await run(t, { args: ['pro'], teams: { ...healthyTeams, pro: [team(PRO, { compedUntil: future, compedPlan: null })] } });
  assert.equal(code, 0);
  assert.match(stdout, /^pro \| Pro \| comped until .* \| OK$|OK\n$/);
});
