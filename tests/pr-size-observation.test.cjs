const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');
const main = require('../.github/scripts/pr-size-observation.cjs');
const { measure, ticketText, postedAlready } = main;
const policy = require('../.github/scripts/pr-size-policy.json');
const workflow = yaml.load(readFileSync('.github/workflows/pr-size-observation.yml', 'utf8'));
const START = Date.parse(policy.observation.startedAt);
const END = Date.parse(policy.observation.endsAt);
const BLOCKING = Date.parse(policy.blockFrom) + 1000;

const file = (filename, additions, deletions = 0, extra = {}) => ({ filename, additions, deletions, ...extra });
const pull = (number, extra = {}) => ({
  number, created_at: new Date(START + 3600_000 * number).toISOString(),
  user: { login: 'app/hypertask-runners', type: 'Bot' }, ...extra,
});
const ok = body => ({ ok: true, status: 200, json: async () => body });
const failed = status => ({ ok: false, status, json: async () => ({ error: 'refused' }) });

function github(filesByPull, { pulls = [], runs = [], comment = ok({ success: true, url: 'saved' }) } = {}) {
  const calls = { posts: [], paths: [] };
  const fetchImpl = async (url, init = {}) => {
    calls.paths.push(url);
    if (url.startsWith('https://app.hypertask.ai/api/mcp/comments')) {
      calls.posts.push({ url, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
      return comment;
    }
    if (url.includes('/actions/workflows/')) return ok({ workflow_runs: runs });
    if (/\/pulls\?/.test(url)) {
      const page = Number(new URL(url).searchParams.get('page'));
      return ok(page === 1 ? pulls : []);
    }
    const match = /\/pulls\/(\d+)\/files\?/.exec(url);
    if (!match) throw new Error(`unexpected call ${url}`);
    const page = Number(new URL(url).searchParams.get('page'));
    return ok(page === 1 ? filesByPull[match[1]] ?? [] : []);
  };
  return { fetchImpl, calls };
}

test('the window measures agent changes only and counts the over-cap ones', async () => {
  const { fetchImpl } = github({
    1: [file('src/a.ts', 300)],
    2: [file('src/b.ts', 500)],
    3: [file('src/c.ts', 200)],
    4: [file('src/d.ts', 3000)],
  }, {
    pulls: [
      pull(1), pull(2), pull(3),
      pull(4, { user: { login: 'app/hypertask-runners', type: 'Bot' } }),
      pull(5, { user: { login: 'valentinyeo', type: 'User' } }),
      pull(6, { created_at: new Date(START - 1000).toISOString() }),
      pull(7, { created_at: new Date(END + 1000).toISOString() }),
    ],
  });
  const counts = await measure({ fetchImpl, token: 'token', repository: 'hypertask-ai/hypertask' });
  assert.deepEqual(counts, { agentPullRequests: 4, humanPullRequests: 1, overCap: 2, biggest: 3000, unreadable: 0 });
});

test('one unreadable change fails the pass instead of posting short counts', async () => {
  const { fetchImpl } = github({}, { pulls: [pull(1)] });
  await assert.rejects(
    measure({ fetchImpl, token: 'token', repository: 'hypertask-ai/hypertask' }),
    /1 pull request\(s\) could not be measured/,
  );
});

test('the ticket text carries the counts, the cap and the start date', () => {
  const text = ticketText({ agentPullRequests: 331, humanPullRequests: 161, overCap: 52, biggest: 11057, unreadable: 0 }, 'https://run', false);
  assert.match(text, /Agent changes measured: 331\./);
  assert.match(text, /Over 400 hand-written lines: 52 \(16%\)\./);
  assert.match(text, /Biggest single change: 11057 lines\./);
  assert.match(text, /Human and Dependabot changes measured: 161, never blocked\./);
  assert.match(text, /Blocking starts 8 November 2026, 00:00 UTC\./);
  assert.match(text, /<a href="https:\/\/run">/);
  assert.match(ticketText({ agentPullRequests: 0, humanPullRequests: 0, overCap: 0, biggest: 0 }, 'https://run', true), /0%/);
  assert.match(ticketText({ agentPullRequests: 0, humanPullRequests: 0, overCap: 0, biggest: 0 }, 'https://run', true), /Blocking started/);
});

test('a run before the window closes reads nothing and posts nothing', async () => {
  const { fetchImpl, calls } = github({});
  const result = await main({ fetchImpl, token: 'token', boardToken: 'board', repository: 'hypertask-ai/hypertask', now: END - 1000 });
  assert.deepEqual(result, { posted: false, waiting: true });
  assert.deepEqual(calls.paths, []);
});

test('a successful earlier run stops a second post', async () => {
  const { fetchImpl, calls } = github({}, { runs: [{ id: 7 }] });
  const posted = await postedAlready({
    fetchImpl, token: 'token', repository: 'hypertask-ai/hypertask',
    workflowFile: 'pr-size-observation.yml', runId: '8',
  });
  assert.equal(posted, true);
  assert.deepEqual(calls.posts, []);
});

test('the counts reach the ticket once, under one window key', async () => {
  const { fetchImpl, calls } = github({ 1: [file('src/a.ts', 500)] }, { pulls: [pull(1)] });
  const result = await main({
    fetchImpl, token: 'token', boardToken: 'board', repository: 'hypertask-ai/hypertask',
    workflowRef: 'hypertask-ai/hypertask/.github/workflows/pr-size-observation.yml@refs/heads/production',
    runId: '8', runUrl: 'https://run', now: END + 1000,
  });
  assert.equal(result.posted, true);
  assert.equal(result.late, false);
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].key, `pr-size-observation-${policy.observation.endsAt}`);
  assert.equal(calls.posts[0].body.ticket_number, policy.observation.ticket);
  assert.equal(calls.posts[0].body.kind, 'qa');
  assert.ok(calls.paths.some(url => url.includes('/actions/workflows/pr-size-observation.yml/runs')));
  assert.match(calls.posts[0].body.text, /Over 400 hand-written lines: 1 \(100%\)/);
});

