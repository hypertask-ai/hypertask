const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixtureDir = path.join(__dirname, 'fixtures/ci-failure-log');
const read = file => readFileSync(path.join(fixtureDir, file), 'utf8');
const subject = import('../scripts/ci-failure-log.mjs');

test('a red run adds exactly one line and a replay adds nothing', async () => {
  const { appendEntry, parseLog } = await subject;
  const line = JSON.stringify({ run: 7, attempt: 1, cause: 'test|ci-tests|boom', error: 'boom', at: '2026-10-01T00:00:00Z' });
  const first = appendEntry('', JSON.parse(line));
  assert.equal(first.added, true);
  assert.equal(parseLog(first.text).length, 1);
  const second = appendEntry(first.text, JSON.parse(line));
  assert.equal(second.added, false);
  assert.equal(second.text, first.text);
});

test('each red run in the seed fixture becomes one line, duplicates rejected', async () => {
  const { fixtureEntries, appendEntry } = await subject;
  const fixture = JSON.parse(read('seed.json'));
  const entries = fixtureEntries(fixture);
  assert.deepEqual(entries.map(entry => entry.run), [101, 102, 103]);
  assert.equal(entries[2].cascade, false, 'the primary failure is logged, not its dependent');
  const text = entries.reduce((state, entry) => appendEntry(state, entry).text, '');
  const replay = entries.reduce((state, entry) => appendEntry(state, entry).text, text);
  assert.equal(replay, text);
});

test('causes group with counts and only two or more lines are eligible', async () => {
  const { parseLog, groupEntries, ticketPlan, formatReport } = await subject;
  const groups = groupEntries(parseLog(read('repeat.jsonl')));
  assert.deepEqual(groups.map(group => group.lines), [3, 2, 1]);
  const plan = ticketPlan(groups);
  assert.equal(plan.create.length, 2);
  assert.equal(plan.comment.length, 0);
  assert.match(formatReport(groups), /groups=3 eligible=2 ineligible=1/);
});

test('a cause that already has a ticket is commented on, never filed twice', async () => {
  const { groupEntries, ticketPlan } = await subject;
  const fixture = JSON.parse(read('filed.json'));
  const existing = new Map(fixture.existing.map(task => [task.cause, task]));
  const plan = ticketPlan(groupEntries(fixture.entries), existing);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.comment.length, 1);
  assert.equal(plan.comment[0].task.uniqueIndex, 88);
});

test('cause keys ignore run numbers and hashes but keep the failing step', async () => {
  const { causeKey } = await subject;
  const a = causeKey({ step: 'Test', job: 'ci-tests', error: 'AssertionError: expected 2, got 1 at 4f2c9a1' });
  const b = causeKey({ step: 'Test', job: 'ci-tests', error: 'AssertionError: expected 7, got 3 at 9be11c2' });
  const c = causeKey({ step: 'Browser test', job: 'browser-smoke', error: 'AssertionError: expected 2, got 1 at 4f2c9a1' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('a run that later passed on the same code marks its lines flaky', async () => {
  const { markFlaky } = await subject;
  const entries = [{ run: 1, sha: 'abc', branch: 'runner-1/x', at: '2026-10-01T00:00:00Z' }];
  const marked = markFlaky(entries, [{ head_sha: 'abc', head_branch: 'runner-1/x', created_at: '2026-10-01T02:00:00Z' }]);
  assert.equal(marked[0].flaky, true);
  const unmarked = markFlaky(entries, [{ head_sha: 'abc', head_branch: 'runner-1/x', created_at: '2026-09-30T02:00:00Z' }]);
  assert.equal(unmarked[0].flaky, undefined);
});

test('the cause marker travels with the filed ticket so a rerun finds it', async () => {
  const { ticketHtml, ticketTitle } = await subject;
  const group = {
    cause: 'test|ci-tests|not-ok-4-rate-limit-wait-cap-exceeded',
    job: 'ci-tests',
    step: 'Test',
    lines: 3,
    runs: [1, 2, 3],
    branches: ['runner-1/a'],
    errors: ['not ok 4 - rate limit wait cap exceeded'],
    tests: ['tests/rate-limit.test.cjs'],
    prs: [],
    flaky: true,
    first: '2026-10-19T00:00:00Z',
    last: '2026-10-21T00:00:00Z',
  };
  assert.match(ticketHtml(group), /<!-- ci-failure-cause:test\|ci-tests\|not-ok-4-rate-limit-wait-cap-exceeded -->/);
  assert.equal(ticketTitle(group), '[INFRA] CI failure cause: Test in ci-tests');
});

test('the CLI prints the fixture tokens the ticket gates read', async () => {
  const result = spawnSync(process.execPath, ['scripts/ci-failure-log.mjs', '--print-fixture', path.join(fixtureDir, 'seed.json')], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'entryHashes=3 duplicateAppendRejected=yes');
});
