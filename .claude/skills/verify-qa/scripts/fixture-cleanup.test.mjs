import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./fixture-cleanup', import.meta.url));
const cookieValue = 'fixture-private-session';
const cookie = (overrides = {}) => ({
  name: 'fixture_session',
  value: cookieValue,
  domain: 'app.hypertask.ai',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  ...overrides,
});

async function run(t, { cookies = [cookie()], args = ['83060'], replies = {}, expected, code, requests: expectedRequests }) {
  const dir = await mkdtemp(join(tmpdir(), 'fixture-cleanup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, cookie: req.headers.cookie });
      const entry = replies[`${req.method} ${req.url.split('?')[0]}`] ?? { status: 200, json: { message: 'Success' } };
      const reply = typeof entry === 'function' ? entry({ body, url: req.url }) : entry;
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.json === null ? 'null' : JSON.stringify(reply.json));
    });
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [script, stateFile, ...args, '--base-url', baseUrl], {
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
  assert.ok(!stdout.includes(cookieValue) && !stderr.includes(cookieValue), 'cookie values must not appear in output');
  assert.equal(stderr, '');
  assert.equal(exit, code);
  assert.equal(stdout, `${expected.join('\n')}\n`);
  if (expectedRequests !== undefined) assert.equal(seen.length, expectedRequests);
  return seen;
}

const cleaned = {
  'POST /api/queues/tasks/taskDeleteReminder': { status: 200, json: { id: 83060 } },
  'DELETE /api/tasks/deleteTask': { status: 200, json: { message: 'Success' } },
  'POST /api/tasks/getTaskMinimal': { status: 404, json: { message: 'Task not found' } },
};

test('one command trashes, deletes and confirms a fixture is gone', async t => {
  const seen = await run(t, { replies: cleaned, code: 0, expected: ['cleaned 83060'], requests: 3 });
  assert.deepEqual(seen.map(({ method, url }) => `${method} ${url}`), [
    'POST /api/queues/tasks/taskDeleteReminder',
    'DELETE /api/tasks/deleteTask?taskId=83060',
    'POST /api/tasks/getTaskMinimal',
  ]);
  assert.equal(seen[0].body, JSON.stringify({ taskId: 83060 }));
  assert.equal(seen[2].body, JSON.stringify({ id: 83060 }));
  assert.ok(seen.every(({ cookie: sent }) => sent === `fixture_session=${cookieValue}`), 'the app cookie reaches every call');
});

test('several ids are cleaned in order', async t => {
  await run(t, {
    args: ['83060', '83061'],
    replies: cleaned,
    code: 0,
    expected: ['cleaned 83060', 'cleaned 83061'],
    requests: 6,
  });
});

test('a refused trash step stops before the delete', async t => {
  const seen = await run(t, {
    replies: { ...cleaned, 'POST /api/queues/tasks/taskDeleteReminder': { status: 500, json: { message: 'boom' } } },
    code: 1,
    expected: ['failed 83060 trash HTTP 500'],
    requests: 1,
  });
  assert.equal(seen[0].method, 'POST');
});

test('a refused delete names the server code', async t => {
  await run(t, {
    replies: { ...cleaned, 'DELETE /api/tasks/deleteTask': { status: 409, json: { message: 'not in trash', code: 'not_in_trash' } } },
    code: 1,
    expected: ['failed 83060 delete not_in_trash'],
    requests: 2,
  });
});

test('a fixture still readable after the delete is a failure', async t => {
  await run(t, {
    replies: { ...cleaned, 'POST /api/tasks/getTaskMinimal': { status: 200, json: { id: 83060 } } },
    code: 1,
    expected: ['failed 83060 still readable after delete'],
    requests: 3,
  });
});

test('a fixture that is already gone counts as cleaned', async t => {
  await run(t, {
    replies: {
      ...cleaned,
      'POST /api/queues/tasks/taskDeleteReminder': { status: 404, json: { message: 'Task not found' } },
    },
    code: 0,
    expected: ['cleaned 83060'],
    requests: 2,
  });
});

test('a failed read back is reported without claiming the fixture is gone', async t => {
  await run(t, {
    replies: { ...cleaned, 'POST /api/tasks/getTaskMinimal': { status: 500, json: { message: 'boom' } } },
    code: 1,
    expected: ['failed 83060 read back HTTP 500'],
    requests: 3,
  });
});

test('one refused id does not stop the others and still fails the run', async t => {
  await run(t, {
    args: ['1', '2'],
    replies: {
      ...cleaned,
      'DELETE /api/tasks/deleteTask': ({ url }) => url.endsWith('taskId=1')
        ? { status: 409, json: { message: 'Task is being restored', code: 'conflict' } }
        : { status: 200, json: { message: 'Success' } },
    },
    code: 1,
    expected: ['failed 1 delete conflict', 'cleaned 2'],
    requests: 5,
  });
});

test('no app cookie is refused without contacting the server', async t => {
  await run(t, {
    cookies: [cookie({ domain: '.elsewhere.example' })],
    code: 2,
    expected: ['fixture-cleanup no valid app cookies'],
    requests: 0,
  });
});

test('no task id is refused without contacting the server', async t => {
  await run(t, { args: [], code: 2, expected: ['fixture-cleanup usage: fixture-cleanup <state-file> <taskId...> [--base-url <origin>]'], requests: 0 });
});
