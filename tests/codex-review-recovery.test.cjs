const assert = require('node:assert/strict');
const test = require('node:test');
const { run } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const old = 'b'.repeat(40);
const marker = sha => `<!-- codex-review-request:${sha} -->`;
const comment = (login, body) => ({ author: { login }, body });

async function sweep({ comments = [], reviews = [], isDraft = false, currentHead = head, state = 'open' } = {}) {
  const posted = [];
  const statuses = [];
  const node = {
    number: 3331, isDraft, isCrossRepository: false, headRefOid: head,
    commits: { nodes: [{ commit: { oid: head, status: { contexts: [] } } }] },
    reviews: { pageInfo: { hasPreviousPage: false }, nodes: reviews },
    comments: { nodes: comments },
  };
  const github = {
    graphql: async () => ({ repository: { pullRequests: { nodes: [node], pageInfo: { hasNextPage: false } } } }),
    paginate: async () => [],
    rest: {
      pulls: { get: async () => ({ data: { head: { sha: currentHead }, state, draft: isDraft } }) },
      issues: { createComment: async value => posted.push(value) },
      repos: { createCommitStatus: async value => statuses.push(value) },
      checks: { listForRef: async () => {}, create: async () => {} },
    },
  };
  await run({ github, context: { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, payload: {}, serverUrl: 'https://github.com' }, core: { info() {} } });
  return { posted, statuses };
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
