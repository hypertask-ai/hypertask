const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { EXCEPTIONS, check, problemsFor } = require('../.github/scripts/pr-run-concurrency-guard.cjs');

const WORKFLOWS = '.github/workflows';

test('every pull request push cancels its superseded run', () => {
  assert.deepEqual(check(WORKFLOWS), []);
});

test('the shared-line gates are the only exceptions, and each says why', () => {
  assert.deepEqual([...EXCEPTIONS.keys()], ['feature-flag-gate', 'ux-signoff-gate']);
  for (const [name, reason] of EXCEPTIONS) {
    const workflow = yaml.load(readFileSync(path.join(WORKFLOWS, `${name}.yml`), 'utf8'));
    assert.equal(workflow.concurrency.queue, 'max', `${name} keeps a slot for every pending event`);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.match(reason, /YPER4-707/);
  }
});

test('the pilot workflow cancels per pull request without touching its job', () => {
  const workflow = yaml.load(readFileSync(path.join(WORKFLOWS, 'e2e-ai-pilot.yml'), 'utf8'));
  assert.deepEqual(Object.keys(workflow.jobs), ['static']);
  assert.ok(workflow.concurrency.group.includes('github.event.pull_request.number'));
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

test('the guard fails on a workflow that lost its concurrency block', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pr-concurrency-'));
  const original = readFileSync(path.join(WORKFLOWS, 'ci-tests.yml'), 'utf8');
  assert.deepEqual(check(directory), []);
  writeFileSync(path.join(directory, 'ci-tests.yml'), original.replace(/^concurrency:\n(?: {2,}.*\n)+/m, ''));
  assert.deepEqual(check(directory), ['ci-tests: no concurrency block']);
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
  const pushOnly = [
    'on:',
    '  push:',
    '    branches: [production]',
    '',
  ].join('\n');
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
