const assert = require('node:assert/strict');
const test = require('node:test');
const { run } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const bot = { login: 'chatgpt-codex-connector[bot]' };
const badge = level => `![P${level} Badge](https://img.shields.io/badge/P${level}-orange) Finding`;

const summary = {
  user: bot,
  html_url: 'https://example.test/c/1',
  created_at: '2026-11-11T11:00:00Z',
  updated_at: '2026-11-11T11:00:00Z',
  body: `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: head, status: 'completed', has_any_findings: false, has_unresolved_findings: false } })} -->`,
};

const clean = { comments: [summary], reviews: [] };

function p1Review() {
  return {
    id: 1, user: bot, html_url: 'https://example.test/r/1', body: 'Codex Review',
    commit_id: head, submitted_at: '2026-11-11T12:00:00Z',
    findings: [{ pull_request_review_id: 1, body: badge(1), user: bot, commit_id: head }],
  };
}

const freshP1 = {
  comments: [summary],
  reviews: [p1Review()],
  findings: [{ pull_request_review_id: 1, body: badge(1), user: bot, commit_id: head }],
};

async function gate(snapshots) {
  const statuses = [];
  const checks = [];
  const posted = [];
  let reads = 0;
  let active = 0;
  const snapshot = () => snapshots[active];
  const api = name => Object.assign(async () => [], { api: name });
  const github = {
    paginate: async (method) => {
      const current = snapshot();
      switch (method.api) {
        case 'pulls.list': return [{ number: 3301 }];
        case 'pulls.listReviews': return current.reviews;
        case 'pulls.listReviewComments': return current.findings ?? [];
        case 'issues.listComments': return current.comments;
        case 'repos.listCommitStatusesForRef': return current.statuses ?? [];
        case 'checks.listForRef': return current.checks ?? [];
        default: throw new Error(`Unexpected read: ${method.api}`);
      }
    },
    rest: {
      pulls: {
        list: api('pulls.list'), listReviews: api('pulls.listReviews'), listReviewComments: api('pulls.listReviewComments'),
        get: async () => {
          active = Math.min(reads, snapshots.length - 1);
          const current = snapshot();
          reads += 1;
          return {
            data: {
              number: 3301, state: 'open', draft: false,
              head: { sha: current.head ?? head, repo: { full_name: 'o/r' } },
              base: { ref: 'production', repo: { full_name: 'o/r' } },
            },
          };
        },
      },
      issues: {
        listComments: api('issues.listComments'),
        listForRepo: async () => ({ data: [] }),
        createComment: async value => { posted.push(value); return { data: { id: posted.length } }; },
        deleteComment: async () => {},
      },
      repos: { listCommitStatusesForRef: api('repos.listCommitStatusesForRef'), createCommitStatus: async value => statuses.push(value) },
      checks: { listForRef: api('checks.listForRef'), create: async value => checks.push(value) },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 3301 } }, serverUrl: 'https://github.test' };
  await run({ github, context, core: { info() {}, warning() {} } });
  return { statuses, checks, posted };
}

test('a P1 that arrives before publish stops a clean snapshot from publishing success', async () => {
  const { statuses, checks, posted } = await gate([clean, freshP1]);
  assert.deepEqual(statuses, []);
  assert.deepEqual(checks, []);
  assert.deepEqual(posted, []);
});

test('an unchanged re-read still publishes the clean verdict', async () => {
  const { statuses, checks, posted } = await gate([clean, clean]);
  assert.deepEqual(statuses.map(status => [status.context, status.state]), [['ai-review', 'success'], ['claude-review', 'success']]);
  assert.deepEqual(checks.map(check => [check.name, check.conclusion]), [['ai-review', 'success'], ['claude-review', 'success']]);
  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /^APPROVE/);
});

test('a head that moves during the re-read publishes nothing', async () => {
  const moved = { ...clean, head: 'c'.repeat(40) };
  const { statuses, checks, posted } = await gate([clean, moved]);
  assert.deepEqual([statuses, checks, posted], [[], [], []]);
});
