const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const analyst = import('../scripts/speed/measure.mjs');

async function fixture() {
  const { PATHS, summarize } = await analyst;
  const samples = ['desktop', 'phone'].flatMap(profile => PATHS.map(surface => ({
    profile, path: surface, contentMs: 100, requestCount: 2, bytes: 1024, longTaskMs: 50,
    requests: [1, 2].map(() => ({ method: 'GET', path: '/api/flags', status: 200, failed: false, blocked: false, bytes: 512 })),
    longTasks: [{ startMs: 1, durationMs: 50 }],
  })));
  return {
    schema: 1, started: '2026-10-10T12:00:00Z', status: 'complete', accountId: 2343,
    base: 'https://app.hypertask.ai', productionCommit: 'a'.repeat(40), productionCommitEnd: 'a'.repeat(40),
    conditions: { samples: 1, browser: 'Chromium-test', protocol: 1 },
    samples, groups: summarize(samples),
  };
}

test('statistics retain all samples, even slow ones, with arithmetic median and nearest-rank p90', async () => {
  const { stats } = await analyst;
  assert.deepEqual(stats([500, 10, 30, 20, 40]), { median: 30, p90: 500, min: 10, max: 500 });
  assert.equal(stats([4, 2]).median, 3);
  for (const invalid of [[], [NaN], [-1], [Infinity]]) assert.throws(() => stats(invalid));
});

test('summary keeps all seven surfaces and both profile cohorts separate', async () => {
  const { summarize } = await analyst;
  const run = await fixture();
  assert.equal(Object.keys(run.groups).length, 14);
  const extra = { ...run.samples[0], contentMs: 1000 };
  const groups = summarize([...run.samples, extra]);
  assert.equal(groups['desktop:board'].contentMs.median, 550);
  assert.equal(groups['phone:board'].contentMs.median, 100);
});

test('seven-day comparison excludes current/future, old, failed and incompatible runs', async () => {
  const { compare } = await analyst;
  const current = await fixture();
  const prior = { ...await fixture(), started: '2026-10-09T12:00:00Z' };
  const excluded = [
    { ...prior, started: '2026-10-02T12:00:00Z' },
    { ...prior, status: 'failed' },
    { ...prior, conditions: { ...prior.conditions, browser: 'different' } },
    current,
    { ...prior, started: '2026-10-10T01:00:00Z' },
    { ...prior, started: '2026-10-11T12:00:00Z' },
  ];
  assert.ok(compare(current, excluded).every(row => row.baseline === null));
  assert.ok(compare(current, [...excluded, prior]).every(row => row.baseline === 100 || row.metric !== 'contentMs'));
  assert.ok(compare(current, [prior]).every(row => row.days === 1 && !row.regression));
});

test('median uses one latest run per UTC day; repeat investigations cannot dominate history', async () => {
  const { compare } = await analyst;
  const current = await fixture();
  const prior = await fixture();
  const cheap = structuredClone(prior);
  cheap.groups['desktop:board'].contentMs.median = 1;
  const history = [
    { ...cheap, started: '2026-10-09T01:00:00Z' },
    { ...cheap, started: '2026-10-09T02:00:00Z' },
    { ...prior, started: '2026-10-09T03:00:00Z' },
    { ...prior, started: '2026-10-08T03:00:00Z' },
  ];
  const row = compare(current, history).find(row => row.cohort === 'desktop:board' && row.metric === 'contentMs');
  assert.equal(row.baseline, 100);
  assert.equal(row.days, 2);
});

test('over 15 percent flags regression, exactly 15 does not; zero baseline is explicit', async () => {
  const { compare } = await analyst;
  const current = await fixture();
  const prior = { ...await fixture(), started: '2026-10-09T12:00:00Z' };
  current.groups['desktop:board'].contentMs.median = 115;
  let row = compare(current, [prior]).find(row => row.cohort === 'desktop:board' && row.metric === 'contentMs');
  assert.equal(row.regression, false);
  current.groups['desktop:board'].contentMs.median = 116;
  row = compare(current, [prior]).find(row => row.cohort === 'desktop:board' && row.metric === 'contentMs');
  assert.equal(row.regression, true);
  prior.groups['desktop:board'].contentMs.median = 0;
  row = compare(current, [prior]).find(row => row.cohort === 'desktop:board' && row.metric === 'contentMs');
  assert.equal(row.percent, null);
  assert.equal(row.regression, true);
});

