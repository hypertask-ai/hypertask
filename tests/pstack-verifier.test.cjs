const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const verdict = require('../.github/scripts/pstack-verifier/verdict.cjs');
const { buildPlan } = require('../.github/scripts/pstack-verifier/prepare.cjs');
const { decide } = require('../.github/scripts/pstack-verifier/verify.cjs');

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function message(family) {
  return `HTPR-1 Change the inbox\n\nAuthor-Family: ${family}\nCo-Authored-By: Example <noreply@example.com>\n`;
}

function pull({ files, messages, sha = SHA, fork = false, draft = false, state = 'open', base = 'production' }) {
  return {
    pr: {
      draft,
      state,
      head: { sha, repo: { full_name: fork ? 'other/hypertask' : 'hypertask-ai/hypertask' } },
      base: { ref: base, repo: { full_name: 'hypertask-ai/hypertask' } },
    },
    commits: messages.map(text => ({ commit: { message: text } })),
    files: files.map(filename => ({ filename })),
  };
}

test('the author family is the Author-Family trailer and a body mention does not count', () => {
  assert.deepEqual(verdict.authorFamilyFromMessage(message('grok')).families, ['grok']);
  assert.equal(verdict.authorFamilyFromMessage('Author-Family: claude\n').known, false);
  const buried = 'Subject\n\nThe Author-Family: claude is prose.\n\nCo-Authored-By: Example <noreply@example.com>\n';
  assert.equal(verdict.authorFamilyFromMessage(buried).known, false);
  assert.equal(verdict.authorFamilyFromMessage('Subject\n\nAuthor-Family: Claude Fable\n').known, false);
  const mixed = verdict.authorFamilyFromMessages([message('claude'), message('grok')]);
  assert.deepEqual(mixed.families.sort(), ['claude', 'grok']);
  assert.equal(verdict.authorFamilyFromMessages([message('claude'), 'Subject\n\nNo trailer\n']).known, false);
  assert.equal(verdict.authorFamilyFromMessages([]).known, false);
});

test('verifier order is Codex, then Claude, then DeepSeek, skipping the author and a plan that is out', () => {
  const ready = verdict.planReadiness({ claude: 'true', deepseek: true, openai: true });
  assert.deepEqual(ready, { codex: false, claude: true, deepseek: true });
  assert.deepEqual(verdict.ABSENT_PLAN_SECRETS, ['CODEX_API_KEY']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['grok'], ready }), ['claude', 'deepseek']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['claude'], ready }), ['deepseek']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['deepseek'], ready }), ['claude']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['claude', 'deepseek'], ready }), []);
  assert.deepEqual(verdict.familiesToTry({ known: false, families: [], ready }), []);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['human'], ready: verdict.planReadiness({}) }), []);
});

test('a plan that is out is skipped and the next family can answer', async () => {
  const result = await verdict.firstVerdict(['claude', 'deepseek'], async family => {
    if (family === 'claude') return { out: true };
    return { verdict: { verdict: 'PASS', notes: 'both pages loaded' } };
  });
  assert.equal(result.family, 'deepseek');
  assert.equal(result.verdict.verdict, 'PASS');
  const none = await verdict.firstVerdict(['claude'], async () => ({ failed: true }));
  assert.equal(none.family, null);
  assert.equal(none.verdict, null);
});

