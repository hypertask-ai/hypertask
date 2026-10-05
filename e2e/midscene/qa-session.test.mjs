import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, cleanupQa, APP_ORIGIN } from './qa-session.mjs';

function harness(t, respond) {
  const calls = [];
  const warnings = [];
  const delays = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  t.mock.method(globalThis, 'setTimeout', (resolve, delay) => { delays.push(delay); resolve(); });
  t.mock.method(globalThis, 'fetch', async (route, options) => {
    calls.push({ route, ...options });
    const response = await respond(route, options, calls);
    return { status: 200, json: async () => response };
  });
  const page = { url: () => `${APP_ORIGIN}/favicon.ico`, evaluate: (fn, req) => fn(req) };
  return { page, calls, warnings, delays };
}

function fixture() {
  return { project: { id: 6859, title: 'QA Sandbox' }, title: 'unique run', tasks: [123], pending: [], uploads: [] };
}

function cleanupHarness(t, onDelete) {
  let removed = false;
  return harness(t, async (route, options, calls) => {
    if (route.includes('getAllForAssignees')) return { owner: { id: 2343 }, members: [] };
    if (route.includes('boardTasks')) return { tasks: removed ? [] : [{ id: 123, title: 'unique run' }] };
    if (route.includes('getTaskMinimal')) return removed ? null : { id: 123, status: 'Deleted' };
    if (route.includes('deleteTask')) {
      await onDelete(() => { removed = true; }, calls.filter((c) => c.route === route).length);
    }
    if (route.includes('reminders/getAll')) return [];
    return {};
  });
}

test('cleanup retries failed fetches at most three times with increasing backoff', async (t) => {
  const h = cleanupHarness(t, (remove, attempt) => {
    if (attempt < 3) throw new TypeError('Failed to fetch');
    remove();
  });
  await cleanupQa(h.page, fixture());
  assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 3);
  assert.deepEqual(h.delays, [250, 500]);
  assert.equal(h.warnings.length, 2);
  assert(h.warnings.every((line) => line.includes(`DELETE ${APP_ORIGIN}/api/tasks/deleteTask`) && line.includes('status unavailable')));
  assert(h.warnings.every((line) => !line.includes('taskId=') && !line.includes('unique run')));
});

test('a soft-deleted task missing from the normal board is not mistaken for permanent absence', async (t) => {
  const h = cleanupHarness(t, (remove, attempt) => {
    if (attempt === 1) throw new TypeError('Failed to fetch');
    remove();
  });
  const evaluate = h.page.evaluate;
  let boardReads = 0;
  t.mock.method(h.page, 'evaluate', async (fn, req) => {
    if (req.route.includes('boardTasks') && ++boardReads > 1) return { status: 200, body: { tasks: [] } };
    return evaluate(fn, req);
  });
  await cleanupQa(h.page, fixture());
  assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 2);
  assert(h.calls.some((c) => c.route.includes('getTaskMinimal')));
});

test('persistent network failure exhausts the bound and still checks final absence', async (t) => {
  const h = cleanupHarness(t, () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(cleanupQa(h.page, fixture()), /QA cleanup failed:.*DELETE.*Failed to fetch.*QA fixture task still exists/);
  assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 3);
  assert.deepEqual(h.delays, [250, 500]);
  assert.equal(h.calls.at(-1).route, '/api/reminders/getAll');
});

test('lost successful deletion response is confirmed absent without another DELETE', async (t) => {
  const h = cleanupHarness(t, (remove) => { remove(); throw new TypeError('Failed to fetch'); });
  await cleanupQa(h.page, fixture());
  assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 1);
  assert.deepEqual(h.delays, []);
});

