const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const modules = Promise.all([
  import('../e2e/midscene/flows/index.mjs'),
  import('../e2e/midscene/qa-session.mjs'),
  import('../e2e/midscene/postprocess.mjs'),
]);

function failureFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midscene-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const screenshotPath = path.join(dir, 'failure.png');
  fs.writeFileSync(screenshotPath, 'test screenshot');
  return { flow: 'signed-in-create-task', ok: false, failedStep: '5. aiTap: Save & close', error: '<failure>', screenshotPath, durationMs: 12 };
}

test('registry retains three demo flows and adds the five signed-in outcomes, not prod-health duplicates', async () => {
  const [{ flows }] = await modules;
  assert.deepEqual(flows.map((f) => f.id), ['board-demo', 'task-detail-demo', 'task-create-demo',
    'signed-in-create-task', 'signed-in-file-upload', 'signed-in-notification', 'signed-in-reminder', 'signed-in-ai-answer']);
  assert.equal(flows.filter((f) => f.signedIn).length, 5);
  assert.equal(new Set(flows.map((f) => f.id)).size, flows.length);
  const actions = new Set(flows.flatMap((f) => f.steps.map((s) => s.action)));
  for (const action of ['verifyCreatedTask', 'verifyUpload', 'moveToInbox', 'verifyReminder', 'createChat']) assert(actions.has(action));
  const manifest = JSON.parse(fs.readFileSync('e2e/midscene/manifest.json'));
  assert.deepEqual(new Set(manifest.flatMap((area) => area.flowIds)), new Set(flows.map((f) => f.id)));
});

test('mutations fail closed for another identity, owner, shared board or name', async () => {
  const [, { assertQaBoard }] = await modules;
  const project = { id: 6859, title: 'QA Sandbox' };
  const members = { owner: { id: 2343 }, members: [] };
  assert.doesNotThrow(() => assertQaBoard(2343, project, members));
  assert.throws(() => assertQaBoard(6, project, members), /plain QA/);
  assert.throws(() => assertQaBoard(985, project, members), /plain QA/);
  assert.throws(() => assertQaBoard(2343, project, { owner: { id: 6 }, members: [] }), /Refusing/);
  assert.throws(() => assertQaBoard(2343, project, { owner: { id: 2343 }, members: [{ user: { id: 6 } }] }), /Refusing/);
  assert.throws(() => assertQaBoard(2343, { ...project, title: 'Hypertasks' }, members), /Refusing/);
  assert.throws(() => assertQaBoard(2343, project, { owner: { id: 2343 } }), /Refusing/);
});

test('fixture substitutions fail closed rather than navigating an unrelated board', async () => {
  const [, { resolveStep }] = await modules;
  assert.deepEqual(resolveStep({ action: 'goto', arg: '{{boardUrl}}' }, { boardUrl: 'https://app.hypertask.ai/project?id=6859' }),
    { action: 'goto', arg: 'https://app.hypertask.ai/project?id=6859' });
  assert.throws(() => resolveStep({ action: 'goto', arg: '{{taskUrl}}' }, {}), /Missing QA fixture/);
});

test('first red files once, repeated red and red after green deduplicate against the board even without local state', async (t) => {
  const [, , { processResults }] = await modules;
  const result = failureFixture(t);
  const tickets = [];
  const plans = [];
  const deps = { listTickets: () => tickets, createTicket: (plan) => {
    plans.push(plan); tickets.push({ title: plan.title, status: 'Normal', section: 'Bugs' });
  }, log: () => {} };
  processResults([result], {}, deps);
  processResults([result], {}, deps);
  processResults([{ ...result, ok: true }, result], {}, deps);
  assert.equal(plans.length, 1);
  assert.match(plans[0].description, /5\. aiTap: Save &amp; close/);
  assert.match(plans[0].description, /&lt;failure&gt;/);
  assert.equal(plans[0].screenshotPath, result.screenshotPath);
  tickets[0].section = 'Done';
  processResults([result], {}, deps);
  assert.equal(plans.length, 2, 'a resolved ticket allows a new incident');
});

test('dry-run prints one plan and suppresses its repeated failure without invoking any board write', async (t) => {
  const [, , { processResults }] = await modules;
  const result = failureFixture(t);
  const logs = [];
  const state = {};
  const deps = { dryRun: true, listTickets: () => [], createTicket: () => assert.fail('board write'), log: (line) => logs.push(line) };
  processResults([result, result], state, deps);
  assert.equal(logs.filter((l) => l.startsWith('DRY RUN:')).length, 1);
  assert.equal(logs.filter((l) => l.startsWith('SUPPRESSED:')).length, 1);
  assert.equal(state[result.flow].dryRunPlanned, true);
});

