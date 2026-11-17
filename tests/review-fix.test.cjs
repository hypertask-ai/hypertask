const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { eligible, findingsText, markers, markerBody, pick, pushPlan, writeAllowed, MAX_FIXES } = require('../.github/scripts/review-fix/review-fix.cjs');

const repo = 'hypertask-ai/hypertask';
const sha = 'a'.repeat(40);
const pr = overrides => ({
  state: 'open', draft: false, base: { ref: 'production' }, head: { sha, ref: 'x', repo: { full_name: repo } },
  user: { login: 'someone' }, labels: [], ...overrides,
});
const red = [{ context: 'ai-review', state: 'failure', description: 'worst P1' }];
const bot = body => ({ user: { login: 'github-actions[bot]' }, body });
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/review-fix.yml'), 'utf8'));
const step = name => workflow.jobs.fix.steps.find(item => item.name === name);
const settings = require('../.github/scripts/review-fix/settings.json');
const checkout = '/home/runner/work/hypertask/hypertask/pr';
const rulesOnly = { permissions: { ...settings.permissions, blockWritesOutsideWorkingDirectories: false } };

test('a red ai-review on an open production PR is picked', () => {
  assert.equal(eligible({ pr: pr(), statuses: red, comments: [], repo }), '');
});

test('only the newest status per context counts', () => {
  const statuses = [{ context: 'ai-review', state: 'success' }, ...red];
  assert.equal(eligible({ pr: pr(), statuses, comments: [], repo }), 'no red review status');
});

test('forks, drafts, dependabot and the off label are skipped', () => {
  assert.match(eligible({ pr: pr({ head: { sha, repo: { full_name: 'x/y' } } }), statuses: red, comments: [], repo }), /outside/);
  assert.match(eligible({ pr: pr({ draft: true }), statuses: red, comments: [], repo }), /open production/);
  assert.match(eligible({ pr: pr({ user: { login: 'dependabot[bot]' } }), statuses: red, comments: [], repo }), /dependabot/);
  assert.match(eligible({ pr: pr({ labels: [{ name: 'review-fix-off' }] }), statuses: red, comments: [], repo }), /review-fix-off/);
});

test('a head is tried once and a PR gets at most three fix commits', () => {
  const once = [bot(markerBody({ sha, pushed: false, note: 'n' }))];
  assert.match(eligible({ pr: pr(), statuses: red, comments: once, repo }), /already tried/);
  const many = Array.from({ length: MAX_FIXES }, (_, i) => bot(markerBody({ sha: String(i), pushed: true, note: 'n' })));
  assert.match(eligible({ pr: pr(), statuses: red, comments: many, repo }), /fix commits/);
});

test('markers from anyone but github-actions are ignored', () => {
  const forged = { user: { login: 'someone' }, body: markerBody({ sha, pushed: false, note: 'n' }) };
  assert.deepEqual(markers([forged]), []);
});

test('findings keep current inline comments and drop outdated ones and replies', () => {
  const text = findingsText({
    pr: pr(), statuses: red, comments: [],
    reviews: [{ id: 1, commit_id: sha, user: { login: 'chatgpt-codex-connector[bot]' }, submitted_at: '2026-11-02T00:00:00Z' }],
    reviewComments: [
      { pull_request_review_id: 1, user: { login: 'chatgpt-codex-connector[bot]' }, path: 'a.js', line: 3, body: 'P1 keep' },
      { pull_request_review_id: 1, user: { login: 'chatgpt-codex-connector[bot]' }, path: 'a.js', line: null, body: 'outdated' },
      { pull_request_review_id: 1, user: { login: 'chatgpt-codex-connector[bot]' }, path: 'a.js', line: 3, in_reply_to_id: 1, body: 'reply' },
      { user: { login: 'someone' }, path: 'a.js', line: 3, body: 'human' },
    ],
  });
  assert.match(text, /a\.js:3[\s\S]*P1 keep/);
  assert.match(text, /worst P1/);
  assert.doesNotMatch(text, /outdated|reply|human/);
});