test('HTTP failures are logged but never retried, including after a network failure', async (t) => {
  let attempt = 0;
  const h = harness(t, () => ({}));
  t.mock.method(globalThis, 'fetch', async () => {
    attempt++;
    if (attempt === 1) throw new TypeError('Failed to fetch');
    return { status: 503, json: async () => ({ secret: 'do not log' }) };
  });
  await assert.rejects(api(h.page, '/api/tasks/deleteTask?taskId=123', 'DELETE', undefined, { retryNetworkErrors: true }), /HTTP 503/);
  assert.equal(attempt, 2);
  assert.deepEqual(h.delays, [250]);
  assert.match(h.warnings.at(-1), /DELETE https:\/\/app\.hypertask\.ai\/api\/tasks\/deleteTask failed: HTTP 503/);
  assert(h.warnings.every((line) => !line.includes('do not log') && !line.includes('taskId=')));
});

test('HTTP authorization and not-found failures never retry or invoke absence confirmation', async (t) => {
  const h = harness(t, () => ({}));
  for (const status of [401, 403, 404, 500]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return { status, json: async () => ({}) };
    });
    await assert.rejects(api(h.page, '/api/tasks/deleteTask', 'DELETE', undefined, {
      retryNetworkErrors: true,
      confirmAbsent: () => assert.fail('HTTP failures must not be masked'),
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
  assert.deepEqual(h.delays, []);
});

test('cleanup retries reminder and upload disposal but confirms a lost chat deletion response', async (t) => {
  const attempts = new Map();
  const own = fixture();
  let removed = false;
  own.uploads = [{ grant: 'private-grant', keys: ['own-key'], urls: [] }];
  own.sessions = ['own-chat'];
  const h = harness(t, (route) => {
    if (route.includes('getAllForAssignees')) return { owner: { id: 2343 }, members: [] };
    if (route.includes('boardTasks')) return { tasks: removed ? [] : [{ id: 123, title: 'unique run' }] };
    if (route.includes('deleteTask')) { removed = true; return {}; }
    if (route.includes('reminders/getAll')) return [];
    if (route.includes('all-sessions')) return { sessions: [] };
    const attempt = (attempts.get(route) || 0) + 1;
    attempts.set(route, attempt);
    if (attempt === 1) throw new TypeError('Failed to fetch');
    return {};
  });
  await cleanupQa(h.page, own);
  assert.equal(attempts.get('/api/tasks/uploadFinalize'), 2);
  assert.equal(attempts.get('/api/ai-chat/delete-session?delete=own-chat'), 1);
  assert(h.warnings.every((line) => !line.includes('private-grant') && !line.includes('own-key') && !line.includes('own-chat')));
  assert.equal(attempts.get('/api/queues/tasks/taskDeleteReminder'), 2);
});

test('ordinary API mutations never retry network failures', async (t) => {
  const h = harness(t, () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api(h.page, '/api/tasks/create', 'POST', { title: 'unique run' }), /POST.*Failed to fetch/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.delays, []);
});

test('application and evaluation errors are never mistaken for failed fetches', async (t) => {
  const h = harness(t, () => { throw new TypeError('Invalid request'); });
  await assert.rejects(api(h.page, '/api/tasks/deleteTask', 'DELETE', undefined, { retryNetworkErrors: true }), /Invalid request/);
  assert.equal(h.calls.length, 1);
  t.mock.method(h.page, 'evaluate', async () => { throw new Error('Execution context was destroyed'); });
  await assert.rejects(api(h.page, '/api/tasks/deleteTask', 'DELETE', undefined, { retryNetworkErrors: true }), /Execution context was destroyed/);
  assert.deepEqual(h.delays, []);
});

test('cleanup keeps ownership and run-specific task checks ahead of deletion', async (t) => {
  const h = cleanupHarness(t, (remove) => remove());
  const unrelated = fixture();
  unrelated.tasks = [999];
  await assert.rejects(cleanupQa(h.page, unrelated), /Refusing cleanup/);
  const shared = fixture();
  shared.project.title = 'another board';
  await assert.rejects(cleanupQa(h.page, shared), /Refusing mutations/);
  assert(!h.calls.some((c) => c.method === 'DELETE'));
});

test('a successful response does not bypass the final task absence check', async (t) => {
  const h = cleanupHarness(t, () => {});
  await assert.rejects(cleanupQa(h.page, fixture()), /QA fixture task still exists/);
  assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 1);
});