test('the verdict line is exact and only the current head counts', () => {
  assert.equal(verdict.verdictLine('PASS', SHA), `pstack-verifier: PASS @ ${SHA}`);
  assert.equal(verdict.verdictLine('PASS+NOTES', SHA), `pstack-verifier: PASS+NOTES @ ${SHA}`);
  assert.equal(verdict.verdictLine('FAIL', SHA), `pstack-verifier: FAIL @ ${SHA}`);
  assert.throws(() => verdict.verdictLine('MAYBE', SHA), /bad verdict/);
  assert.throws(() => verdict.verdictLine('PASS', 'abc'), /bad sha/);
  assert.equal(verdict.verdictCounts(`pstack-verifier: PASS+NOTES @ ${SHA}`, SHA), true);
  assert.equal(verdict.verdictCounts(`pstack-verifier: PASS @ ${SHA}`, SHA), true);
  assert.equal(verdict.verdictCounts(`pstack-verifier: PASS @ ${SHA}`, OTHER), false);
  assert.equal(verdict.verdictCounts(`pstack-verifier: PASS @ ${SHA} extra`, SHA), false);
  assert.equal(verdict.verdictCounts('PASS', SHA), false);
  assert.equal(verdict.publishAllowed(SHA, SHA), true);
  assert.equal(verdict.publishAllowed(SHA, OTHER), false);
  assert.equal(verdict.checkConclusion('PASS'), 'success');
  assert.equal(verdict.checkConclusion('PASS+NOTES'), 'success');
  assert.equal(verdict.checkConclusion('FAIL'), 'failure');
  const body = verdict.commentBody({
    headSha: SHA,
    verdict: 'FAIL',
    notes: 'Author family is unknown. Mail user@example.com',
    authorFamily: 'unknown',
    verifierFamily: null,
    driven: ['none'],
    evidenceLinks: ['https://github.com/hypertask-ai/hypertask/actions/runs/1'],
  });
  assert.equal(body.split('\n')[0], `pstack-verifier: FAIL @ ${SHA}`);
  assert.equal(verdict.verdictCounts(body.split('\n')[0], SHA), true);
  assert.equal(verdict.verdictCounts(body.split('\n')[0], OTHER), false);
  assert.match(body, /author-family: unknown/);
  assert.match(body, /verifier-family: none/);
  assert.doesNotMatch(body, /user@example.com/);
});

test('a screen change is driven from the feature map and a docs change is a check', () => {
  assert.equal(verdict.surfaceOf(['docs/ci.md', 'tests/a.test.cjs']), 'check');
  assert.equal(verdict.surfaceOf(['src/app/inbox/page.tsx']), 'app');
  assert.deepEqual(verdict.checkPlan(['docs/ci.md', 'README.md']), { kind: 'docs', commands: [], files: ['docs/ci.md', 'README.md'] });
  assert.deepEqual(verdict.checkPlan(['tests/b.test.cjs', 'tests/a.test.cjs']).commands, [['--test', 'tests/a.test.cjs', 'tests/b.test.cjs']]);
  assert.equal(verdict.checkPlan(['package.json']).kind, 'unrun');
  assert.equal(verdict.checkPlan(['tests/../secret.test.cjs']).kind, 'unsafe');
  assert.equal(verdict.commandAllowed(['--test', 'tests/a.test.cjs']), true);
  assert.equal(verdict.commandAllowed(['--eval', 'tests/a.test.cjs']), false);
  assert.equal(verdict.workflowHostsOk([{ path: '.github/workflows/a.yml', text: 'runs-on: ubuntu-latest' }]).ok, true);
  assert.deepEqual(verdict.workflowHostsOk([{ path: '.github/workflows/a.yml', text: 'runs-on: [self-hosted]' }]).bad, ['.github/workflows/a.yml']);
  const maps = [{
    area: 'inbox',
    file: 'inbox.md',
    body: 'Open `src/pages/inbox/page.tsx`.\n\nhttps://app.hypertask.ai/inbox\n',
  }, {
    area: 'billing-and-plans',
    file: 'billing-and-plans.md',
    body: 'https://app.hypertask.ai/settings/billing\n',
  }];
  assert.deepEqual(verdict.driveTargets(['src/pages/inbox/list.tsx'], maps), [{ area: 'inbox', file: 'inbox.md', route: '/inbox' }]);
  assert.deepEqual(verdict.driveTargets(['docs/ci.md'], maps), []);
  assert.equal(verdict.decideCheckVerdict({ kind: 'docs' }).verdict, 'PASS+NOTES');
  assert.equal(verdict.decideCheckVerdict({ kind: 'test', exitCode: 1, command: 'node --test tests/a.test.cjs' }).verdict, 'FAIL');
  assert.equal(verdict.decideCheckVerdict({ kind: 'test', exitCode: null }).verdict, 'FAIL');
  assert.equal(verdict.decideCheckVerdict({ kind: 'workflow', hostsOk: false }).verdict, 'FAIL');
  assert.equal(verdict.decideCheckVerdict({ kind: 'unrun' }).verdict, 'FAIL');
});

