const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPlan } = require('../.github/scripts/pstack-verifier/prepare.cjs');
const preview = require('../.github/scripts/pstack-verifier/preview.cjs');
const { driveTargets } = require('../.github/scripts/pstack-verifier/routes.cjs');

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REPO = 'hypertask-ai/hypertask';

function message(family) {
  return `HTPR-1 Change the inbox\n\nAuthor-Family: ${family}\nCo-Authored-By: Example <noreply@example.com>\n`;
}

function pull({ files, messages, sha = SHA, fork = false, draft = false, state = 'open', base = 'production' }) {
  return {
    pr: {
      draft,
      state,
      head: { sha, repo: { full_name: fork ? 'other/hypertask' : REPO } },
      base: { ref: base, repo: { full_name: REPO } },
    },
    commits: messages.map(text => ({ commit: { message: text } })),
    files: files.map(filename => ({ filename })),
  };
}

function plan(extra) {
  return buildPlan({ repo: REPO, number: 7, eventSha: '', deepseekReady: 'true', claudeReady: 'true', ...extra });
}

test('prepare refuses a fork, a stale head, and an unknown author on an automatic start', () => {
  const fork = plan({ read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: [message('grok')], fork: true }) });
  assert.deepEqual([fork.blocked, fork.post, fork.checkout], ['fork', true, 'no']);
  const stale = plan({
    eventSha: OTHER,
    read: () => pull({ files: ['docs/ci.md'], messages: [message('human')] }),
  });
  assert.deepEqual([stale.blocked, stale.post], ['stale', false]);
  const automatic = plan({
    eventName: 'workflow_run',
    manualFamily: 'grok',
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: ['Subject\n\nNo trailer\n'] }),
  });
  assert.deepEqual([automatic.blocked, automatic.authorSource], ['author', 'none']);
  const manual = plan({
    eventName: 'workflow_dispatch',
    manualFamily: 'Grok',
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: ['Subject\n\nNo trailer\n'] }),
  });
  assert.deepEqual([manual.blocked, manual.authorSource, manual.authorFamily, manual.checkout], ['', 'manual', 'grok', 'no']);
  assert.deepEqual(manual.tryFamilies, ['deepseek', 'claude']);
  const trailer = plan({
    eventName: 'workflow_dispatch',
    manualFamily: 'claude',
    read: () => pull({ files: ['tests/a.test.cjs'], messages: [message('grok')] }),
  });
  assert.deepEqual([trailer.authorFamily, trailer.authorSource, trailer.surface, trailer.checkout], ['grok', 'trailer', 'check', 'no']);
  const screen = plan({
    eventSha: SHA,
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: [message('human')], sha: SHA }),
  });
  assert.deepEqual([screen.surface, screen.parentUrl, screen.checkout], ['app', 'https://app.hypertask.ai', 'no']);
});

test('the head preview must be a READY deployment for that sha', async () => {
  assert.match(preview.deploymentQuery(SHA), new RegExp(`sha=${SHA}`));
  assert.doesNotMatch(preview.deploymentQuery(SHA), /target=production/);
  assert.equal(preview.parentUrl('production'), 'https://app.hypertask.ai');
  assert.equal(preview.parentUrl('main'), null);
  const deployments = [
    { state: 'BUILDING', meta: { githubCommitSha: SHA }, url: 'building.vercel.app' },
    { state: 'READY', meta: { githubCommitSha: OTHER }, url: 'other.vercel.app' },
    { state: 'READY', meta: { githubCommitSha: SHA }, url: 'https://head.vercel.app' },
  ];
  assert.equal(preview.previewFromDeployments(deployments, SHA), 'https://head.vercel.app');
  assert.equal(preview.previewFromDeployments([{ state: 'READY', meta: { githubCommitSha: SHA }, url: 'http://evil.vercel.app' }], SHA), null);
  assert.equal(preview.previewFromDeployments([{ state: 'READY', meta: { githubCommitSha: SHA }, url: 'https://evil.example' }], SHA), null);
  assert.equal(preview.previewFromStatuses({ commitStatuses: [{ state: 'success', target_url: 'https://vercel.com/hypertaskai/hypertasks-prod/abc' }] }), null);
  assert.equal(preview.previewFromStatuses({ commitStatuses: [{ state: 'success', target_url: 'https://head.vercel.app/path' }] }), 'https://head.vercel.app');
  const lookedUp = await preview.headPreview(SHA, {
    token: 'test-token',
    fetchImpl: async (url, options) => {
      assert.match(url, new RegExp(`sha=${SHA}`));
      assert.equal(options.headers.authorization, 'Bearer test-token');
      return { ok: true, json: async () => ({ deployments }) };
    },
  });
  assert.equal(lookedUp.url, 'https://head.vercel.app');
  const missing = await preview.headPreview(SHA, { token: '', fetchImpl: () => { throw new Error('called'); } });
  assert.equal(missing.url, null);
  assert.match(missing.reason, /VERCEL_TOKEN is empty/);
});

test('a screen change picks its route from the feature map', () => {
  const maps = [{
    area: 'inbox',
    file: 'inbox.md',
    body: 'Open `src/pages/inbox/page.tsx`.\n\nhttps://app.hypertask.ai/inbox\n',
  }, {
    area: 'billing-and-plans',
    file: 'billing-and-plans.md',
    body: 'https://app.hypertask.ai/settings/billing\n',
  }];
  assert.deepEqual(driveTargets(['src/pages/inbox/list.tsx'], maps), [{ area: 'inbox', file: 'inbox.md', route: '/inbox' }]);
  assert.deepEqual(driveTargets(['docs/ci.md'], maps), []);
});