test('lookup failure, unknown ticket state and missing evidence do not create duplicate or incomplete tickets', async (t) => {
  const [, , { processResults }] = await modules;
  const result = failureFixture(t);
  const deps = { listTickets: () => { throw new Error('lookup failed'); }, createTicket: () => assert.fail('board write'), log: () => {} };
  assert.throws(() => processResults([result], {}, deps), /lookup failed/);
  assert.throws(() => processResults([result], {}, { ...deps, listTickets: () => [{ title: `Midscene nightly: ${result.flow} failing` }] }), /no section\/status/);
  assert.throws(() => processResults([{ ...result, failedStep: null }], {}, deps), /lacks a failing step/);
  assert.throws(() => processResults([{ ...result, screenshotPath: '/missing.png' }], {}, deps), /lacks a failing step/);
});

test('missing evidence or a CLI failure does not suppress a later flow incident', async (t) => {
  const [, , { processResults }] = await modules;
  const first = failureFixture(t);
  const later = { ...first, flow: 'signed-in-file-upload' };
  for (const mode of ['evidence', 'lookup', 'create', 'repair']) {
    const state = {};
    const created = [];
    const deps = {
      listTickets: (title) => {
        if (title.includes(first.flow) && mode === 'lookup') throw new Error('lookup failed');
        return title.includes(first.flow) && mode === 'repair' ? [{ title, status: 'Normal', section: 'Bugs' }] : [];
      },
      createTicket: (plan) => {
        if (plan.flow === first.flow && mode === 'create') throw new Error('create failed');
        created.push(plan.flow);
      },
      ensureScreenshot: () => { throw new Error('repair failed'); },
      log: () => {},
    };
    assert.throws(() => processResults([mode === 'evidence' ? { ...first, screenshotPath: null } : first, later], state, deps), /Incident reporting failed/);
    assert.deepEqual(created, [later.flow], mode);
    assert.equal(state[later.flow].consecutiveFails, 1);
  }
});

test('reporting failure still persists processed state and exits nonzero without a board write', async (t) => {
  const [, , { main }] = await modules;
  const failure = { ...failureFixture(t), screenshotPath: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midscene-state-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resultsPath = path.join(dir, 'results.json');
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ startedAt: new Date().toISOString(), results: [failure, { flow: 'later-green', ok: true }] }));
  assert.throws(() => main([statePath, resultsPath, '1', '15', 'Bugs', '0', String(Date.now() / 1000)]), /Incident reporting failed/);
  const state = JSON.parse(fs.readFileSync(statePath));
  assert.equal(state[failure.flow].consecutiveFails, 1);
  assert.equal(state['later-green'].consecutiveFails, 0);
});

test('stale, invalid timestamp and empty results never reach board lookups or overwrite state', async (t) => {
  const [, , { main }] = await modules;
  const result = failureFixture(t);
  const resultsPath = path.join(path.dirname(result.screenshotPath), 'results.json');
  const statePath = path.join(path.dirname(result.screenshotPath), 'state.json');
  fs.writeFileSync(statePath, '{}');
  for (const payload of [{ startedAt: 'not a date', results: [result] }, { startedAt: '2000-01-01', results: [result] },
    { startedAt: new Date().toISOString(), results: [] }]) {
    fs.writeFileSync(resultsPath, JSON.stringify(payload));
    assert.throws(() => main([statePath, resultsPath, '1', '15', 'Bugs', '1', String(Date.now() / 1000)]), /STALE/);
    assert.equal(fs.readFileSync(statePath, 'utf8'), '{}');
  }
});