test('history persists complete and failed raw samples atomically with private permissions', async () => {
  const { appendHistory } = await analyst;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-analyst-'));
  const file = path.join(directory, 'state/history.json');
  try {
    const run = await fixture();
    appendHistory(file, run);
    appendHistory(file, { ...run, status: 'failed' });
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(stored[0], run);
    assert.equal(stored[1].status, 'failed');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['history.json']);
    fs.writeFileSync(file, '{}');
    assert.throws(() => appendHistory(file, run));
    assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live oracle accepts a complete control, rejects missing paths, errors, wrong account and deploy skew', async () => {
  const { verifyRun } = await analyst;
  const run = await fixture();
  assert.doesNotThrow(() => verifyRun(run));
  for (const mutate of [
    value => { value.samples.pop(); },
    value => { value.accountId = 6; },
    value => { value.productionCommitEnd = 'b'.repeat(40); },
    value => { value.status = 'failed'; },
    value => { value.samples[0].requests[0].status = 500; },
    value => { value.samples[0].requests[0].failed = true; },
    value => { value.samples[0].bytes = -1; },
    value => { value.samples[0].bytes = 1; },
    value => { value.samples[0].requestCount = 1; },
    value => { value.samples[0].longTaskMs = 1; },
    value => { value.groups['desktop:board'].contentMs.median = 1; },
  ]) {
    const bad = structuredClone(run);
    mutate(bad);
    assert.throws(() => verifyRun(bad));
  }
  const blocked = structuredClone(run);
  blocked.samples[0].requests.push({ status: null, failed: true, blocked: true, bytes: 0 });
  assert.doesNotThrow(() => verifyRun(blocked));
});

test('CDP guard handles pause-before-request race, separates blocked writes and captures only safe metrics', async () => {
  const { collectNetwork, requestFailed } = await analyst;
  const cdp = new EventEmitter();
  const commands = [];
  cdp.send = async (command, params) => { commands.push({ command, params }); };
  const permitted = method => method === 'GET';
  const blocked = [];
  const net = collectNetwork(cdp, permitted, url => new URL(url).pathname, blocked);
  cdp.emit('Fetch.requestPaused', { requestId: 'pause', networkId: 'write', request: { method: 'POST', url: 'https://app.hypertask.ai/api/tasks/update?token=secret' } });
  cdp.emit('Network.requestWillBeSent', { requestId: 'write', request: { method: 'POST', url: 'https://app.hypertask.ai/api/tasks/update?token=secret' }, wallTime: 10, timestamp: 1, type: 'Fetch' });
  cdp.emit('Network.loadingFailed', { requestId: 'write', timestamp: 1.1 });
  assert.equal(net.requests.get('write').blocked, true);
  assert.equal(commands[0].command, 'Fetch.failRequest');
  cdp.emit('Network.requestWillBeSent', { requestId: 'read', request: { method: 'GET', url: 'https://app.hypertask.ai/api/flags?cookie=secret' }, wallTime: 11, timestamp: 2, type: 'Fetch' });
  cdp.emit('Fetch.requestPaused', { requestId: 'read-pause', networkId: 'read', request: { method: 'GET', url: 'https://app.hypertask.ai/api/flags' } });
  cdp.emit('Network.responseReceived', { requestId: 'read', timestamp: 2.1, response: { status: 200, headers: { 'server-timing': 'total;dur=42;desc="private", db;dur=10', 'set-cookie': 'secret' } } });
  cdp.emit('Network.loadingFinished', { requestId: 'read', timestamp: 2.2, encodedDataLength: 1234 });
  const row = net.requests.get('read');
  assert.equal(row.bytes, 1234);
  assert.ok(Math.abs(row.ttfbMs - 100) < 0.001);
  assert.deepEqual(row.serverTiming, [{ name: 'total', durationMs: 42 }, { name: 'db', durationMs: 10 }]);
  assert.equal(row.failed, false);
  assert.equal(row.blocked, false);
  cdp.emit('Network.responseReceived', { requestId: 'read', timestamp: 2.1, response: { status: 200, headers: { 'Server-Timing': 'db;desc="private, phrase";dur="10.5", cache;desc="secret"' } } });
  assert.deepEqual(row.serverTiming, [{ name: 'db', durationMs: 10.5 }, { name: 'cache', durationMs: null }]);
  cdp.emit('Network.dataReceived', { requestId: 'read', encodedDataLength: 7 });
  assert.equal(row.bytes, 1241);
  cdp.emit('Network.loadingFailed', { requestId: 'read', timestamp: 2.3, canceled: true });
  assert.equal(row.failed, true);
  assert.equal(requestFailed(row), false);
  assert.equal(requestFailed({ ...row, status: 500 }), true);
  assert.equal(requestFailed({ ...row, canceled: false }), true);
  assert.equal(commands[1].command, 'Fetch.continueRequest');
  assert.equal(JSON.stringify([...net.requests.values(), blocked]).includes('secret'), false);
  assert.equal(JSON.stringify([...net.requests.values()]).includes('private'), false);
  net.stop();
  assert.equal(cdp.listenerCount('Fetch.requestPaused'), 0);
  assert.equal(cdp.listenerCount('Network.loadingFinished'), 0);
});