test('the head preview must be a READY deployment for that sha', () => {
  const query = verdict.deploymentQuery(SHA);
  assert.match(query, new RegExp(`sha=${SHA}`));
  assert.doesNotMatch(query, /target=production/);
  assert.equal(verdict.parentUrl('production'), 'https://app.hypertask.ai');
  assert.equal(verdict.parentUrl('main'), null);
  const deployments = [
    { state: 'BUILDING', meta: { githubCommitSha: SHA }, url: 'hypertasks-prod-git-boss-1-hypertaskai.vercel.app' },
    { state: 'READY', meta: { githubCommitSha: OTHER }, url: 'other.vercel.app' },
    { state: 'READY', meta: { githubCommitSha: SHA }, url: 'https://hypertasks-prod-git-boss-1-hypertaskai.vercel.app' },
  ];
  assert.equal(verdict.previewFromDeployments(deployments, SHA), 'https://hypertasks-prod-git-boss-1-hypertaskai.vercel.app');
  assert.equal(verdict.previewFromDeployments([{ state: 'READY', meta: { githubCommitSha: SHA }, url: 'http://evil.vercel.app' }], SHA), null);
  assert.equal(verdict.previewFromDeployments([{ state: 'READY', meta: { githubCommitSha: SHA }, url: 'https://evil.example' }], SHA), null);
  assert.equal(verdict.previewFromStatuses({ commitStatuses: [{ state: 'success', target_url: 'https://vercel.com/hypertaskai/hypertasks-prod/abc' }] }), null);
  assert.equal(verdict.allowedAppUrl('https://app.hypertask.ai'), true);
  assert.equal(verdict.allowedAppUrl('http://app.hypertask.ai'), false);
});

test('a model PASS cannot pass a drive that did not land', () => {
  const failed = verdict.decideAppVerdict({
    modelVerdict: { verdict: 'PASS', notes: 'looks fine' },
    observations: [{ ok: false, base: 'https://app.hypertask.ai', finalPath: '/login' }],
  });
  assert.equal(failed.verdict, 'FAIL');
  const passed = verdict.decideAppVerdict({
    modelVerdict: { verdict: 'PASS+NOTES', notes: 'the inbox row is there' },
    observations: [{ ok: true, base: 'https://app.hypertask.ai', finalPath: '/inbox' }],
  });
  assert.equal(passed.verdict, 'PASS+NOTES');
  assert.equal(verdict.modelVerdictFromClaude(JSON.stringify({ is_error: true, result: 'usage limit' })).out, true);
  assert.equal(verdict.modelVerdictFromDeepseek(429, {}).out, true);
  assert.equal(verdict.modelVerdictFromDeepseek(200, { choices: [{ message: { content: '{"verdict":"FAIL","notes":"head stayed on login"}' } }] }).verdict.verdict, 'FAIL');
  const prompt = verdict.judgePrompt({ paths: ['src/app/inbox/page.tsx'], targets: [], observations: [], parent: 'https://app.hypertask.ai', head: 'https://head.vercel.app' });
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /https:\/\/head\.vercel\.app/);
});

