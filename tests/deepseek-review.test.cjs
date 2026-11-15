const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, claudeResultFor } = require('../.github/scripts/codex-review-gate.cjs');
const review = require('../.github/scripts/claude-review/claude-review.cjs');

const head = 'a'.repeat(40);
const finding = (severity, confidence = 'high') => ({ severity, file: 'a.ts', line: 3, title: 't', details: 'd', confidence, evidence: 'e' });
const payload = (body, model = review.DEEPSEEK_MODEL) => ({
  model,
  choices: [{ message: { content: JSON.stringify(body) } }],
});
const approveBody = { verdict: 'APPROVE', summary: 'Looks right.', findings: [] };

function withKey(key, run) {
  const previous = process.env.OPENCODE_API_KEY;
  if (key === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = key;
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previous;
  });
}

test('HTPR-9350 the DeepSeek request uses the flash model, the shared prompt and no key in the body', () => {
  const request = review.deepseekRequest('test-key', 'diff context');
  assert.equal(request.url, 'https://opencode.ai/inference/go/v1/chat/completions');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers.authorization, 'Bearer test-key');
  assert.equal(request.body.model, 'deepseek-v4.1-flash');
  assert.equal(/fast|pro/i.test(request.body.model), false);
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(request.body.messages[0].content.startsWith(review.INSTRUCTIONS), true);
  assert.equal(request.body.messages[0].content.includes(JSON.stringify(review.SCHEMA)), true);
  assert.deepEqual(request.body.messages[1], { role: 'user', content: 'diff context' });
  assert.equal(JSON.stringify(request.body).includes('test-key'), false);
});

test('HTPR-9350 a clean flash review approves and the gate publishes that model', () => {
  const decided = review.deepseekComment(200, payload(approveBody), head);
  assert.equal(decided.approval, true);
  assert.equal(decided.review.verdict, 'APPROVE');
  assert.equal(decided.review.model, 'deepseek-v4.1-flash');
  assert.match(decided.comment, /\*\*deepseek-v4\.1-flash review: no blocker or major findings\.\*\*/);
  const parsed = claudeResultFor([{ author: 'github-actions[bot]', url: 'https://example.test/c/deepseek', body: decided.comment }], head, 'deepseek');
  assert.equal(parsed.state, 'success');
  assert.match(parsed.description, /^deepseek-v4\.1-flash reviewed aaaaaaa: no blocker\/major findings/);
  const result = evaluate({
    headOid: head, reviewer: 'deepseek', reviews: [],
    comments: [{ author: 'github-actions[bot]', url: 'https://example.test/c/deepseek', body: decided.comment }],
  });
  assert.equal(result.state, 'success');
});

test('HTPR-9350 a blocker stays a failure even when the model wrote APPROVE', () => {
  const decided = review.deepseekComment(200, payload({ verdict: 'APPROVE', summary: 'bug', findings: [finding('blocker')] }), head);
  assert.equal(decided.approval, false);
  assert.equal(decided.review.verdict, 'CONCERNS');
  assert.equal(decided.review.blocking, 1);
  assert.equal(claudeResultFor([{ author: 'github-actions', url: 'u', body: decided.comment }], head, 'deepseek').state, 'failure');
});

test('HTPR-9350 HTTP 401, 402 and 429 fail clearly and never approve, even if the body says APPROVE', async () => {
  await withKey('test-key', async () => {
    for (const status of [401, 402, 429]) {
      const decided = await review.callDeepSeek('diff context', async (url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(url, review.DEEPSEEK_URL);
        assert.equal(body.model, review.DEEPSEEK_MODEL);
        assert.equal(init.headers.authorization, 'Bearer test-key');
        return { status, async json() { return payload(approveBody); } };
      }, head);
      assert.equal(decided.ok, false);
      assert.equal(decided.approval, false);
      assert.equal(decided.comment, null);
      assert.equal(decided.review, null);
      assert.match(decided.reason, new RegExp(`DeepSeek plan is out \\(HTTP ${status}\\)`));
      assert.match(decided.reason, /No review and no approval/);
    }
  });
});

test('HTPR-9350 a pro model id and a cut-off diff are not approvals', () => {
  const pro = review.deepseekComment(200, payload(approveBody, 'deepseek-v4.1-pro'), head);
  assert.equal(pro.approval, false);
  assert.equal(pro.comment, null);
  assert.match(pro.reason, /No approval/);
  assert.throws(() => review.assertWholeDiff('x'.repeat(review.MAX_DIFF_CHARS + 1)), error => {
    assert.equal(error.approval, false);
    assert.match(error.message, /Refusing to review a cut-off diff/);
    return true;
  });
  assert.equal(review.assertWholeDiff('diff --git a/a b/a\n'), 'diff --git a/a b/a\n');
});

test('HTPR-9350 a missing key fails before any call', async () => {
  await withKey(undefined, async () => {
    let called = false;
    await assert.rejects(
      () => review.callDeepSeek('diff context', async () => { called = true; return { status: 200, async json() { return payload(approveBody); } }; }, head),
      error => {
        assert.equal(called, false);
        assert.equal(error.approval, false);
        assert.match(error.message, /OPENCODE_API_KEY is empty or missing/);
        assert.match(error.message, /No other key is used/);
        return true;
      },
    );
  });
});