test('findings drop inline comments from reviews of an older commit', () => {
  const old = 'b'.repeat(40);
  const codex = { login: 'chatgpt-codex-connector[bot]' };
  const text = findingsText({
    pr: pr(), statuses: red, comments: [],
    reviews: [
      { id: 1, commit_id: old, user: codex, submitted_at: '2026-11-01T00:00:00Z' },
      { id: 2, commit_id: sha, user: codex, submitted_at: '2026-11-02T00:00:00Z' },
    ],
    reviewComments: [
      { pull_request_review_id: 1, user: codex, path: 'a.js', line: 4, body: 'P1 stale' },
      { pull_request_review_id: 2, user: codex, path: 'a.js', line: 5, body: 'P1 current' },
    ],
  });
  assert.match(text, /P1 current/);
  assert.doesNotMatch(text, /stale/);
});

test('the workflow never hands the push token to the Claude step', () => {
  const fix = step('Fix with file tools only');
  assert.deepEqual(Object.keys(fix.env), ['CLAUDE_CODE_OAUTH_TOKEN']);
  assert.equal(fix.run, 'claude -p "$(cat ../trusted/.github/scripts/review-fix/prompt.md)" --settings ../trusted/.github/scripts/review-fix/settings.json --model sonnet --effort high --tools Read,Edit,Write,Glob,Grep --allowedTools Read,Edit,Write,Glob,Grep --permission-mode acceptEdits --disable-slash-commands --no-session-persistence --safe-mode --max-turns 80 --output-format json > ../claude.json');
  for (const tool of ['Edit', 'Write']) {
    assert.equal(writeAllowed(rulesOnly, tool, '/home/runner/work/_temp/_runner_file_commands/set_env_1', checkout), false);
    assert.equal(writeAllowed(rulesOnly, tool, `${checkout}/../trusted/x`, checkout), false);
    assert.equal(writeAllowed(settings, tool, `${checkout}/src/a.js`, checkout), true);
    assert.equal(writeAllowed(settings, tool, `${checkout}/../claude.json`, checkout), false);
  }
});

test('a cancelled fix run never marks its head as tried', () => {
  assert.equal(step('Record the attempt').if, 'success() || failure()');
  assert.deepEqual(workflow.jobs.fix.concurrency, { group: 'review-fix-pr-${{ matrix.pull.number }}', 'cancel-in-progress': false });
});

test('the push leases the head the fix started from', () => {
  const push = step('Push the fix');
  assert.equal(push.env.EXPECTED_SHA, '${{ matrix.pull.sha }}');
  assert.equal(push.env.BRANCH, '${{ matrix.pull.branch }}');
  assert.equal(push.run, 'node ../trusted/.github/scripts/review-fix/review-fix.cjs push');
  const plan = pushPlan({ token: 't', repository: 'hypertask-ai/hypertask', branch: 'boss/x', sha: 'abc' });
  assert.deepEqual(plan.lsRemote, ['git', 'ls-remote', '--exit-code', 'https://x-access-token:t@github.com/hypertask-ai/hypertask.git', 'refs/heads/boss/x']);
  assert.equal(plan.push.filter(arg => arg.includes('--force')).length, 1);
  assert.equal(plan.push[2], '--force-with-lease=refs/heads/boss/x:abc');
  assert.equal(plan.push.at(-1), 'HEAD:refs/heads/boss/x');
  assert.throws(() => pushPlan({ token: '', repository: 'o/r', branch: 'b', sha: 's' }), /AUTOMERGE_TOKEN is missing/);
});

test('a manual PR input must be a positive integer', async () => {
  const calls = [];
  const github = { paginate: route => (calls.push(route), []), rest: { pulls: { get: ({ pull_number: number }) => (calls.push(number), { data: { ...pr(), state: 'closed' } }) } } };
  const run = single => pick({ github, context: { repo: { owner: 'hypertask-ai', repo: 'hypertask' } }, core: { info() {} }, single });
  for (const single of ['abc', '0', '-3', '1.5', NaN]) { calls.length = 0; await assert.rejects(run(single), /positive integer/); assert.equal(calls.length, 0); }
  calls.length = 0;
  assert.deepEqual(await run(''), []);
  assert.equal(calls[0], 'GET /repos/{owner}/{repo}/pulls');
  calls.length = 0;
  assert.deepEqual(await run('3626'), []);
  assert.equal(calls[0], 3626);
  assert.equal(calls.includes('GET /repos/{owner}/{repo}/pulls'), false);
});
