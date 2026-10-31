const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { EXCEPTIONS, check, problemsFor } = require('../.github/scripts/pr-run-concurrency-guard.cjs');

const WORKFLOWS = '.github/workflows';

const workflow = name => yaml.load(readFileSync(path.join(WORKFLOWS, `${name}.yml`), 'utf8'));

test('every pull request push cancels its superseded run', () => {
  assert.deepEqual(check(WORKFLOWS), []);
});

test('the shared-line gates are the only exceptions, and each says why', () => {
  assert.deepEqual([...EXCEPTIONS.keys()], ['feature-flag-gate', 'ux-signoff-gate']);
  for (const [name, reason] of EXCEPTIONS) {
    assert.equal(workflow(name).concurrency.queue, 'max', `${name} keeps a slot for every pending event`);
    assert.equal(workflow(name).concurrency['cancel-in-progress'], false);
    assert.match(reason, /YPER4-707/);
  }
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
    path.join(directory, 'ci-tests.yml'),
    readFileSync(path.join(WORKFLOWS, 'ci-tests.yml'), 'utf8').replace(/^concurrency:\n(?: {2,}.*\n)+/m, ''),
  );
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
