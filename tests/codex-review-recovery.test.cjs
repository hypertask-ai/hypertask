const assert = require('node:assert/strict');
const test = require('node:test');
const { run } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const old = 'b'.repeat(40);
const marker = sha => `<!-- codex-review-request:${sha} -->`;
const comment = (login, body) => ({ author: { login }, body });

async function sweep({ comments = [], reviews = [], isDraft = false, currentHead = head, state = 'open', payload = {}, base = 'production', fork = false, statusHistory = [], existingChecks = [] } = {}) {
  const posted = [];
  const statuses = [];
  const checks = [];
  const reads = [];
  let gets = 0;
  const api = name => Object.assign(async () => {}, { api: name });
  const github = {
    graphql: async () => { throw new Error('GraphQL quota exhausted'); },
    paginate: async (method, params) => {
      reads.push({ name: method.api, params });
      assert.equal(params.per_page, 100);
      switch (method.api) {
        case 'pulls.list': return [{ number: 3331 }];
        case 'pulls.listReviews': return reviews.map((review, id) => ({ id, user: review.author, html_url: review.url, body: review.body, commit_id: review.commit.oid, submitted_at: review.submittedAt }));
        case 'pulls.listReviewComments': return reviews.flatMap((review, id) => review.comments.nodes.map(entry => ({
          pull_request_review_id: id, body: entry.body, user: entry.author,
          in_reply_to_id: entry.replyTo, commit_id: entry.commit?.oid ?? review.commit.oid,
        })));
        case 'issues.listComments': return comments.map(entry => ({ ...entry, user: entry.author }));
        case 'repos.listCommitStatusesForRef': return statusHistory;
        case 'checks.listForRef': return existingChecks;
        default: throw new Error(`Unexpected read: ${method.api}`);
      }
    },
    rest: {
      pulls: {
        list: api('pulls.list'), listReviews: api('pulls.listReviews'), listReviewComments: api('pulls.listReviewComments'),
        get: async params => {
          reads.push({ name: 'pulls.get', params });
          return { data: { number: params.pull_number, head: { sha: gets++ ? currentHead : head, repo: { full_name: fork ? 'other/repo' : 'hypertask-ai/hypertask' } }, base: { ref: base, repo: { full_name: 'hypertask-ai/hypertask' } }, state, draft: isDraft } };
        },
      },
      issues: { listComments: api('issues.listComments'), createComment: async value => posted.push(value), listForRepo: async () => ({ data: [] }) },
      repos: { listCommitStatusesForRef: api('repos.listCommitStatusesForRef'), createCommitStatus: async value => statuses.push(value) },
      checks: { listForRef: api('checks.listForRef'), create: async value => checks.push(value) },
    },
  };
  await run({ github, context: { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, payload, serverUrl: 'https://github.com' }, core: { info() {} } });
  return { posted, statuses, checks, reads };
}

test('a missing latest-head review gets one exact-head request, never approval', async () => {
  const { posted, statuses } = await sweep({
    comments: [comment('github-actions', marker(old))],
    reviews: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: old }, body: 'No findings', comments: { nodes: [], pageInfo: { hasNextPage: false } } }],
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /^@codex review\n/);
  assert.ok(posted[0].body.includes(marker(head)));
  assert.deepEqual(statuses.map(value => value.state), ['pending', 'pending']);
});

test('a trusted request suppresses duplicates with either GitHub login spelling', async () => {
  for (const login of ['github-actions', 'github-actions[bot]']) {
    assert.equal((await sweep({ comments: [comment(login, marker(head))] })).posted.length, 0);
  }
  assert.equal((await sweep({ comments: [comment('someone', marker(head))] })).posted.length, 1);
});

test('running reviews are left alone only for the current head', async () => {
  for (const sha of [head, old]) {
    const body = `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: sha, status: 'running' } })} -->`;
    assert.equal((await sweep({ comments: [comment('chatgpt-codex-connector', body)] })).posted.length, sha === head ? 0 : 1);
  }
});

test('drafts, closed PRs and heads that changed during the sweep are not requested', async () => {
  for (const options of [{ isDraft: true }, { state: 'closed' }, { currentHead: old }]) {
    assert.equal((await sweep(options)).posted.length, 0);
  }
});

