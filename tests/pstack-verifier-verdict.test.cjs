const assert = require('node:assert/strict');
const test = require('node:test');
const verdict = require('../.github/scripts/pstack-verifier/verdict.cjs');

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function message(family, extra = 'Co-Authored-By: Example <noreply@example.com>') {
  return `HTPR-1 Change the inbox\n\nAuthor-Family: ${family}\n${extra}\n`;
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

test('a hook trailer after Author-Family still yields that family', () => {
  const hooked = [
    'HTPR-8938 [INFRA] Keep the verifier verdict',
    '',
    'Author-Family: grok',
    'Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>',
    'Co-authored-by: Cursor <cursoragent@cursor.com>',
    '',
  ].join('\n');
  assert.deepEqual(verdict.authorFamilyFromMessage(hooked).families, ['grok']);
  assert.equal(verdict.authorFamilyFromMessages([hooked, message('grok')]).families.join('+'), 'grok');
});

test('a manual family is used only when no commit trailer is valid, and a trailer wins', () => {
  const trailer = verdict.resolveAuthorFamily({
    messages: [message('grok')],
    manual: 'claude',
    eventName: 'workflow_dispatch',
  });
  assert.equal(trailer.source, 'trailer');
  assert.deepEqual(trailer.families, ['grok']);
  const open = verdict.resolveAuthorFamily({
    messages: ['Subject\n\nNo trailer here.\n'],
    manual: 'DeepSeek',
    eventName: 'workflow_dispatch',
  });
  assert.equal(open.source, 'manual');
  assert.deepEqual(open.families, ['deepseek']);
  const partial = verdict.resolveAuthorFamily({
    messages: [message('grok'), 'Subject\n\nNo trailer\n'],
    manual: 'deepseek',
    eventName: 'workflow_dispatch',
  });
  assert.equal(partial.known, false);
  assert.equal(partial.source, 'trailer');
  const bad = verdict.resolveAuthorFamily({
    messages: ['Subject\n\nNo trailer\n'],
    manual: 'Claude Fable',
    eventName: 'workflow_dispatch',
  });
  assert.equal(bad.known, false);
  assert.equal(bad.source, 'none');
  const automatic = verdict.resolveAuthorFamily({
    messages: ['Subject\n\nNo trailer\n'],
    manual: 'grok',
    eventName: 'workflow_run',
  });
  assert.equal(automatic.known, false);
  assert.equal(verdict.manualForEvent('workflow_run', 'grok'), '');
  assert.equal(verdict.manualForEvent('pull_request', 'grok'), '');
  assert.equal(verdict.manualForEvent('workflow_dispatch', ' grok '), ' grok ');
});

test('verifier order is DeepSeek, then Codex, then Claude, and a plan that is out moves on', async () => {
  assert.deepEqual(verdict.VERIFIER_FAMILIES, ['deepseek', 'codex', 'claude']);
  const ready = verdict.planReadiness({ deepseek: 'true', claude: true, openai: true });
  assert.deepEqual(ready, { deepseek: true, codex: false, claude: true });
  assert.deepEqual(verdict.ABSENT_PLAN_SECRETS, ['CODEX_API_KEY']);
  assert.deepEqual(verdict.PLAN_SECRETS.deepseek, 'OPENCODE_API_KEY');
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['grok'], ready }), ['deepseek', 'claude']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['deepseek'], ready }), ['claude']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['claude'], ready }), ['deepseek']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['codex'], ready }), ['deepseek', 'claude']);
  assert.deepEqual(verdict.familiesToTry({ known: true, families: ['human'], ready }), ['deepseek', 'claude']);
  assert.deepEqual(verdict.familiesToTry({ known: false, families: [], ready }), []);
  const seen = [];
  const result = await verdict.firstVerdict(['deepseek', 'codex', 'claude'], async family => {
    seen.push(family);
    if (family === 'deepseek' || family === 'codex') return { out: true };
    return { verdict: { verdict: 'PASS', notes: 'both pages loaded' } };
  });
  assert.deepEqual(seen, ['deepseek', 'codex', 'claude']);
  assert.equal(result.family, 'claude');
  assert.equal(result.verdict.verdict, 'PASS');
  const none = await verdict.firstVerdict(['deepseek'], async () => ({ failed: true }));
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
  assert.equal(verdict.publishAllowed(SHA, SHA), true);
  assert.equal(verdict.publishAllowed(SHA, OTHER), false);
  assert.equal(verdict.checkConclusion('PASS'), 'success');
  assert.equal(verdict.checkConclusion('PASS+NOTES'), 'success');
  assert.equal(verdict.checkConclusion('FAIL'), 'failure');
  const body = verdict.commentBody({
    headSha: SHA,
    verdict: 'FAIL',
    notes: 'Author family is unknown. Mail user@example.com sk-abcdefghijklmnop',
    authorFamily: 'unknown',
    verifierFamily: null,
    driven: ['none'],
    evidenceLinks: ['https://github.com/hypertask-ai/hypertask/actions/runs/1', 'http://insecure.example/skip'],
  });
  assert.equal(body.split('\n')[0], `pstack-verifier: FAIL @ ${SHA}`);
  assert.equal(verdict.verdictCounts(body.split('\n')[0], SHA), true);
  assert.equal(verdict.verdictCounts(body.split('\n')[0], OTHER), false);
  assert.match(body, /author-family: unknown/);
  assert.match(body, /verifier-family: none/);
  assert.doesNotMatch(body, /user@example.com/);
  assert.doesNotMatch(body, /sk-abcdefghijklmnop/);
  assert.doesNotMatch(body, /insecure\.example/);
});
