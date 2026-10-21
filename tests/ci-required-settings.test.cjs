const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const workflow = yaml.load(readFileSync(path.join(__dirname, '../.github/workflows/ci-tests.yml'), 'utf8'));
const run = workflow.jobs['ci-tests'].steps.find(step => step.name === 'Verify live required-check settings').run;
const contexts = yaml.load(readFileSync(path.join(__dirname, '../docs/ci-policy.yml'), 'utf8')).required_checks.contexts;

function verify(t, mode, { endpoint = 'repos/hypertask-ai/hypertask', missingContext = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'required-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = path.join(directory, 'calls');
  const sleeps = path.join(directory, 'sleeps');
  writeFileSync(calls, '');
  const ruleset = {
    target: 'branch', conditions: { ref_name: { include: ['refs/heads/production'], exclude: [] } },
    rules: [{ type: 'required_status_checks', parameters: { required_status_checks: (missingContext ? contexts.slice(1) : contexts).map(context => ({ context })) } }],
  };
  const stubs = `
    gh() {
      [ "$1" = api ] || return 99
      printf '%s\\n' "$2" >> "$CALL_LOG"
      if [ "$2" = "$FAIL_ENDPOINT" ]; then
        if [ "$MODE" = rate-always ] || { [ "$MODE" = rate-once ] && [ ! -f "$RUNNER_TEMP/retried" ]; }; then
          touch "$RUNNER_TEMP/retried"
          echo 'gh: API rate limit exceeded for installation (HTTP 403)' >&2
          return 1
        fi
        if [ "$MODE" = forbidden ]; then
          echo 'gh: Resource not accessible by integration (HTTP 403)' >&2
          return 1
        fi
      fi
      case "$2" in
        "repos/$REPO") printf 'production\\n' ;;
        "repos/$REPO/rulesets?per_page=100") printf '123\\n' ;;
        "repos/$REPO/rulesets/123") printf '%s\\n' "$RULESET_JSON" ;;
        *) return 99 ;;
      esac
    }
    sleep() { printf '%s\\n' "$1" >> "$SLEEP_LOG"; }
  `;
  const result = spawnSync('bash', ['-c', stubs + run], {
    encoding: 'utf8', timeout: 10_000,
    env: { PATH: process.env.PATH, RUNNER_TEMP: directory, REPO: 'hypertask-ai/hypertask', MODE: mode, FAIL_ENDPOINT: endpoint, CALL_LOG: calls, SLEEP_LOG: sleeps, RULESET_JSON: JSON.stringify(ruleset) },
  });
  return {
    ...result,
    calls: readFileSync(calls, 'utf8').trim().split('\n'),
    sleeps: existsSync(sleeps) ? readFileSync(sleeps, 'utf8').trim().split('\n') : [],
  };
}

for (const endpoint of ['repos/hypertask-ai/hypertask', 'repos/hypertask-ai/hypertask/rulesets?per_page=100', 'repos/hypertask-ai/hypertask/rulesets/123']) {
  test(`required settings recovers from installation rate limit reading ${endpoint}`, t => {
    const result = verify(t, 'rate-once', { endpoint });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.filter(call => call === endpoint).length, 2);
    assert.deepEqual(result.sleeps, ['60']);
    assert.match(result.stderr, /rate-limited; retrying/);
  });
}

test('required settings fails closed after bounded rate-limit retries', t => {
  const result = verify(t, 'rate-always');
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 6);
  assert.deepEqual(result.sleeps, Array(5).fill('60'));
});

test('required settings refuses permission failures without retrying or skipping verification', t => {
  const result = verify(t, 'forbidden');
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.sleeps, []);
});

test('required settings still accepts the exact live configuration', t => {
  const result = verify(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 3);
  assert.deepEqual(result.sleeps, []);
});

test('required settings still refuses a missing required context after recovering from a rate limit', t => {
  const result = verify(t, 'rate-once', { missingContext: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Live required checks do not match/);
  assert.deepEqual(result.sleeps, ['60']);
});
