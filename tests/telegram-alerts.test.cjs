const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { loadModule } = require('./helpers/loadModule.cjs');

const config = (kind = 'setup') => ({
  kind, cause: 'smoke-unrunnable', message: 'QA session expired',
  repository: 'test/repo', githubToken: 'github-fixture', mcpToken: 'agent-fixture',
  telegramToken: 'telegram-fixture', telegramChat: 'fixture',
  now: new Date('2026-10-09T10:00:00Z'), runUrl: 'https://github.com/test/repo/actions/runs/42',
});
function harness({ existing = false, reserveFailure = false, lookupFailure = false, telegramFailure = false } = {}) {
  const calls = [], variables = new Map();
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    let status = 200, body = {};
    if (url.includes('/actions/variables')) {
      const name = url.split('/').at(-1);
      if (!options.method) {
        status = lookupFailure ? 503 : variables.has(name) ? 200 : 404;
        body = { value: variables.get(name) };
      } else if (reserveFailure) status = 503;
      else { const data = JSON.parse(options.body); variables.set(data.name, data.value); }
    } else if (url.includes('/api/mcp/tasks?')) {
      body = { tasks: existing ? [{ id: 42, title: existing }] : [] };
    } else if (url.endsWith('/api/mcp/tasks/create')) {
      body = { task: { id: 42 } };
      existing = JSON.parse(options.body).title;
    } else if (url.endsWith('/api/mcp/projects/11514/labels')) body = { labels: [{ id: 'ci', name: 'CI' }, { id: 'hyci', name: 'Hypertask CI' }] };
    else if (url.includes('/agent-activity?')) body = { activities: [] };
    else if (url.endsWith('/api/mcp/agents/runs')) body = { run: { id: 'run-42' } };
    else if (url.endsWith('/activities')) body = { success: true };
    else if (url.endsWith('/api/mcp/comments')) body = { success: true };
    else if (url.startsWith('https://api.telegram.org/')) body = { ok: !telegramFailure };
    else assert.fail(`Unexpected request ${url}`);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetch, variables };
}

test('unrunnable smoke creates one infra ticket, never Telegram, and updates it next day', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  assert.equal(await reportProductionAlert(config(), h.fetch), 'ticket');
  assert.equal(await reportProductionAlert(config(), h.fetch), 'duplicate');
  assert.equal(await reportProductionAlert({ ...config(), now: new Date('2026-10-10') }, h.fetch), 'ticket');
  const creations = h.calls.filter((c) => c.url.endsWith('/tasks/create'));
  assert.equal(creations.length, 1);
  const payload = JSON.parse(creations[0].options.body);
  assert.equal(payload.project_id, 11514);
  assert.deepEqual(payload.labels, ['ci', 'hyci']);
  assert.equal(payload.title, 'Production monitoring: smoke unrunnable');
  const { assertAgentWriting } = loadModule('src/lib/agents/writing.ts');
  assert.doesNotThrow(() => assertAgentWriting('agent', { title: payload.title, description: payload.description }));
  assert.throws(() => assertAgentWriting('agent', { description: 'Smoke failed for commit a12bc3456789.' }), /build or commit id/);
  assert.equal(payload.description, '<h2>Problem</h2><p>A production check could not finish.</p><h2>Fix</h2><p>Read the agent log for details.</p><h2>Done when</h2><p>The check finishes with a clear result.</p><h2>Risk</h2><p>A release warning could be missed.</p><h2>Decision</h2><p>None.</p>');
  const activities = h.calls.filter((c) => c.url.endsWith('/activities'));
  assert.equal(activities.length, 2);
  assert.match(JSON.parse(activities[0].options.body).text, /QA session expired\nhttps:\/\/github.com\/test\/repo\/actions\/runs\/42/);
  assert.equal(h.calls.filter((c) => new URL(c.url).origin === 'https://api.telegram.org').length, 0);
});

test('legacy setup reservations do not suppress delivery', async () => {
  const { createHash } = require('node:crypto');
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
  const legacy = `PROD_ALERT_${hash('setup:smoke-unrunnable').toUpperCase()}`;
  const monitor = `PROD_MONITOR_${hash('setup:smoke-unrunnable').toUpperCase()}`;
  h.variables.set(legacy, '2026-10-09');
  assert.equal(await reportProductionAlert(config(), h.fetch), 'ticket');
  assert.equal(h.variables.get(monitor), '2026-10-09');
  assert.equal(await reportProductionAlert(config(), h.fetch), 'duplicate');
  const creation = h.calls.find((c) => c.url.endsWith('/tasks/create'));
  assert.equal(creation.options.headers['Idempotency-Key'], `prod-monitor-${hash('smoke-unrunnable')}-2026-10-09-task`);
  for (const kind of ['live', 'rollback']) {
    assert.equal(await reportProductionAlert(config(kind), h.fetch), 'telegram');
    assert.equal(h.variables.get(`PROD_ALERT_${hash(`${kind}:smoke-unrunnable`).toUpperCase()}`), '2026-10-09');
  }
});

for (const kind of ['live', 'rollback']) {
  test(`${kind} alerts once per UTC day across deploy SHAs and reruns`, async () => {
    const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
    const h = harness();
    assert.equal(await reportProductionAlert(config(kind), h.fetch), 'telegram');
    assert.equal(await reportProductionAlert({ ...config(kind), message: 'different deploy SHA' }, h.fetch), 'duplicate');
    assert.equal(await reportProductionAlert({ ...config(kind), now: new Date('2026-10-10') }, h.fetch), 'telegram');
    assert.equal(h.calls.filter((c) => new URL(c.url).origin === 'https://api.telegram.org').length, 2);
  });
}