test('completed exact-head reviews approve without requesting another review', async () => {
  const body = `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: head, status: 'completed', has_any_findings: false } })} -->`;
  const { posted, statuses } = await sweep({ comments: [comment('chatgpt-codex-connector', body)] });
  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /^APPROVE/);
  assert.deepEqual(statuses.map(value => value.state), ['success', 'success']);
});

test('review events read only their PR without GraphQL or a repository sweep', async () => {
  for (const payload of [{ pull_request: { number: 3301 } }, { issue: { number: 3301 } }]) {
    const { reads, statuses } = await sweep({ payload });
    assert.ok(!reads.some(read => read.name === 'pulls.list'));
    assert.ok(reads.filter(read => read.params.pull_number).every(read => read.params.pull_number === 3301));
    assert.deepEqual(statuses.map(status => [status.sha, status.state]), [[head, 'pending'], [head, 'pending']]);
  }
});

test('scheduled sweeps paginate open production PRs', async () => {
  const { reads } = await sweep();
  assert.deepEqual(reads[0], { name: 'pulls.list', params: { owner: 'hypertask-ai', repo: 'hypertask', state: 'open', base: 'production', per_page: 100 } });
});

test('events for closed, fork or non-production PRs publish nothing', async () => {
  for (const options of [{ state: 'closed' }, { fork: true }, { base: 'main' }]) {
    const { statuses, checks, posted, reads } = await sweep({ ...options, payload: { issue: { number: 3301 } } });
    assert.deepEqual({ statuses, checks, posted }, { statuses: [], checks: [], posted: [] });
    assert.equal(reads.length, 1);
  }
});

test('a blocking comment past the first page defeats a clean summary', async () => {
  const body = `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: head, status: 'completed', has_any_findings: false } })} -->`;
  const findings = Array.from({ length: 100 }, () => ({ body: '[P2] Minor', author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: head } }));
  findings.push({ body: '[P1] Data loss', author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: head } });
  const { statuses, checks, posted } = await sweep({
    comments: [comment('chatgpt-codex-connector[bot]', body)],
    reviews: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: old }, comments: { nodes: findings } }],
  });
  assert.deepEqual(statuses.map(value => value.state), ['failure', 'failure']);
  assert.deepEqual(checks.map(value => [value.name, value.head_sha, value.conclusion]), [['ai-review', head, 'failure'], ['claude-review', head, 'failure']]);
  assert.equal(posted.length, 0);
});

test('replies and other authors cannot supply blocking findings', async () => {
  const { statuses, checks } = await sweep({ reviews: [{
    author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: head }, body: 'No findings',
    comments: { nodes: [
      { body: '[P1] Reply', author: { login: 'chatgpt-codex-connector[bot]' }, replyTo: 123 },
      { body: '[P1] Not Codex', author: { login: 'someone' } },
    ] },
  }] });
  assert.deepEqual(statuses.map(value => value.state), ['success', 'success']);
  assert.deepEqual(checks.map(value => value.conclusion), ['success', 'success']);
});

test('completed reviews publish both exact-head results without GraphQL', async () => {
  const { statuses, checks } = await sweep({
    payload: { pull_request: { number: 3301 } },
    reviews: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: head }, body: 'No findings', comments: { nodes: [] } }],
  });
  assert.deepEqual(statuses.map(value => [value.context, value.sha, value.state]), [['ai-review', head, 'success'], ['claude-review', head, 'success']]);
  assert.deepEqual(checks.map(value => [value.name, value.head_sha, value.conclusion]), [['ai-review', head, 'success'], ['claude-review', head, 'success']]);
});

test('only the newest status per context counts as existing', async () => {
  const description = 'Codex reviewed aaaaaaa and raised no P0 or P1 findings';
  const { statuses } = await sweep({
    payload: { pull_request: { number: 3301 } },
    reviews: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: head }, body: 'No findings', comments: { nodes: [] } }],
    statusHistory: [
      { context: 'ai-review', state: 'success', description }, { context: 'claude-review', state: 'success', description },
      { context: 'ai-review', state: 'pending', description: 'older' }, { context: 'claude-review', state: 'pending', description: 'older' },
    ],
  });
  assert.deepEqual(statuses, []);
});