test('only a host network change, not an app failure, counts as a network blip', async () => {
  const { hostNetworkChanged } = await analyst;
  const blip = { failed: true, canceled: false, blocked: false, status: null, errorCode: 'net::ERR_NETWORK_CHANGED' };
  const failedOn20261019 = [
    { path: '/api/auth/bridge-session', failed: true, canceled: false, blocked: true, status: null, errorCode: null },
    { path: '/api/users/preferences', ...blip },
    { path: '/api/my-tasks', ...blip },
    { path: '/api/flags', failed: false, blocked: false, status: 200 },
  ];
  assert.equal(hostNetworkChanged(failedOn20261019), true);
  assert.equal(hostNetworkChanged([...failedOn20261019, { path: '/api/my-tasks', failed: false, blocked: false, status: 500 }]), false);
  assert.equal(hostNetworkChanged([{ ...blip, errorCode: 'net::ERR_CONNECTION_RESET' }]), false);
  assert.equal(hostNetworkChanged([{ ...blip, canceled: true }]), false);
  assert.equal(hostNetworkChanged([]), false);
});

test('a host network change remeasures that phase once from scratch; a second change or an app failure still fails', async () => {
  const { measurePhases, HostNetworkChanged } = await analyst;
  const log = console.log;
  console.log = () => {};
  try {
    const run = { samples: [] };
    const calls = [];
    await measurePhases(async phase => {
      calls.push(phase);
      if (phase === 'board') return run.samples.push({ path: 'board' });
      run.samples.push({ path: 'ticket-cold' }, { path: 'my-tasks', blip: calls.length === 2 });
      if (calls.length === 2) { run.failure = { surface: 'my-tasks' }; throw new HostNetworkChanged(); }
    }, run, 'phone', 1);
    assert.deepEqual(calls, ['board', 'other', 'other']);
    assert.deepEqual(run.samples.map(sample => sample.path), ['board', 'ticket-cold', 'my-tasks']);
    assert.equal(run.samples.some(sample => sample.blip), false);
    assert.equal(run.failure, undefined);
    assert.deepEqual(run.networkRetries, [{ profile: 'phone', phase: 'other', index: 1 }]);

    let attempts = 0;
    await assert.rejects(measurePhases(async () => { attempts++; throw new HostNetworkChanged(); }, { samples: [] }, 'desktop', 2), /Host network changed/);
    assert.equal(attempts, 2);

    attempts = 0;
    await assert.rejects(measurePhases(async () => { attempts++; throw new Error('Path unavailable'); }, { samples: [] }, 'desktop', 3), /Path unavailable/);
    assert.equal(attempts, 1);
  } finally { console.log = log; }
});