test('a refused post fails the run instead of claiming success', async () => {
  const { fetchImpl } = github({ 1: [file('src/a.ts', 500)] }, { pulls: [pull(1)], comment: failed(403) });
  await assert.rejects(
    main({
      fetchImpl, token: 'token', boardToken: 'board', repository: 'hypertask-ai/hypertask',
      now: END + 1000, runUrl: 'https://run',
    }),
    /Posting the counts to HYCI-29 failed: HTTP 403/,
  );
});

test('a post after the blocking date says blocking started', async () => {
  const { fetchImpl, calls } = github({ 1: [file('src/a.ts', 500)] }, { pulls: [pull(1)] });
  const result = await main({
    fetchImpl, token: 'token', boardToken: 'board', repository: 'hypertask-ai/hypertask',
    now: BLOCKING, runUrl: 'https://run',
  });
  assert.equal(result.late, true);
  assert.match(calls.posts[0].body.text, /Blocking started/);
});

test('missing tokens fail before any measurement', async () => {
  const { fetchImpl, calls } = github({});
  await assert.rejects(main({ fetchImpl, token: '', boardToken: 'board', repository: 'r', now: END + 1000 }), /GITHUB_TOKEN is missing/);
  await assert.rejects(main({ fetchImpl, token: 't', boardToken: '', repository: 'r', now: END + 1000 }), /HYPERTASK_MCP_TOKEN is missing/);
  assert.deepEqual(calls.paths, []);
});

test('the workflow runs trusted production code on a free hosted runner', () => {
  const job = workflow.jobs.report;
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(workflow.on.schedule[0].cron, '5,35 23 * * *');
  assert.ok('workflow_dispatch' in workflow.on);
  const run = job.steps.find(step => step.run);
  assert.match(run.run, /pr-size-observation\.cjs/);
  assert.equal(run.env.HYPERTASK_MCP_TOKEN, '${{ secrets.HYPERTASK_MCP_TOKEN }}');
  assert.equal(run.env.GITHUB_TOKEN, '${{ github.token }}');
});
