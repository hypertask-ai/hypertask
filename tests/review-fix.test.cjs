const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { eligible, findingsText, markers, markerBody, pick, MAX_FIXES } = require('../.github/scripts/review-fix/review-fix.cjs');

const repo = 'hypertask-ai/hypertask';
const sha = 'a'.repeat(40);
const pr = overrides => ({
  state: 'open', draft: false, base: { ref: 'production' }, head: { sha, ref: 'x', repo: { full_name: repo } },
  user: { login: 'someone' }, labels: [], ...overrides,
});
const red = [{ context: 'ai-review', state: 'failure', description: 'worst P1' }];
const bot = body => ({ user: { login: 'github-actions[bot]' }, body });
const yml = fs.readFileSync(path.join(__dirname, '../.github/workflows/review-fix.yml'), 'utf8');

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
  const claudeStep = yml.split('- name: Fix with file tools only')[1].split('- name:')[0];
  assert.doesNotMatch(claudeStep, /AUTOMERGE_TOKEN|GH_TOKEN|github\.token/);
  assert.match(claudeStep, /--tools Read,Edit,Write,Glob,Grep/);
  assert.match(claudeStep, /--settings \.\.\/trusted\/\.github\/scripts\/review-fix\/settings\.json/);
  assert.doesNotMatch(claudeStep, /Bash/);
  assert.match(claudeStep, /--safe-mode/);
  assert.ok(['Edit', 'Write'].every((tool) => require('../.github/scripts/review-fix/settings.json').permissions.deny.includes(`${tool}(//home/runner/work/*/*/trusted/**)`)));
});

test('a cancelled fix run never marks its head as tried', () => {
  const record = yml.split('- name: Record the attempt')[1];
  assert.match(record, /if: success\(\) \|\| failure\(\)/);
  assert.match(yml, /group: review-fix-pr-\$\{\{ matrix\.pull\.number \}\}\n\s+cancel-in-progress: false/);
});

test('the push leases the head the fix started from', () => {
  const push = yml.split('- name: Push the fix')[1].split('- name:')[0];
  assert.match(push, /git ls-remote --exit-code "\$url" "refs\/heads\/\$\{BRANCH\}"/);
  assert.equal((push.match(/--force/g) || []).length, 1);
  assert.match(push, /git push --force-with-lease="refs\/heads\/\$\{BRANCH\}:\$\{\{ matrix\.pull\.sha \}\}" "\$url" "HEAD:refs\/heads\/\$\{BRANCH\}"/);
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
