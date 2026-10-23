import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./qa-identity', import.meta.url));
const fixtureValue = 'fixture-private-session';
const filteredValue = 'fixture-filtered-session';
const cookie = (overrides = {}) => ({
  name: 'fixture_session',
  value: fixtureValue,
  domain: 'app.hypertask.ai',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  ...overrides,
});

async function run(t, { cookies = [cookie()], raw, missing = false, args = [], handler, expected, code }) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-identity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  if (!missing) await writeFile(stateFile, raw ?? JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
  let requests = 0;
  let receivedCookie;
  const server = http.createServer((req, res) => {
    requests++;
    receivedCookie = req.headers.cookie;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/users/getById');
    if (handler) return handler(req, res);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 985 }));
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [script, stateFile, ...(args.includes('--base-url') ? [] : ['--base-url', baseUrl]), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  for (const secret of [fixtureValue, filteredValue, ...cookies.map(item => item?.value).filter(Boolean)]) {
    assert.ok(!stdout.includes(secret) && !stderr.includes(secret), 'cookie values must not appear in output');
  }
  assert.ok(!stdout.includes('fixture_session') && !stderr.includes('fixture_session'), 'cookie names must not appear in output');
  assert.equal(exit, code);
  assert.equal(stderr, '');
  assert.equal(stdout, `${expected}\n`);
  return { requests, receivedCookie };
}

test('ok with expected identity and app cookie', async t => {
  const result = await run(t, { args: ['--expect', '985'], code: 0, expected: 'identity ok: user 985' });
  assert.equal(result.requests, 1);
  assert.ok(result.receivedCookie === `fixture_session=${fixtureValue}`, 'expected app cookie must reach the endpoint');
});

test('ok without --expect and with an unexpired parent-domain cookie', async t => {
  const result = await run(t, {
    cookies: [cookie({ domain: '.hypertask.ai', expires: Date.now() / 1000 + 3600 })],
    code: 0, expected: 'identity ok: user 985',
  });
  assert.ok(result.receivedCookie === `fixture_session=${fixtureValue}`, 'parent-domain cookie must reach the endpoint');
});

test('mismatch is not expiry', async t => {
  await run(t, { args: ['--expect', '2343'], code: 1, expected: 'identity mismatch: user 985, expected 2343' });
});

for (const status of [401, 403]) {
  test(`expired on server refusal ${status} without echoing its body`, async t => {
    await run(t, {
      handler: (_req, res) => { res.writeHead(status); res.end(fixtureValue); },
      code: 3, expected: `identity expired: the server refused this state (${status})`,
    });
  });
}

test('no cookies is unreadable without contacting the server', async t => {
  const result = await run(t, { cookies: [], code: 2, expected: 'identity unreadable: no valid app cookies' });
  assert.equal(result.requests, 0);
});

for (const [label, overrides] of [
  ['expired', { expires: Date.now() / 1000 - 3600 }],
  ['wrong-domain', { domain: '.elsewhere.example' }],
  ['domain suffix spoof', { domain: 'hypertask.ai' }],
  ['domain prefix spoof', { domain: 'app.hypertask.ai.attacker.example' }],
  ['wrong-path', { path: '/api/users/getById-other' }],
]) {
  test(`${label} cookie is filtered while a valid cookie still works`, async t => {
    const result = await run(t, {
      cookies: [cookie(), cookie({ ...overrides, name: 'filtered_session', value: filteredValue })],
      code: 0, expected: 'identity ok: user 985',
    });
    assert.ok(result.receivedCookie === `fixture_session=${fixtureValue}`, 'only the valid cookie may reach the endpoint');
  });
  test(`${label} cookie alone cannot authenticate`, async t => {
    const result = await run(t, {
      cookies: [cookie(overrides)],
      ...(label === 'expired'
        ? { code: 3, expected: 'identity expired: every app cookie in this state has expired' }
        : { code: 2, expected: 'identity unreadable: no valid app cookies' }),
    });
    assert.equal(result.requests, 0);
  });
}

for (const [label, options, expected] of [
  ['missing file', { missing: true }, 'cannot read a valid storage-state JSON file'],
  ['invalid JSON', { raw: `{${fixtureValue}` }, 'cannot read a valid storage-state JSON file'],
  ['invalid structure', { raw: '{}' }, 'storage state must contain a cookies array'],
  ['invalid cookie', { cookies: [cookie({ value: `${fixtureValue}\n` })] }, 'invalid storage-state cookie'],
  ['invalid expected id', { args: ['--expect', fixtureValue] }, 'expected user id must be a positive integer'],
  ['non-loopback test URL', { args: ['--base-url', `https://${fixtureValue}.example`] }, 'test base URL must be an HTTP origin on 127.0.0.1'],
]) {
  test(`${label} is safely unreadable`, async t => {
    const result = await run(t, { ...options, code: 2, expected: `identity unreadable: ${expected}` });
    assert.equal(result.requests, 0);
  });
}

test('network error is unreadable without printing error details', async t => {
  await run(t, {
    handler: req => req.socket.destroy(), code: 2, expected: 'identity unreadable: network error',
  });
});

test('server error is not expiry', async t => {
  await run(t, {
    handler: (_req, res) => { res.writeHead(500); res.end(fixtureValue); },
    code: 2, expected: 'identity unreadable: unexpected server status (500)',
  });
});

test('redirects are not followed', async t => {
  const result = await run(t, {
    handler: (_req, res) => { res.writeHead(302, { Location: '/login' }); res.end(); },
    code: 2, expected: 'identity unreadable: unexpected server status (302)',
  });
  assert.equal(result.requests, 1);
});

for (const body of [fixtureValue, JSON.stringify({ id: fixtureValue }), JSON.stringify({ id: null })]) {
  test('invalid identity response cannot echo server data or silently pass', async t => {
    await run(t, {
      handler: (_req, res) => res.end(body), code: 2,
      expected: body === fixtureValue ? 'identity unreadable: invalid identity response' : 'identity unreadable: response has no valid user id',
    });
  });
}
