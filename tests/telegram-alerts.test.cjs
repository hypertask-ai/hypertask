const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

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
      body = { tasks: existing ? [{ id: 42, title: '[INFRA] Production monitoring: smoke-unrunnable' }] : [] };
    } else if (url.endsWith('/api/mcp/tasks/create')) {
      body = { task: { id: 42 } };
      existing = true;
    } else if (url.endsWith('/api/mcp/comments')) body = { success: true };
    else if (url.startsWith('https://api.telegram.org/')) body = { ok: !telegramFailure };
    else assert.fail(`Unexpected request ${url}`);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetch };
}

test('unrunnable smoke creates one infra ticket, never Telegram, and updates it next day', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  assert.equal(await reportProductionAlert(config(), h.fetch), 'ticket');
  assert.equal(await reportProductionAlert(config(), h.fetch), 'duplicate');
  assert.equal(await reportProductionAlert({ ...config(), now: new Date('2026-10-10') }, h.fetch), 'ticket');
  const creations = h.calls.filter((c) => c.url.endsWith('/tasks/create'));
  assert.equal(creations.length, 1);
  assert.equal(JSON.parse(creations[0].options.body).project_id, 4060);
  assert.equal(h.calls.filter((c) => c.url.endsWith('/comments')).length, 1);
  assert.equal(h.calls.filter((c) => c.url.includes('api.telegram.org')).length, 0);
});

for (const kind of ['live', 'rollback']) {
  test(`${kind} alerts once per UTC day across deploy SHAs and reruns`, async () => {
    const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
    const h = harness();
    assert.equal(await reportProductionAlert(config(kind), h.fetch), 'telegram');
    assert.equal(await reportProductionAlert({ ...config(kind), message: 'different deploy SHA' }, h.fetch), 'duplicate');
    assert.equal(await reportProductionAlert({ ...config(kind), now: new Date('2026-10-10') }, h.fetch), 'telegram');
    assert.equal(h.calls.filter((c) => c.url.includes('api.telegram.org')).length, 2);
  });
}

test('failed dedup storage cannot permit duplicate Telegram delivery', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  for (const options of [{ reserveFailure: true }, { lookupFailure: true }]) {
    const h = harness(options);
    await assert.rejects(reportProductionAlert(config('live'), h.fetch), /Daily alert/);
    assert.equal(h.calls.filter((c) => c.url.includes('api.telegram.org')).length, 0);
  }
  const h = harness({ telegramFailure: true });
  await assert.rejects(reportProductionAlert(config('live'), h.fetch), /Telegram delivery failed/);
  assert.equal(await reportProductionAlert(config('live'), h.fetch), 'duplicate');
});

test('setup without agent credentials remains summary-only', async () => {
  const { reportProductionAlert } = await import('../.github/scripts/production-alert.mjs');
  const h = harness();
  assert.equal(await reportProductionAlert({ ...config(), mcpToken: '' }, h.fetch), 'summary-only');
  assert.equal(h.calls.filter((c) => c.url.includes('api.telegram.org')).length, 0);
});

test('CI failure naming recognizes actual spec output and TAP, including a startup failure', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ci-tests.yml', 'utf8'));
  const script = workflow.jobs['ci-tests'].steps.find((s) => s.id === 'test-outcome').run.replaceAll("${{ steps.push-test.outcome == 'failure' }}", 'true');
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
  // Positive control: the same assertion rejects the former raw alert.
  assert.throws(() => assert.doesNotMatch('api.telegram.org', /TELEGRAM|api\.telegram\.org/));
});
