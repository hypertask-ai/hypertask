const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../.github/scripts/pstack-verifier/model.cjs');
const { decide, publish } = require('../.github/scripts/pstack-verifier/verify.cjs');

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HEAD = 'https://head.vercel.app';
const PARENT = 'https://app.hypertask.ai';

function appPlan(extra) {
  return {
    blocked: '', surface: 'app', authorFamily: 'grok', tryFamilies: ['deepseek', 'claude'],
    paths: ['src/app/inbox/page.tsx'], parentUrl: PARENT, sha: SHA, repo: 'hypertask-ai/hypertask', ...extra,
  };
}

test('the check runner does not execute pull request code', () => {
  const docs = model.runCheck(['docs/ci.md', 'README.md']);
  assert.equal(docs.kind, 'docs');
  assert.equal(docs.verdict, 'PASS+NOTES');
  assert.match(docs.notes, /Docs only/);
  const tests = model.runCheck(['tests/a.test.cjs']);
  assert.equal(tests.kind, 'test');
  assert.equal(tests.verdict, 'FAIL');
  assert.match(tests.notes, /does not execute pull request code/);
  const hosted = model.runCheck(['.github/workflows/a.yml'], [{ path: '.github/workflows/a.yml', text: 'runs-on: ubuntu-latest' }]);
  assert.equal(hosted.verdict, 'PASS+NOTES');
  const owned = model.runCheck(['.github/workflows/a.yml'], [{ path: '.github/workflows/a.yml', text: 'runs-on: [self-hosted]' }]);
  assert.equal(owned.verdict, 'FAIL');
  assert.match(owned.notes, /self-hosted/);
  assert.equal(model.runCheck(['package.json']).verdict, 'FAIL');
  assert.equal(model.runCheck(['tests/../secret.test.cjs']).kind, 'unsafe');
});

test('a plan that is out moves to the next family and a model PASS cannot pass a missed landing', async () => {
  assert.equal(model.modelVerdictFromClaude(JSON.stringify({ is_error: true, result: 'usage limit' })).out, true);
  assert.equal(model.modelVerdictFromDeepseek(429, {}).out, true);
  assert.equal(model.modelVerdictFromDeepseek(200, { choices: [{ message: { content: '{"verdict":"FAIL","notes":"head stayed on login"}' } }] }).verdict.verdict, 'FAIL');
  assert.equal(model.askFamily('codex', 'prompt').out, true);
  const seen = [];
  const passed = await decide(appPlan(), {
    email: 'present', password: 'present', maps: [{ area: 'inbox', file: 'inbox.md', body: 'Open `src/app/inbox/page.tsx`.\nhttps://app.hypertask.ai/inbox\n' }],
    headPreview: async () => ({ url: HEAD, reason: '' }),
    runDrive: () => [{ ok: true, base: PARENT, finalPath: '/inbox' }],
    ask: async family => {
      seen.push(family);
      if (family === 'deepseek') return { out: true };
      return { verdict: { verdict: 'PASS', notes: 'the inbox row is there' } };
    },
  });
  assert.deepEqual(seen, ['deepseek', 'claude']);
  assert.equal(passed.verdict, 'PASS');
  assert.equal(passed.verifierFamily, 'claude');
  let asked = false;
  const missed = await decide(appPlan(), {
    email: 'present', password: 'present', maps: [{ area: 'inbox', file: 'inbox.md', body: 'Open `src/app/inbox/page.tsx`.\nhttps://app.hypertask.ai/inbox\n' }],
    headPreview: async () => ({ url: HEAD, reason: '' }),
    runDrive: () => [{ ok: false, base: PARENT, finalPath: '/login' }],
    ask: async () => { asked = true; return { verdict: { verdict: 'PASS', notes: 'looks fine' } }; },
  });
  assert.equal(asked, false);
  assert.equal(missed.verdict, 'FAIL');
  const prompt = model.judgePrompt({ paths: ['src/app/inbox/page.tsx'], targets: [], observations: [], parent: PARENT, head: HEAD });
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, new RegExp(HEAD.replace(/\./g, '\\.')));
});

test('an unknown author fails closed, a docs change names the family, and a stale head is not posted', async () => {
  const unknown = await decide({ blocked: 'author', authorFamily: 'unknown', tryFamilies: [], surface: 'check', paths: [] });
  assert.equal(unknown.verdict, 'FAIL');
  assert.match(unknown.notes, /Author family is unknown/);
  assert.match(unknown.notes, /author_family/);
  assert.equal(unknown.verifierFamily, null);
  const docs = await decide({
    blocked: '', surface: 'check', tryFamilies: ['deepseek'], authorFamily: 'grok', paths: ['docs/ci.md'], repo: 'hypertask-ai/hypertask', sha: SHA,
  });
  assert.equal(docs.verdict, 'PASS+NOTES');
  assert.match(docs.notes, /Docs only/);
  assert.match(docs.notes, /Eligible verifier family: deepseek/);
  assert.match(docs.notes, /No page was driven/);
  let called = false;
  const stale = publish({
    repo: 'hypertask-ai/hypertask', number: 7, sha: SHA, result: unknown, currentSha: () => OTHER,
    ghImpl: () => { called = true; },
  });
  assert.equal(stale.posted, false);
  assert.equal(stale.reason, 'stale');
  assert.equal(called, false);
});