test('the plan refuses a fork, an unknown author, the author family, and a stale head', () => {
  const repo = 'hypertask-ai/hypertask';
  const fork = buildPlan({
    repo, number: 7, eventSha: '', claudeReady: 'true', deepseekReady: 'true',
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: [message('grok')], fork: true }),
  });
  assert.equal(fork.blocked, 'fork');
  assert.equal(fork.post, true);
  assert.equal(fork.checkout, 'no');
  const unknown = buildPlan({
    repo, number: 7, eventSha: '', claudeReady: 'true', deepseekReady: 'true',
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: ['Subject\n\nNo trailer\n'] }),
  });
  assert.equal(unknown.blocked, 'author');
  const claudeAuthor = buildPlan({
    repo, number: 7, eventSha: '', claudeReady: 'true', deepseekReady: 'false',
    read: () => pull({ files: ['tests/a.test.cjs'], messages: [message('claude')] }),
  });
  assert.equal(claudeAuthor.blocked, 'plan');
  assert.deepEqual(claudeAuthor.tryFamilies, []);
  const grok = buildPlan({
    repo, number: 7, eventSha: '', claudeReady: 'true', deepseekReady: 'true',
    read: () => pull({ files: ['tests/a.test.cjs', '.github/workflows/pstack-verifier.yml'], messages: [message('grok')] }),
  });
  assert.deepEqual(grok.tryFamilies, ['claude', 'deepseek']);
  assert.equal(grok.surface, 'check');
  assert.equal(grok.checkout, 'yes');
  assert.equal(grok.kind, 'test');
  const stale = buildPlan({
    repo, number: 7, eventSha: OTHER, claudeReady: 'true', deepseekReady: 'true',
    read: () => pull({ files: ['docs/ci.md'], messages: [message('human')] }),
  });
  assert.equal(stale.blocked, 'stale');
  assert.equal(stale.post, false);
  const screen = buildPlan({
    repo, number: 7, eventSha: SHA, claudeReady: 'true', deepseekReady: 'true',
    read: () => pull({ files: ['src/app/inbox/page.tsx'], messages: [message('human')] }),
  });
  assert.equal(screen.surface, 'app');
  assert.equal(screen.checkout, 'no');
  assert.equal(screen.parentUrl, 'https://app.hypertask.ai');
});

test('an unknown author fails closed and a docs change does not pretend the app was driven', async () => {
  const unknown = await decide({ blocked: 'author', authorFamily: 'unknown', tryFamilies: [], go: true, post: true });
  assert.equal(unknown.verdict, 'FAIL');
  assert.match(unknown.notes, /Author family is unknown/);
  assert.equal(unknown.verifierFamily, null);
  const docs = await decide({
    blocked: '',
    surface: 'check',
    kind: 'docs',
    checkout: 'no',
    tryFamilies: ['claude'],
    authorFamily: 'grok',
    families: ['grok'],
    paths: ['docs/ci.md'],
    commands: [],
  });
  assert.equal(docs.verdict, 'PASS+NOTES');
  assert.match(docs.notes, /Docs only/);
  assert.match(docs.notes, /Eligible verifier family: claude/);
  assert.match(docs.notes, /No page was driven/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pstack-verifier-'));
  const resultPath = path.join(dir, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ exitCode: 1, output: 'assertion failed' }));
  const previous = process.env.PSTACK_CHECK_RESULT;
  process.env.PSTACK_CHECK_RESULT = resultPath;
  try {
    const failed = await decide({
      blocked: '',
      surface: 'check',
      kind: 'test',
      checkout: 'yes',
      tryFamilies: ['deepseek'],
      authorFamily: 'claude',
      families: ['claude'],
      paths: ['tests/a.test.cjs'],
      commands: [['--test', 'tests/a.test.cjs']],
    });
    assert.equal(failed.verdict, 'FAIL');
    assert.equal(failed.verifierFamily, 'deepseek');
    assert.match(failed.driven[0], /node --test tests\/a\.test\.cjs/);
  } finally {
    if (previous === undefined) delete process.env.PSTACK_CHECK_RESULT;
    else process.env.PSTACK_CHECK_RESULT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