test('QA cleanup permanently removes only the exact fixture and discards its granted storage keys even on flow failure', async (t) => {
  const [, { cleanupQa }] = await modules;
  const requests = [];
  let removed = false;
  const fixture = { project: { id: 6859, title: 'QA Sandbox' }, title: 'unique run', tasks: [123], pending: [],
    uploads: [{ grant: 'test-grant', keys: ['test-key'], urls: ['https://storage.example/own-file.txt'] }], sessionId: 'own-session' };
  const deletedObjects = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    deletedObjects.push({ url, method: options.method });
    return { status: 404 };
  });
  const page = { url: () => 'https://app.hypertask.ai/inbox', evaluate: async (_fn, req) => {
    requests.push(req);
    let body = {};
    if (req.route.includes('getAllForAssignees')) body = { owner: { id: 2343 }, members: [] };
    if (req.route.includes('boardTasks')) body = { tasks: removed ? [] : [{ id: 123, title: 'unique run' }, { id: 999, title: 'other task' }] };
    if (req.method === 'DELETE' && req.route.includes('deleteTask')) removed = true;
    if (req.route.includes('reminders/getAll')) body = [];
    return { status: 200, body };
  } };
  await cleanupQa(page, fixture);
  assert(requests.some((r) => r.route === '/api/queues/tasks/taskDeleteReminder' && r.body.taskId === 123));
  assert(requests.some((r) => r.route === '/api/tasks/deleteTask?taskId=123' && r.method === 'DELETE'));
  assert(requests.some((r) => r.route === '/api/tasks/uploadFinalize' && r.body.discard[0] === 'test-key'));
  assert(requests.some((r) => r.route === '/api/ai-chat/delete-session?delete=own-session'));
  assert(!requests.some((r) => r.body?.taskId === 999));
  assert.deepEqual(deletedObjects, [{ url: 'https://storage.example/own-file.txt', method: 'HEAD' }]);
});

test('reminder cancellation failure does not skip permanent task deletion', async () => {
  const [, { cleanupQa }] = await modules;
  let removed = false;
  const fixture = { project: { id: 6859, title: 'QA Sandbox' }, title: 'unique run', tasks: [123], pending: [], uploads: [] };
  const page = { url: () => 'https://app.hypertask.ai/favicon.ico', evaluate: async (_fn, req) => {
    if (req.route.includes('taskDeleteReminder')) return { status: 503, body: null };
    if (req.method === 'DELETE') removed = true;
    return { status: 200, body: req.route.includes('getAllForAssignees') ? { owner: { id: 2343 }, members: [] }
      : req.route.includes('boardTasks') ? { tasks: removed ? [] : [{ id: 123, title: 'unique run' }] }
      : req.route.includes('reminders') ? [] : {} };
  } };
  await assert.rejects(cleanupQa(page, fixture), /taskDeleteReminder failed: HTTP 503/);
  assert.equal(removed, true);
});

test('failed navigation closes React and still cleans through a fresh same-context page', async () => {
  const [, { cleanupQaAfterFlow }] = await modules;
  const events = [];
  let removed = false;
  const fixture = { project: { id: 6859, title: 'QA Sandbox' }, title: 'unique run', tasks: [123], pending: [], uploads: [] };
  const cleanupPage = {
    goto: async () => { events.push('fresh navigation'); },
    close: async () => { events.push('fresh close'); },
    url: () => 'https://app.hypertask.ai/favicon.ico',
    evaluate: async (_fn, req) => {
      if (req.method === 'DELETE') { events.push('delete task'); removed = true; }
      return { status: 200, body: req.route.includes('getAllForAssignees') ? { owner: { id: 2343 }, members: [] }
        : req.route.includes('boardTasks') ? { tasks: removed ? [] : [{ id: 123, title: 'unique run' }] }
        : req.route.includes('reminders') ? [] : {} };
    },
  };
  const page = { goto: async () => { throw new Error('navigation failed'); }, close: async () => { events.push('original close'); },
    browserContext: () => ({ newPage: async () => cleanupPage }) };
  await assert.rejects(cleanupQaAfterFlow(page, fixture, () => events.push('stop observer')), /navigation failed/);
  assert.deepEqual(events, ['original close', 'fresh navigation', 'stop observer', 'delete task', 'fresh close']);
});

test('cleanup rejects an unrelated task id and a storage object that remains accessible', async (t) => {
  const [, { cleanupQa }] = await modules;
  let deletes = 0;
  const fixture = { project: { id: 6859, title: 'QA Sandbox' }, title: 'unique run', tasks: [999], pending: [], uploads: [] };
  const page = { url: () => 'https://app.hypertask.ai/inbox', evaluate: async (_fn, req) => {
    if (req.method === 'DELETE') deletes++;
    return { status: 200, body: req.route.includes('getAllForAssignees') ? { owner: { id: 2343 }, members: [] }
      : req.route.includes('boardTasks') ? { tasks: [] } : req.route.includes('reminders') ? [] : {} };
  } };
  await assert.rejects(cleanupQa(page, fixture), /Refusing cleanup/);
  assert.equal(deletes, 0);
  fixture.tasks = [];
  fixture.uploads = [{ grant: 'test-grant', keys: ['own-key'], urls: ['https://storage.example/own-file'] }];
  t.mock.method(globalThis, 'fetch', async () => ({ status: 200 }));
  await assert.rejects(cleanupQa(page, fixture), /storage cleanup could not be confirmed/);
});