test('Telegram detection uses exact origin, with hostile URL positive controls', () => {
  for (const url of ['https://evil.example/api.telegram.org', 'https://api.telegram.org.evil.example/']) {
    assert.notEqual(new URL(url).origin, 'https://api.telegram.org');
  }
  assert.equal(new URL('https://api.telegram.org/botfixture/sendMessage').origin, 'https://api.telegram.org');
});

test('an archived cause is updated instead of creating another infrastructure ticket', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  await reportProductionAlert(config(), h.fetch);
  h.calls.length = 0;
  const fetch = (url, options) => url.includes('status=Normal')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ tasks: [] }) })
    : h.fetch(url, options);
  await reportProductionAlert({ ...config(), now: new Date('2026-10-10') }, fetch);
  assert.equal(h.calls.filter((c) => c.url.endsWith('/tasks/create')).length, 0);
  assert.equal(h.calls.filter((c) => c.url.endsWith('/activities')).length, 1);
  assert.equal(h.calls.filter((c) => new URL(c.url).origin === 'https://api.telegram.org').length, 0);
});

test('failed dedup storage cannot permit duplicate Telegram delivery', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  for (const options of [{ reserveFailure: true }, { lookupFailure: true }]) {
    const h = harness(options);
    await assert.rejects(reportProductionAlert(config('live'), h.fetch), /Daily alert/);
    assert.equal(h.calls.filter((c) => new URL(c.url).origin === 'https://api.telegram.org').length, 0);
  }
  const h = harness({ telegramFailure: true });
  await assert.rejects(reportProductionAlert(config('live'), h.fetch), /Telegram delivery failed/);
  assert.equal(await reportProductionAlert(config('live'), h.fetch), 'duplicate');
});

test('setup without agent credentials remains summary-only', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  assert.equal(await reportProductionAlert({ ...config(), mcpToken: '' }, h.fetch), 'summary-only');
  assert.equal(h.calls.filter((c) => new URL(c.url).origin === 'https://api.telegram.org').length, 0);
});

test('a failed alert says why in the log and the job summary, without the credential', async () => {
  const { alertFailureReason } = await import('../.github/scripts/production-alert.mjs');
  assert.equal(alertFailureReason(new Error('Daily alert lookup failed (HTTP 403)')), 'Daily alert lookup failed (HTTP 403)');
  assert.equal(
    alertFailureReason(new Error('request to https://api.telegram.org/bot123456:AAHfake-token-value-here/sendMessage failed')),
    'request to <url> failed',
  );
  assert.equal(alertFailureReason(new Error('token 123456:AAHfake-token-value-here rejected')), 'token <token> rejected');
  assert.equal(alertFailureReason(new Error(`x${'y'.repeat(400)}`)).length, 200);

  const directory = mkdtempSync(join(tmpdir(), 'alert-reason-'));
  try {
    const summary = join(directory, 'summary');
    writeFileSync(summary, '');
    const result = spawnSync(process.execPath, ['.github/scripts/production-alert.mjs', 'not-a-kind', 'smoke', 'boom'], {
      encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Production alert delivery or ticket recording failed: Invalid production alert classification/);
    assert.match(readFileSync(summary, 'utf8'), /Alert delivery failed: Invalid production alert classification/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CI failure naming recognizes actual spec output and TAP, including a startup failure', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ci-tests.yml', 'utf8'));
  const script = workflow.jobs['ci-tests'].steps.find((s) => s.id === 'test-outcome').run.replaceAll("${{ needs.ci-test.result == 'failure' }}", 'true');
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'failure-names-'));
  try {
    for (const [log, expected] of [
      ['✖ native hooks exclude bridge and refresh, and schedule after legacy cookies (41.596006ms)', 'native hooks exclude bridge and refresh'],
      ['not ok 7 - failing TAP test', 'failing TAP test'],
      ['npm: command not found', 'test command failed before naming a test'],
    ]) {
      writeFileSync(join(directory, 'push-test.log'), log);
      writeFileSync(join(directory, 'outputs'), '');
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: directory, GITHUB_OUTPUT: join(directory, 'outputs') } });
      assert.equal(result.status, 0, result.stderr);
      const outputs = readFileSync(join(directory, 'outputs'), 'utf8');
      assert.ok(outputs.includes(expected), outputs);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const warning = workflow.jobs['production-test-warning'];
  const report = warning.steps.find((s) => s.name === 'Warn about failed production tests');
  assert.match(report.run, /production-alert\.mjs setup production-tests/);
  assert.doesNotMatch(JSON.stringify(warning), /TELEGRAM|api\.telegram\.org/);
  assert.throws(() => assert.doesNotMatch('api.telegram.org', /TELEGRAM|api\.telegram\.org/));
});

test('setup retries failed activity without reserving the day', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  let fail = true;
  const fetch = async (url, options) => {
    if (url.endsWith('/activities') && fail) {
      fail = false;
      return { ok: false, status: 400, json: async () => ({ code: 'invalid_field', message: 'secret cookie=fixture' }) };
    }
    return h.fetch(url, options);
  };
  await assert.rejects(reportProductionAlert(config(), fetch), (error) => {
    assert.match(error.message, /POST \/agents\/runs\/:id\/activities failed \(HTTP 400, invalid_field\)/);
    assert.doesNotMatch(error.message, /secret|cookie|fixture/);
    return true;
  });
  assert.equal(h.calls.filter((c) => c.url.includes('/actions/variables') && c.options.method).length, 0);
  assert.equal(await reportProductionAlert(config(), fetch), 'ticket');
  assert.equal(h.calls.filter((c) => c.url.endsWith('/tasks/create')).length, 1);
});