test('readiness accepts actual search rows and SSR-seeded My Tasks, not empty shells or a different ticket', async () => {
  const { ready } = await analyst;
  const { JSDOM } = await import('jsdom');
  const check = async (surface, html) => {
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    let clock = 0;
    dom.window.performance.now = () => ++clock * 1000;
    dom.window.requestAnimationFrame = callback => queueMicrotask(callback);
    dom.window.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, bottom: 20 });
    const page = { evaluate: (fn, args) => dom.window.eval(`(${fn.toString()})(${JSON.stringify(args)})`) };
    try { return await ready(page, surface); } finally { dom.window.close(); }
  };
  assert.ok(await check('search', '<ul id="tasks-list"><li>QASA-43 <span>QA 6667 Enter verification</span></li></ul>') > 0);
  await assert.rejects(check('search', '<ul id="tasks-list"><li>QASA-50 <span>QA 6667 Enter verification</span></li></ul>'));
  await assert.rejects(check('search', '<ul id="tasks-list"><li>Ask AI</li></ul>'));
  assert.ok(await check('my-tasks', '<p data-testid="my-tasks-title">My Tasks</p><div data-testid="my-tasks-list"><div class="table-view-header">Title</div></div>') > 0);
  await assert.rejects(check('my-tasks', '<p data-testid="my-tasks-title">My Tasks</p><div data-testid="my-tasks-list"></div>'));
});

test('early-failure summary prints the saved reason without requiring browser conditions', async () => {
  const { printSummary } = await analyst;
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(line);
  try {
    assert.doesNotThrow(() => printSummary({ started: '2026-10-10T12:00:00Z', status: 'failed', failure: { reason: 'Tool, auth or selector unavailable' } }, []));
  } finally { console.log = original; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /failed: Tool, auth or selector unavailable/);
  assert.match(lines[0], /not verified speed evidence/);
});

test('end-of-run native fetch checks its boolean status, unlike Playwright APIResponse', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/speed/measure.mjs'), 'utf8');
  assert.match(source, /const response = await fetch\(/);
  assert.match(source, /if \(!response\.ok \|\| run\.productionCommitEnd !== run\.productionCommit\)/);
  assert.doesNotMatch(source, /response\.ok\(\)/);
});