test('fixture observer captures only newly created personal chats, not an agent upsert', async () => {
  const [, { observeFixtures }] = await modules;
  const listeners = {};
  const page = { on: (name, fn) => { listeners[name] = fn; }, off: (name) => { delete listeners[name]; } };
  const fixture = { sessions: [], uploads: [], pending: [] };
  const stop = observeFixtures(page, fixture);
  const response = (id, request) => ({ url: () => 'https://app.hypertask.ai/api/ai-chat/create-session', ok: () => true,
    json: async () => ({ session: { id } }), request: () => ({ postData: () => JSON.stringify(request) }) });
  listeners.response(response('own-chat', {}));
  listeners.response(response('existing-agent-chat', { agentId: 'agent' }));
  await Promise.all(fixture.pending);
  assert.deepEqual(fixture.sessions, ['own-chat']);
  stop();
  assert.equal(listeners.response, undefined);
});

test('observer rejection remains available for cleanup without an unhandled rejection', async () => {
  const [, { observeFixtures }] = await modules;
  let listener;
  const page = { on: (_name, fn) => { listener = fn; }, off: () => {} };
  const fixture = { sessions: [], uploads: [], pending: [] };
  observeFixtures(page, fixture);
  listener({ url: () => 'https://app.hypertask.ai/api/tasks/uploadUrl', ok: () => true,
    json: async () => { throw new Error('response lost'); } });
  await new Promise((resolve) => setImmediate(resolve));
  const outcomes = await Promise.allSettled(fixture.pending);
  assert.equal(outcomes[0].status, 'rejected');
});

test('upload blocks the unremovable buffered fallback before selecting a file', async (t) => {
  const [, { uploadFixture }] = await modules;
  const calls = [];
  const fixture = { title: 'QA test upload', values: { fileName: `qa-test-${process.pid}.txt` } };
  t.after(() => { if (fixture.filePath) fs.unlinkSync(fixture.filePath); });
  const page = {
    createCDPSession: async () => ({ send: async (method, args) => { calls.push({ method, args }); } }),
    waitForSelector: async () => {},
    $: async () => ({ uploadFile: async (filePath) => { calls.push({ filePath }); } }),
  };
  await uploadFixture(page, fixture, '#file-input');
  assert.deepEqual(calls.slice(0, 2), [{ method: 'Network.enable', args: undefined },
    { method: 'Network.setBlockedURLs', args: { urls: ['https://app.hypertask.ai/api/tasks/n8nUpload*'] } }]);
  assert.equal(calls[2].filePath, fixture.filePath);
});

test('CLI reporter repairs a partial screenshot failure on the same ticket, then leaves an attached screenshot alone', (t) => {
  const failure = failureFixture(t);
  const dir = path.dirname(failure.screenshotPath);
  const callsPath = path.join(dir, 'calls.jsonl');
  const boardPath = path.join(dir, 'board.json');
  const resultsPath = path.join(dir, 'results.json');
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ startedAt: new Date().toISOString(), results: [failure] }));
  const ticket = { id: 123, title: `Midscene nightly: ${failure.flow} failing`, status: 'Normal', section: 'Bugs', attachments: [] };
  fs.writeFileSync(boardPath, JSON.stringify(ticket));
  const fakeCli = path.join(dir, 'vcc');
  fs.writeFileSync(fakeCli, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
const task = JSON.parse(fs.readFileSync(process.env.TEST_BOARD));
if (args[0] === 'tasks' && ['list', 'get'].includes(args[1])) console.log(JSON.stringify({ success: true, tasks: [task] }));
else if (args[0] === 'comment' && args[1] === 'add') console.log(JSON.stringify({ success: true }));
else process.exit(99);
`, { mode: 0o755 });
  const run = () => spawnSync(process.execPath, ['e2e/midscene/postprocess.mjs', statePath, resultsPath, '1', '15', 'Bugs', '0', String(Date.now() / 1000)], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, TEST_CALLS: callsPath, TEST_BOARD: boardPath },
  });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const calls = fs.readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [['tasks', 'list'], ['tasks', 'get'], ['comment', 'add']]);
  assert.equal(calls[2][2], '123');
  assert.equal(calls[2][calls[2].indexOf('--attach') + 1], failure.screenshotPath);
  assert.match(calls[2][calls[2].indexOf('--text') + 1], /Failing step:/);
  ticket.attachments = [{ fileName: `${failure.flow}-previous.png` }];
  fs.writeFileSync(boardPath, JSON.stringify(ticket));
  fs.writeFileSync(callsPath, '');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const repeated = fs.readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(repeated.map((args) => args.slice(0, 2)), [['tasks', 'list'], ['tasks', 'get']]);
});
