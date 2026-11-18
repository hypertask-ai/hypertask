const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { check, problemsFor } = require('../.github/scripts/pr-run-concurrency-guard.cjs');

const WORKFLOWS = '.github/workflows';

const workflow = name => yaml.load(readFileSync(path.join(WORKFLOWS, `${name}.yml`), 'utf8'));

test('every pull request push cancels its superseded run', () => {
  assert.deepEqual(check(WORKFLOWS), []);
});

test('the six gates that used to queue now cancel the same pull request', () => {
  for (const name of ['ci-tests', 'pr-guards-trusted', 'feature-flag-gate', 'ux-signoff-gate', 'codex-review-gate', 'dependabot-lane']) {
    const text = readFileSync(path.join(WORKFLOWS, `${name}.yml`), 'utf8');
    assert.deepEqual(problemsFor(name, text), [], name);
    const concurrency = workflow(name).concurrency;
    assert.equal(concurrency['cancel-in-progress'], true, name);
    assert.equal(concurrency.queue, undefined, name);
    assert.equal(String(concurrency.group).includes('github.event.pull_request.number'), true, name);
  }
  const tests = workflow('ci-tests');
  assert.equal(tests.concurrency.group.includes("github.run_attempt > 1 && format('-{0}', github.run_id)"), true);
  for (const job of ['ci-prepare', 'browser-build']) {
    assert.equal(tests.jobs[job].steps.some((step) => step.run === 'node .github/scripts/stale-rerun.cjs'), true, job);
  }
});

test('a rerun stops only when its commit is no longer the live head', () => {
  const { shouldStop } = require('../.github/scripts/stale-rerun.cjs');
  assert.equal(shouldStop(1, 'pull_request', 'old', 'new'), false);
  assert.equal(shouldStop(2, 'pull_request', 'abc', 'abc'), false);
  assert.equal(shouldStop(2, 'push', 'abc', 'def'), true);
  assert.equal(shouldStop(2, 'schedule', 'abc', 'def'), false);
});

test('the pilot workflow keeps both jobs and cancels per pull request', () => {
  const pilot = workflow('e2e-ai-pilot');
  assert.deepEqual(Object.keys(pilot.jobs), ['static', 'pilot']);
  assert.ok(pilot.concurrency.group.includes('${{ github.event.pull_request.number || github.run_id }}'));
  assert.equal(pilot.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

test('the guard fails on a workflow that lost its concurrency block', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pr-concurrency-'));
  assert.deepEqual(check(directory), []);
  writeFileSync(
    path.join(directory, 'browser-smoke.yml'),
    readFileSync(path.join(WORKFLOWS, 'ci-tests.yml'), 'utf8').replace(/^concurrency:\n(?: {2,}.*\n)+/m, ''),
  );
  assert.deepEqual(check(directory), ['browser-smoke: no concurrency block']);
});

test('the guard ignores workflows that never see a second push', () => {
  const labelled = [
    'on:',
    '  pull_request_target:',
    '    types: [labeled]',
    'concurrency:',
    '  group: ticket-${{ github.event.pull_request.number }}',
    '  cancel-in-progress: false',
    '',
  ].join('\n');
  const pushOnly = ['on:', '  push:', '    branches: [production]', ''].join('\n');
  assert.deepEqual(problemsFor('labelled-only', labelled), []);
  assert.deepEqual(problemsFor('push-only', pushOnly), []);
});

test('the guard reports a shared line and a missing cancel separately', () => {
  const sharedLine = [
    'on:',
    '  pull_request:',
    'concurrency:',
    '  group: everything',
    '  cancel-in-progress: false',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('shared', sharedLine), [
    'shared: concurrency group everything is not per pull request',
    'shared: cancel-in-progress is false',
  ]);
});

test('the guard reads a multiline type list instead of skipping the workflow', () => {
  const multiline = [
    'on:',
    '  pull_request:',
    '    branches: [production]',
    '    types:',
    '      - opened',
    '      - synchronize',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('multiline', multiline), ['multiline: no concurrency block']);
});

test('the guard covers trusted pull request workflows as well', () => {
  const trusted = [
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize]',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('trusted', trusted), ['trusted: no concurrency block']);
});

test('the guard rejects a group that names no pull request and a constant-false cancel', () => {
  const literal = [
    'on:',
    '  pull_request:',
    'concurrency:',
    '  group: github.ref',
    '  cancel-in-progress: ${{ false }}',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('literal', literal), [
    'literal: concurrency group github.ref is not per pull request',
    'literal: cancel-in-progress is false',
  ]);
});

test('a workflow added after the exception list gets no exemption', () => {
  const added = [
    'on:',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('new-checks', added), ['new-checks: no concurrency block']);
});

test('a gate fails when cancel-in-progress is missing or false', () => {
  const missing = [
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize]',
    'concurrency:',
    '  group: feature-flag-gate-${{ github.event.pull_request.number }}',
    '',
  ].join('\n');
  const held = missing.replace(
    '  group: feature-flag-gate-${{ github.event.pull_request.number }}',
    '  group: pr-guards-trusted-${{ github.event.pull_request.number }}\n  cancel-in-progress: false',
  );
  assert.deepEqual(problemsFor('feature-flag-gate', missing), [
    'feature-flag-gate: cancel-in-progress is missing',
  ]);
  assert.deepEqual(problemsFor('pr-guards-trusted', held), [
    'pr-guards-trusted: cancel-in-progress is false',
  ]);
});

test('a gate fails when it loses its concurrency block', () => {
  const bare = [
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize]',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('ux-signoff-gate', bare), ['ux-signoff-gate: no concurrency block']);
});

test('a gate fails when its group is unique per run', () => {
  const perRun = [
    'on:',
    '  pull_request:',
    '    types: [synchronize]',
    'concurrency:',
    '  group: ${{ github.run_id }}',
    '  cancel-in-progress: true',
    '',
  ].join('\n');
  const perCommit = perRun.replace('github.run_id', 'github.sha');
  assert.deepEqual(problemsFor('ci-tests', perRun), [
    'ci-tests: concurrency group ${{ github.run_id }} is not per pull request',
  ]);
  assert.deepEqual(problemsFor('ci-tests', perCommit), [
    'ci-tests: concurrency group ${{ github.sha }} is not per pull request',
  ]);
});

test('a job-level group does not stand in for the workflow group', () => {
  const jobLevel = [
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize]',
    'jobs:',
    '  gate:',
    '    runs-on: ubuntu-latest',
    '    concurrency:',
    '      group: codex-review-gate-${{ github.event.pull_request.number }}',
    '      cancel-in-progress: true',
    '',
  ].join('\n');
  assert.deepEqual(problemsFor('codex-review-gate', jobLevel), ['codex-review-gate: no concurrency block']);
});