test('invalid CLI errors never echo unknown credential-like arguments', () => {
  const result = spawnSync(process.execPath, ['scripts/speed/measure.mjs', '--unknown-secret-token'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes('unknown-secret-token'), false);
});

test('timer is daily user-managed and skill registration points at the complete speed-only map', () => {
  const root = path.join(__dirname, '..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const timer = read('scripts/speed/systemd/speed-measure.timer');
  assert.match(timer, /OnCalendar=\*-\*-\* 04:30:00 UTC/);
  assert.match(timer, /Persistent=true/);
  assert.match(read('scripts/speed/systemd/speed-measure.service'), /UMask=0077/);
  const skill = read('.claude/skills/speed-analyst/SKILL.md');
  assert.match(skill, /SPEED RUNNER takes speed work only/);
  assert.match(skill, /after every investigation and every weekly research round/);
  assert.match(read('.claude/skills/INDEX.md'), /speed-analyst.*takes speed work only/);
  assert.match(read('.claude/skills/speed-analyst/PLAYBOOK.md'), /514,627/);
  assert.match(read('scripts/speed/README.md'), /owning session only, after merge/);
});

test('phone profile is a real phone: mobile user agent and device scale factor 3 on top of the shared 390 viewport', async () => {
  const { PHONE_PROFILE, withPhoneProfile } = await analyst;
  assert.equal(PHONE_PROFILE.deviceScaleFactor, 3);
  assert.match(PHONE_PROFILE.userAgent, /iPhone.*Mobile/);
  let received;
  const context = await withPhoneProfile({ newContext: async options => { received = options; return {}; } }).newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  assert.deepEqual(context, {});
  assert.deepEqual(received, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...PHONE_PROFILE });
  const source = fs.readFileSync(path.join(__dirname, '../scripts/speed/measure.mjs'), 'utf8');
  assert.match(source, /shared\.setup\(mobile \? withPhoneProfile\(browser\) : browser, mobile\)/);
  assert.match(source, /Phone layout is \$\{row\.innerWidth\} wide, expected 390/);
  // Old-profile history must not count as the same conditions in seven-day comparisons.
  const { PHONE_PROFILE_KEY } = await analyst;
  assert.notEqual(PHONE_PROFILE_KEY, 'phone-4g-4x-390x844');
  assert.match(source, /profiles: \['desktop-unthrottled-1440x900', PHONE_PROFILE_KEY\]/);
});

test('opened-before waits until the cold ticket code finishes downloading, and gives up at the cap', async () => {
  const { settleScripts, pendingScripts } = await analyst;
  const chunk = { type: 'Script', blocked: false };
  const requests = new Map([['a', { ...chunk }], ['b', { ...chunk }], ['flags', { type: 'Fetch', blocked: false }], ['blocked', { ...chunk, blocked: true }]]);
  assert.equal(pendingScripts(requests.values()), 2);
  let clock = 0;
  const result = await settleScripts(requests, async ms => {
    clock += ms;
    if (clock === 1000) requests.get('a').durationMs = 900;
    if (clock === 2000) requests.get('b').durationMs = 1900;
  }, { quietMs: 500, capMs: 10000, pollMs: 250 });
  assert.deepEqual(result, { settleMs: 2250, pendingScripts: 0 });

  const stuck = new Map([['c', { ...chunk }]]);
  assert.deepEqual(await settleScripts(stuck, async () => {}, { quietMs: 500, capMs: 1000, pollMs: 250 }), { settleMs: 1000, pendingScripts: 1 });

  const source = fs.readFileSync(path.join(__dirname, '../scripts/speed/measure.mjs'), 'utf8');
  assert.match(source, /sample\('ticket-cold'[^\n]*\n[^\n]*\n\s*Object\.assign\(run\.samples\.at\(-1\), await settleScripts\(/);
});

test('a failed path records the step and a safe one-line error, never full URLs or other query values', async () => {
  const { failureDetail, safeSearch, printSummary } = await analyst;
  assert.equal(failureDetail(new Error('locator.scrollIntoViewIfNeeded: Timeout 60000ms exceeded.\nCall log:\n  - waiting for locator')), 'locator.scrollIntoViewIfNeeded: Timeout 60000ms exceeded.');
  assert.equal(failureDetail(new Error('page.goto: net::ERR_ABORTED at https://app.hypertask.ai/project?id=6859&token=x')), 'page.goto: net::ERR_ABORTED at <url>');
  assert.equal(failureDetail(undefined), 'unknown');
  assert.deepEqual(safeSearch('https://app.hypertask.ai/project?id=6859&view=default&code=secret'), { id: '6859', view: 'default' });
  assert.deepEqual(safeSearch('https://app.hypertask.ai/project'), {});

  const lines = [];
  const original = console.log;
  console.log = line => lines.push(line);
  try {
    printSummary({ started: '2026-10-20T04:30:00Z', status: 'failed', failure: { reason: 'Path unavailable', profile: 'phone', surface: 'page-navigation', index: 4, error: 'Timeout 60000ms exceeded.' } }, []);
  } finally { console.log = original; }
  assert.match(lines[0], /Path unavailable at phone:page-navigation 4 \(Timeout 60000ms exceeded\.\)/);
});
